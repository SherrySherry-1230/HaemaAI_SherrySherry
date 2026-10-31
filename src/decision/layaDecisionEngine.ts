// @editedBy SherrySherry 2026-10-31
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LayaWorkerClient, LayaWorkerError, type LayaWorkerClientOptions, type LayaWorkerStatus } from './layaWorkerClient.ts';
export { LayaWorkerError, type LayaWorkerStatus } from './layaWorkerClient.ts';
import type { ConversationTurn } from '../adapters/aiAdapter.ts';
import type { JJum } from '../types/jjum.ts';
import type { LayaReviewEngine, LayaReviewRequest, LayaReviewResult } from '../layaReview.ts';

export interface DecisionScore {
  jjumId: string;
  score: number;
  confidence: number;
}

export interface RecallDecisionEngine {
  scoreRecallCandidates(
    context: ConversationTurn[],
    candidates: JJum[],
  ): Promise<DecisionScore[]>;
}

export interface LayaDecisionEngineOptions {
  pythonCommand?: string;
  enginePath?: string;
  storageRoot?: string; // 사용자 저장소 경로
  minConfidence?: number;
  timeoutMs?: number;
  startupTimeoutMs?: number;
  checkpointPath?: string;
  device?: 'cpu' | 'mps' | 'cuda';
  maxQueueSize?: number;
  maxRestarts?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  workerScriptPath?: string;
}

export interface LayaBinaryRequest {
  state: unknown;
  questions: Record<string, { instructions: string }>;
  signal?: AbortSignal;
}
export interface LayaBinaryResult {
  answers: Record<string, { pTrue: number }>;
  inputTokens?: number;
  truncated: false;
  modelRevision: string;
  tokenizerRevision: string;
  device?: string;
  inferenceMs?: number;
}
export interface LayaReviewProjectionRequest {
  jjum: Record<string, unknown>;
  turns: ConversationTurn[];
  evidenceRefs?: unknown[];
  manualEdits?: unknown[];
}

const HIDDEN_SYSTEM_FOLDER = '.🫀해마_심층_중추신경계🫀';
const ENGINES_FOLDER = 'engines';

function defaultEnginePath(storageRoot?: string): string {
  if (storageRoot) {
    // 사용자 저장소 내부 경로: {storageRoot}/🧠장기기억저장소_feat.해마🧠/.🫀해마_심층_중추신경계🫀/engines/laya
    const hiddenSystemPath = join(storageRoot, '🧠장기기억저장소_feat.해마🧠', HIDDEN_SYSTEM_FOLDER);
    const userEnginePath = join(hiddenSystemPath, ENGINES_FOLDER, 'laya');
    if (existsSync(userEnginePath)) {
      return userEnginePath;
    }
  }
  // 개발 프로젝트 경로: {cwd}/engines/laya
  return join(process.cwd(), 'engines', 'laya');
}

