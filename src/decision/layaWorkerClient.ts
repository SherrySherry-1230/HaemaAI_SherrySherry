// @editedBy SherrySherry 2026-10-31
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export type LayaWorkerErrorCode = 'unavailable' | 'timeout' | 'aborted' | 'protocol_error'
  | 'queue_full' | 'closed' | 'input_too_long' | 'invalid_request' | 'execution_failed';
export class LayaWorkerError extends Error {
  readonly code: LayaWorkerErrorCode;
  constructor(code: LayaWorkerErrorCode, message: string) { super(message); this.name = 'LayaWorkerError'; this.code = code; }
}
export interface LayaWorkerStatus {
  state: 'starting' | 'ready' | 'unavailable' | 'stopping';
  starts: number;
  pid?: number;
  device?: string;
  modelRevision?: string;
  tokenizerRevision?: string;
  reasonCode?: string;
  maxInputTokens?: number;
}
export interface LayaWorkerClientOptions {
  pythonCommand: string;
  enginePath: string;
  checkpointPath?: string;
  device?: 'cpu' | 'mps' | 'cuda';
  timeoutMs?: number;
  startupTimeoutMs?: number;
  maxQueueSize?: number;
  maxRestarts?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** 별도 실행기와 합성 프로세스 검증용 명시 경로. */
  workerScriptPath?: string;
}
type Pending = { id: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integerOption = (v: number | undefined, fallback: number, min: number) => {
  const value = v ?? fallback;
  if (!Number.isSafeInteger(value) || value < min) throw new Error('Invalid Laya worker limit');
  return value;
};

/** 한 작업자에 요청을 직렬화한다. 시간 초과한 요청을 자동 재실행하지 않는다. */
export class LayaWorkerClient {
  private child?: ChildProcessWithoutNullStreams;
  private startup?: Promise<LayaWorkerStatus>;
  private startupReject?: (error: Error) => void;
  private pending?: Pending;
  private sequence: Promise<unknown> = Promise.resolve();
  private shutdown: Promise<void> = Promise.resolve();
  private queued = 0;
  private closed = false;
  private status: LayaWorkerStatus = { state: 'unavailable', starts: 0, reasonCode: 'not_started' };
  private readonly timeout: number;
  private readonly startupTimeout: number;
  private readonly maxQueue: number;
  private readonly maxStarts: number;
  private readonly maxRequest: number;
  private readonly maxResponse: number;
  private readonly options: LayaWorkerClientOptions;

  constructor(options: LayaWorkerClientOptions) {
    this.options = { ...options };
    this.timeout = integerOption(options.timeoutMs, 30_000, 1);
    this.startupTimeout = integerOption(options.startupTimeoutMs, 120_000, 1);
    this.maxQueue = integerOption(options.maxQueueSize, 32, 1);
    this.maxStarts = 1 + integerOption(options.maxRestarts, 1, 0);
    this.maxRequest = integerOption(options.maxRequestBytes, 1_048_576, 128);
    this.maxResponse = integerOption(options.maxResponseBytes, 1_048_576, 128);
  }

  getStatus(): LayaWorkerStatus { return { ...this.status }; }

  async awake(): Promise<LayaWorkerStatus> {
    if (this.closed) throw new LayaWorkerError('closed', 'Laya worker is closed');
    if (this.status.state === 'ready' && this.child) return this.getStatus();
    if (this.startup) return this.startup;
    if (this.status.starts >= this.maxStarts) throw new LayaWorkerError('unavailable', 'Laya worker restart budget exhausted');
    this.startup = this.start().finally(() => { this.startup = undefined; this.startupReject = undefined; });
    return this.startup;
  }

  private async start(): Promise<LayaWorkerStatus> {
    await this.shutdown;
    if (this.closed) throw new LayaWorkerError('closed', 'Laya worker is closed');
    this.status = { state: 'starting', starts: this.status.starts + 1 };
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      const failStartup = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
      this.startupReject = failStartup;
      const script = this.options.workerScriptPath ?? fileURLToPath(new URL('./layaWorker.py', import.meta.url));
      const args = ['-u', script, '--checkpoint', this.options.checkpointPath ?? '',
        '--max-line-bytes', String(this.maxRequest)];
      if (this.options.device) args.push('--device', this.options.device);
      const child = spawn(this.options.pythonCommand, args, {
        cwd: this.options.enginePath,
        env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
          HF_HUB_DISABLE_TELEMETRY: '1', PYTHONDONTWRITEBYTECODE: '1',
          PYTHONPATH: [this.options.enginePath, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      this.status.pid = child.pid;
      timer = setTimeout(() => this.fail(new LayaWorkerError('timeout', `Laya startup timed out after ${this.startupTimeout}ms`)), this.startupTimeout);
      child.stdout.setEncoding('utf8');
      // SDK 출력은 Python에서 stderr로 돌린다. 원문을 포함할 수 있어 공유 로그에 복사하지 않는다.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => { if (this.child === child) this.fail(new LayaWorkerError('unavailable', 'Laya worker input stream failed')); });
      child.on('error', (cause) => { if (this.child === child) this.fail(new LayaWorkerError('unavailable', `Laya worker could not start (${(cause as NodeJS.ErrnoException).code ?? 'process_error'})`)); });
      child.on('close', (code) => {
        if (this.child !== child) return;
        this.child = undefined;
        const error = new LayaWorkerError('unavailable', `Laya exited with code ${code}`);
        this.status = { state: 'unavailable', starts: this.status.starts, reasonCode: error.code };
        failStartup(error); this.pending?.reject(error); this.pending = undefined;
      });
      child.stdout.on('data', (chunk: string) => {
        if (this.child !== child) return;
        buffer += chunk;
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n');
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (Buffer.byteLength(line) > this.maxResponse) { this.fail(new LayaWorkerError('protocol_error', 'Laya response exceeds the byte limit')); return; }
          let message: unknown;
          try { message = JSON.parse(line); } catch { this.fail(new LayaWorkerError('protocol_error', 'Laya returned invalid JSONL')); return; }
          if (!object(message)) { this.fail(new LayaWorkerError('protocol_error', 'Laya returned an invalid envelope')); return; }
          if (!settled && message.type === 'ready') {
            if (!object(message.metadata) || typeof message.metadata.modelRevision !== 'string'
              || typeof message.metadata.tokenizerRevision !== 'string' || typeof message.metadata.device !== 'string') {
              this.fail(new LayaWorkerError('protocol_error', 'Laya readiness metadata is invalid')); return;
            }
            settled = true; clearTimeout(timer);
            this.status = { state: 'ready', starts: this.status.starts, pid: child.pid,
              device: message.metadata.device, modelRevision: message.metadata.modelRevision,
              tokenizerRevision: message.metadata.tokenizerRevision,
              ...(Number.isSafeInteger(message.metadata.maxInputTokens) ? { maxInputTokens: message.metadata.maxInputTokens as number } : {}) };
            resolve(this.getStatus()); continue;
          }
          if (message.type === 'unavailable') {
            const reasons = ['checkpoint_missing', 'checkpoint_incomplete', 'tokenizer_preparation_required', 'runtime_import_failed', 'runtime_initialization_failed'];
            const reason = object(message.error) && typeof message.error.reasonCode === 'string' && reasons.includes(message.error.reasonCode)
              ? message.error.reasonCode : 'unavailable';
            this.fail(new LayaWorkerError('unavailable', `Laya local checkpoint or runtime is unavailable (${reason})`));
            this.status.reasonCode = reason; return;
          }
          if (!settled || message.type !== 'result') {
            this.fail(new LayaWorkerError('protocol_error', 'Laya returned an unexpected envelope')); return;
          }
          // 중단된 작업의 늦은 응답은 현재 요청에 적용하지 않는다.
          if (message.id !== this.pending?.id) continue;
          const pending = this.pending!; this.pending = undefined;
          if (message.ok === true && object(message.result)) {
            if (typeof message.result.device === 'string') this.status.device = message.result.device;
            pending.resolve(message.result);
          }
          else if (message.ok === false && object(message.error)) {
            const code = message.error.code === 'input_too_long' ? 'input_too_long'
              : message.error.code === 'invalid_request' ? 'invalid_request' : 'execution_failed';
            const safeMessage = typeof message.error.message === 'string' ? message.error.message.slice(0, 240) : 'Laya execution failed';
            pending.reject(new LayaWorkerError(code, safeMessage));
          } else { pending.reject(new LayaWorkerError('protocol_error', 'Laya result is invalid')); this.fail(new LayaWorkerError('protocol_error', 'Laya result is invalid')); }
        }
        if (Buffer.byteLength(buffer) > this.maxResponse) this.fail(new LayaWorkerError('protocol_error', 'Laya response exceeds the byte limit'));
      });
    });
  }

  private fail(error: Error): void {
    const child = this.child;
    this.child = undefined;
    this.status = { state: this.closed ? 'stopping' : 'unavailable', starts: this.status.starts,
      reasonCode: error instanceof LayaWorkerError ? error.code : 'unavailable' };
    this.startupReject?.(error); this.pending?.reject(error); this.pending = undefined;
    if (child) {
      this.shutdown = new Promise<void>(resolve => {
        const force = setTimeout(() => { child.kill('SIGKILL'); }, 1000);
        force.unref();
        child.once('close', () => { clearTimeout(force); resolve(); });
        child.stdin.destroy(); child.kill('SIGTERM');
      });
    }
  }

  private async waitUntilAwake(signal?: AbortSignal): Promise<void> {
    if (!signal) { await this.awake(); return; }
    if (signal.aborted) throw new LayaWorkerError('aborted', 'Laya request was cancelled before execution');
    // 공유 Awake는 유지하되 기다리던 개별 요청의 취소는 준비 완료를 기다리지 않는다.
    await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort);
        reject(new LayaWorkerError('aborted', 'Laya request was cancelled while the worker was starting')); };
      signal.addEventListener('abort', abort, { once: true });
      this.awake().then(() => { signal.removeEventListener('abort', abort); resolve(); },
        error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }

  request(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new LayaWorkerError('closed', 'Laya worker is closed'));
    if (this.queued >= this.maxQueue) return Promise.reject(new LayaWorkerError('queue_full', 'Laya serial queue is full'));
    let serialized: string;
    try { serialized = JSON.stringify(payload); } catch { return Promise.reject(new LayaWorkerError('invalid_request', 'Laya request must be JSON')); }
    if (Buffer.byteLength(serialized) + 128 > this.maxRequest) return Promise.reject(new LayaWorkerError('input_too_long', 'Laya request exceeds the byte limit'));
    this.queued += 1;
    const run = this.sequence.then(async () => {
      if (signal?.aborted) throw new LayaWorkerError('aborted', 'Laya request was cancelled before execution');
      await this.waitUntilAwake(signal);
      if (signal?.aborted) throw new LayaWorkerError('aborted', 'Laya request was cancelled before execution');
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = randomUUID();
        const abort = () => this.fail(new LayaWorkerError('aborted', 'Laya request was cancelled; worker termination was requested'));
        const timer = setTimeout(() => this.fail(new LayaWorkerError('timeout', `Laya decision timed out after ${this.timeout}ms`)), this.timeout);
        const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
        this.pending = { id, resolve: value => { clean(); resolve(value); }, reject: error => { clean(); reject(error); } };
        signal?.addEventListener('abort', abort, { once: true });
        this.child!.stdin.write(`{"id":${JSON.stringify(id)},"request":${serialized}}\n`, error => {
          if (error && this.pending?.id === id) this.fail(new LayaWorkerError('unavailable', 'Laya worker input stream failed'));
        });
      });
    });
    this.sequence = run.catch(() => {});
    return run.finally(() => { this.queued -= 1; });
  }

  async close(): Promise<void> {
    if (!this.closed) { this.closed = true; this.fail(new LayaWorkerError('closed', 'Laya worker is closed')); }
    await this.shutdown;
  }
}