function defaultPythonCommand(enginePath: string) {
  const venvPython = join(enginePath, '.venv', 'bin', 'python');
  return existsSync(venvPython) ? venvPython : 'python3';
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export class LayaDecisionEngine implements RecallDecisionEngine, LayaReviewEngine {
  private readonly pythonCommand: string;
  private readonly enginePath: string;
  private readonly minConfidence: number;
  private readonly timeoutMs: number;
  private readonly worker: LayaWorkerClient;

  constructor(options: LayaDecisionEngineOptions = {}) {
    this.enginePath = options.enginePath || defaultEnginePath(options.storageRoot);
    this.pythonCommand = options.pythonCommand || defaultPythonCommand(this.enginePath);
    this.minConfidence = clamp(options.minConfidence ?? 0.7);
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 30000);
    const workerOptions: LayaWorkerClientOptions = { ...options, enginePath: this.enginePath,
      pythonCommand: this.pythonCommand, timeoutMs: this.timeoutMs,
      checkpointPath: options.checkpointPath ?? process.env.HAEMA_LAYA_CHECKPOINT };
    this.worker = new LayaWorkerClient(workerOptions);
  }

  async scoreRecallCandidates(
    context: ConversationTurn[],
    candidates: JJum[],
  ): Promise<DecisionScore[]> {
    if (candidates.length === 0) return [];
    const payload = JSON.stringify({
      state: context,
      candidates: candidates.map((jjum) => ({
        jjumId: jjum.jjumId,
        jjumName: jjum.jjumName,
        aliases: jjum.aliases,
        summary: jjum.summary,
        facts: jjum.facts.map((fact) => fact.text),
        tags: jjum.jjtags,
      })),
    });

    const raw = await this.runBridge(payload);
    const scores = Array.isArray(raw?.scores) ? raw.scores : [];
    return scores
      .filter((item): item is DecisionScore =>
        item &&
        typeof item.jjumId === 'string' &&
        Number.isFinite(item.score) &&
        Number.isFinite(item.confidence) &&
        item.confidence >= this.minConfidence,
      )
      .map((item) => ({
        jjumId: item.jjumId,
        score: clamp(item.score),
        confidence: clamp(item.confidence),
      }));
  }

  /** 판정·이유·원문 근거를 각각 선택한다. 검토에는 수정·삭제 권한이 없다. */
  async reviewJJum({ jjum, turns, evidenceRefs, manualEdits }: LayaReviewRequest): Promise<LayaReviewResult> {
    const payload = JSON.stringify({
      mode: 'review',
      minConfidence: this.minConfidence,
      ...(evidenceRefs === undefined ? {} : { evidenceRefs }),
      ...(manualEdits === undefined ? {} : { manualEdits }),
      jjum: {
        jjumId: jjum.jjumId,
        jjumName: jjum.jjumName,
        aliases: jjum.aliases,
        type: jjum.type,
        tags: jjum.jjtags,
        summary: jjum.summary,
        facts: jjum.facts.map(({ text, addedAt, source }) => ({ text, addedAt, source })),
        events: jjum.events.map(({ date, summary, refJJumIds }) => ({ date, summary, refJJumIds })),
        seons: jjum.seons.map(({ targetId, label }) => ({ targetId, label })),
      },
      turns: turns.map(({ role, text, at, utteranceId, receivedAt, final }) => ({
        role, text, at, utteranceId, receivedAt, final,
      })),
    });
    const raw = await this.runBridge(payload);
    return this.parseReview(raw?.review);
  }

  awake(): Promise<LayaWorkerStatus> { return this.worker.awake(); }
  getStatus(): LayaWorkerStatus { return this.worker.getStatus(); }
  close(): Promise<void> { return this.worker.close(); }

  /** 같은 state의 독립 명제만 묶는다. 확률을 YES/NO로 바꾸는 정책은 호출자가 제공한다. */
  async predictBinary(request: LayaBinaryRequest): Promise<LayaBinaryResult> {
    if (!request.questions || typeof request.questions !== 'object' || Array.isArray(request.questions)
      || Object.keys(request.questions).length < 1 || Object.keys(request.questions).length > 64
      || Object.entries(request.questions).some(([id, q]) => !id.trim() || !q || typeof q.instructions !== 'string' || !q.instructions.trim())) {
      throw new LayaWorkerError('invalid_request', 'Laya binary questions are invalid');
    }
    const raw = await this.worker.request({ mode: 'binary', state: request.state, questions: request.questions }, request.signal);
    const answers = raw.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)
      || Object.keys(answers).length !== Object.keys(request.questions).length
      || Object.keys(request.questions).some(id => {
        const answer = (answers as Record<string, unknown>)[id];
        return !answer || typeof answer !== 'object' || Array.isArray(answer)
          || typeof (answer as { pTrue?: unknown }).pTrue !== 'number'
          || !Number.isFinite((answer as { pTrue: number }).pTrue)
          || (answer as { pTrue: number }).pTrue < 0 || (answer as { pTrue: number }).pTrue > 1;
      }) || typeof raw.modelRevision !== 'string' || typeof raw.tokenizerRevision !== 'string'
      || raw.truncated !== false) throw new LayaWorkerError('protocol_error', 'Laya binary result is invalid');
    return { answers: answers as LayaBinaryResult['answers'], truncated: false,
      modelRevision: raw.modelRevision, tokenizerRevision: raw.tokenizerRevision,
      ...(Number.isSafeInteger(raw.inputTokens) && (raw.inputTokens as number) >= 0 ? { inputTokens: raw.inputTokens as number } : {}),
      ...(typeof raw.device === 'string' ? { device: raw.device } : {}),
      ...(typeof raw.inferenceMs === 'number' && Number.isFinite(raw.inferenceMs) && raw.inferenceMs >= 0 ? { inferenceMs: raw.inferenceMs } : {}) };
  }

  /** v5 등의 검토 전용 투영을 받는다. v4 저장 형식으로 강제 변환하지 않는다. */
  async reviewProjection(request: LayaReviewProjectionRequest): Promise<LayaReviewResult> {
    const raw = await this.runBridge(JSON.stringify({ mode: 'review', minConfidence: this.minConfidence, ...request }));
    return this.parseReview(raw.review);
  }

  private parseReview(review: unknown): LayaReviewResult {
    if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('Laya returned an invalid review');
    const { verdict, reason } = review as Record<string, unknown>;
    if ((verdict !== '정상' && verdict !== '이상함' && verdict !== '정보 부족')
      || typeof reason !== 'string' || reason.length > 500 || !reason.trim()) {
      throw new Error('Laya returned an invalid review verdict or reason');
    }
    return { verdict, reason: reason.trim() };
  }

  private async runBridge(payload: string): Promise<{ scores?: DecisionScore[]; review?: unknown }> {
    return this.worker.request(JSON.parse(payload));
  }
}
