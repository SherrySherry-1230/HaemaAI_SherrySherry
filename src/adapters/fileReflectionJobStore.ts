// @editedBy SherrySherry 2026-10-31
/** 같은 파일 저장소를 공유하는 실행기의 복기 claim·완료 기록을 원자적으로 교체한다. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ReflectionError, reflectionDigest, validateReflectionScope, validateReflectionJobInput,
  validateReflectionProposal, validateReflectionJSON, type ReflectionScope, type ReflectionJob, type ReflectionJobInput,
  type ReflectionJobStore, type ReflectionLease, type ReflectionObservation } from '../reflectionJobs.ts';

interface QueueRecord {
  schemaVersion: 1;
  storageId: string;
  ownerId: string;
  hostChatbotId: string;
  enabled: boolean;
  nextFence: number;
  jobs: ReflectionJob[];
}
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_JOBS = 10000;
const code = (error: unknown): string | undefined => error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
const identity = (scope: ReflectionScope) => [scope.storageId, scope.ownerId, scope.hostChatbotId];
const sameScope = (a: ReflectionScope, b: ReflectionScope) => reflectionDigest(a) === reflectionDigest(b);
const jobInput = (job: ReflectionJobInput): ReflectionJobInput => ({ jobId: job.jobId, kind: job.kind,
  ...(job.conversationId === undefined ? {} : { conversationId: job.conversationId }),
  sourceEventIds: job.sourceEventIds, sourceDigest: job.sourceDigest, policyVersion: job.policyVersion,
  modelRevision: job.modelRevision, budget: job.budget });
const operationKey = (scope: ReflectionScope, input: ReflectionJobInput) => reflectionDigest({ scope,
  ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
  kind: input.kind, sourceEventIds: input.sourceEventIds, sourceDigest: input.sourceDigest,
  policyVersion: input.policyVersion, modelRevision: input.modelRevision });
function time(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new ReflectionError('invalid', 'A valid reflection timestamp is required');
  }
}
function label(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ReflectionError('invalid', 'A non-empty reflection identifier is required');
  }
}
function reason(value?: string): void { if (value !== undefined) label(value); }
function leaseDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3600000) throw new ReflectionError('invalid', 'Invalid lease duration');
}

/** root는 서비스가 선택한 비공개 작업 폴더다. 별개 기기의 독립 파일을 분산 저장소로 간주하지 않는다. */
export class FileReflectionJobStore implements ReflectionJobStore {
  private readonly root: string;
  private readonly rootIdentity: { dev: number; ino: number };
  constructor(options: { root: string }) {
    try {
      const stat = fs.lstatSync(options.root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Not a regular directory');
      this.root = fs.realpathSync(options.root);
      this.rootIdentity = { dev: stat.dev, ino: stat.ino };
    } catch (cause) { throw new ReflectionError('unavailable', 'A regular reflection directory is required', { cause }); }
  }

  private verifyRoot(): void {
    const stat = fs.lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== this.rootIdentity.dev || stat.ino !== this.rootIdentity.ino) {
      throw new ReflectionError('unavailable', 'The reflection directory changed');
    }
  }
  private paths(scope: ReflectionScope) {
    validateReflectionScope(scope); this.verifyRoot();
    const stem = `reflection-${reflectionDigest(identity(scope))}`;
    return { filename: path.join(this.root, `${stem}.json`), lock: path.join(this.root, `${stem}.lock`) };
  }
  private readRecord(scope: ReflectionScope): QueueRecord {
    const { filename } = this.paths(scope);
    let fd: number | undefined;
    try {
      fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Invalid queue file');
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(fd))) as QueueRecord;
      this.validateRecord(value, scope);
      return value;
    } catch (cause) {
      if (code(cause) === 'ENOENT') return { schemaVersion: 1, storageId: scope.storageId,
        ownerId: scope.ownerId, hostChatbotId: scope.hostChatbotId, enabled: true, nextFence: 0, jobs: [] };
      if (cause instanceof ReflectionError) throw cause;
      throw new ReflectionError('corrupt', 'The reflection queue cannot be read safely', { cause });
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  private validateRecord(record: QueueRecord, scope: ReflectionScope): void {
    if (!record || record.schemaVersion !== 1 || record.storageId !== scope.storageId || record.ownerId !== scope.ownerId
      || record.hostChatbotId !== scope.hostChatbotId || typeof record.enabled !== 'boolean'
      || !Number.isSafeInteger(record.nextFence) || record.nextFence < 0 || !Array.isArray(record.jobs)
      || record.jobs.length > MAX_JOBS || new Set(record.jobs.map(job => job.jobId)).size !== record.jobs.length) {
      throw new ReflectionError('corrupt', 'The reflection queue has an invalid scope or state');
    }
    try {
      for (const job of record.jobs) {
        validateReflectionScope(job.scope); validateReflectionJobInput(job);
        if (reflectionDigest(identity(job.scope)) !== reflectionDigest(identity(scope))
          || !['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'].includes(job.state)
          || !Number.isSafeInteger(job.cursor) || job.cursor < 0 || job.cursor > 10000
          || !Array.isArray(job.observations) || job.observations.length !== job.cursor
          || !job.generationAttempts || typeof job.generationAttempts !== 'object' || Array.isArray(job.generationAttempts)
          || Object.entries(job.generationAttempts).some(([key, value]) => !/^\d+$/u.test(key)
            || !Number.isSafeInteger(value) || value < 0 || value > 1 + job.budget.maxProposalRevisions)
          || !Number.isSafeInteger(job.reservedGenerationTokens) || job.reservedGenerationTokens < 0
          || (job.budget.maxGeneratedTokens !== undefined && job.reservedGenerationTokens > job.budget.maxGeneratedTokens)) {
          throw new Error('Invalid job progress');
        }
        time(job.createdAt); time(job.updatedAt); reason(job.reasonCode);
        if (job.updatedAt < job.createdAt) throw new Error('Job time moved backwards');
        if (job.lease) {
          label(job.lease.token); label(job.lease.workerId); time(job.lease.expiresAt);
          if (job.state !== 'running' || job.lease.jobId !== job.jobId || !Number.isSafeInteger(job.lease.fence)
            || job.lease.fence < 1 || job.lease.fence > record.nextFence) throw new Error('Invalid job lease');
        } else if (job.state === 'running') throw new Error('Running job has no lease');
        if (job.pendingProposal) validateReflectionProposal(job.pendingProposal, job.sourceEventIds);
        if (job.generationPending && (job.generationPending.cursor !== job.cursor
          || job.generationPending.attempt !== job.generationAttempts[String(job.cursor)]
          || !Number.isSafeInteger(job.generationPending.maxTokens) || job.generationPending.maxTokens < 0)) {
          throw new Error('Invalid generation reservation');
        }
        if (job.reportedGenerationTokens !== undefined && (!Number.isSafeInteger(job.reportedGenerationTokens)
          || job.reportedGenerationTokens < 0)) throw new Error('Invalid reported usage');
        job.observations.forEach(observation => this.validateObservation(observation, job));
      }
    } catch (cause) { throw new ReflectionError('corrupt', 'A reflection job has invalid stored data', { cause }); }
  }
  private acquire(lock: string): { token: string; stat: fs.Stats } {
    const token = randomUUID();
    const create = () => {
      const fd = fs.openSync(lock, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), token }));
        fs.fsyncSync(fd); return { token, stat: fs.fstatSync(fd) };
      } finally { fs.closeSync(fd); }
    };
    try { return create(); }
    catch (cause) { if (code(cause) !== 'EEXIST') throw cause; }
    // 기록된 같은 기기의 종료된 프로세스만 복구한다. 살아 있는 실행기의 잠금을 시간만으로 빼앗지 않는다.
    let recovery: number | undefined;
    try {
      recovery = fs.openSync(`${lock}.recover`, 'wx', 0o600);
      const stat = fs.lstatSync(lock);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) throw new Error('Unknown lock');
      const owner = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid?: number; host?: string; token?: string };
      if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid! < 1) throw new Error('Unknown lock owner');
      let dead = false;
      try { process.kill(owner.pid!, 0); } catch (cause) { dead = code(cause) === 'ESRCH'; }
      if (!dead) throw new Error('Active lock');
      const current = fs.lstatSync(lock);
      if (current.ino !== stat.ino || current.dev !== stat.dev) throw new Error('Changed lock');
      fs.unlinkSync(lock); return create();
    } catch { throw new ReflectionError('locked', 'Another reflection writer or an unresolved lock is present'); }
    finally { if (recovery !== undefined) { fs.closeSync(recovery); try { fs.unlinkSync(`${lock}.recover`); } catch { /* 불명확한 복구 잠금은 보존한다. */ } } }
  }
  private mutate<T>(scope: ReflectionScope, fn: (record: QueueRecord) => T): T {
    const { filename, lock } = this.paths(scope);
    let held: ReturnType<FileReflectionJobStore['acquire']> | undefined;
    let temporary: string | undefined;
    try {
      held = this.acquire(lock);
      const record = this.readRecord(scope);
      const result = fn(record);
      this.validateRecord(record, scope);
      const bytes = `${JSON.stringify(record)}\n`;
      if (Buffer.byteLength(bytes) > MAX_BYTES) throw new ReflectionError('unavailable', 'Reflection queue capacity reached; existing records were preserved');
      temporary = path.join(this.root, `.reflection-${randomUUID()}.tmp`);
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.verifyRoot();
      const lockStat = fs.lstatSync(lock);
      if (!lockStat.isFile() || lockStat.ino !== held.stat.ino || lockStat.dev !== held.stat.dev
        || JSON.parse(fs.readFileSync(lock, 'utf8')).token !== held.token) throw new ReflectionError('stale', 'Reflection write ownership changed');
      fs.renameSync(temporary, filename); temporary = undefined;
      return structuredClone(result);
    } catch (cause) {
      if (cause instanceof ReflectionError) throw cause;
      throw new ReflectionError('unavailable', 'Reflection state could not be stored', { cause });
    } finally {
      if (temporary) { try { fs.unlinkSync(temporary); } catch { /* 임시 파일은 큐 읽기 대상이 아니다. */ } }
      if (held) {
        try { const stat = fs.lstatSync(lock); if (stat.ino === held.stat.ino && stat.dev === held.stat.dev) fs.unlinkSync(lock); }
        catch { /* 다른 잠금은 삭제하지 않는다. */ }
      }
    }
  }
  private job(record: QueueRecord, scope: ReflectionScope, jobId: string): ReflectionJob {
    label(jobId); const job = record.jobs.find(item => item.jobId === jobId && sameScope(item.scope, scope));
    if (!job) throw new ReflectionError('conflict', 'The scoped reflection job is absent');
    return job;
  }
  private owned(record: QueueRecord, scope: ReflectionScope, lease: ReflectionLease, now: number): ReflectionJob {
    time(now); if (!record.enabled) throw new ReflectionError('disabled', 'Reflection is disabled');
    const job = this.job(record, scope, lease.jobId);
    if (job.state !== 'running' || !job.lease || job.lease.token !== lease.token || job.lease.fence !== lease.fence
      || job.lease.workerId !== lease.workerId || job.lease.expiresAt <= now) {
      throw new ReflectionError('stale', 'The reflection lease is expired or replaced');
    }
    if (now < job.updatedAt) throw new ReflectionError('invalid', 'Reflection time moved backwards');
    return job;
  }
  private validateObservation(observation: ReflectionObservation, job: ReflectionJob): void {
    validateReflectionJSON(observation);
    if (!observation || typeof observation.episodeId !== 'string' || !observation.episodeId.trim()
      || typeof observation.sourceDigest !== 'string' || !observation.sourceDigest.trim()
      || !['observation', 'needs_information', 'training_candidate'].includes(observation.disposition)
      || !Array.isArray(observation.checks) || observation.checks.length < 1 || observation.checks.length > job.budget.maxQuestions
      || new Set(observation.checks.map(check => check.questionId)).size !== observation.checks.length) {
      throw new ReflectionError('invalid', 'Invalid reflection observation');
    }
    if (observation.proposal) validateReflectionProposal(observation.proposal, job.sourceEventIds);
    for (const check of observation.checks) {
      label(check.questionId); label(check.reasonCode);
      if (!['decided', 'abstained', 'failed', 'skipped'].includes(check.status)
        || (check.status === 'decided' ? !['yes', 'no'].includes(check.answer ?? '') : check.answer !== undefined)
        || (check.pTrue !== undefined && (!Number.isFinite(check.pTrue) || check.pTrue < 0 || check.pTrue > 1))
        || !Array.isArray(check.inputEvidenceRefs) || (check.status === 'decided' && check.inputEvidenceRefs.length === 0)
        || check.inputEvidenceRefs.some(id => !job.sourceEventIds.includes(id))) {
        throw new ReflectionError('invalid', 'Invalid reflection check');
      }
    }
    if (observation.disposition === 'training_candidate'
      && (observation.vetted !== false || !Array.isArray(observation.labelEvidenceRefs)
        || observation.labelEvidenceRefs.some(id => !job.sourceEventIds.includes(id)))) {
      throw new ReflectionError('invalid', 'Training candidates require evidence and separate vetting');
    }
  }

  async enqueue(scope: ReflectionScope, input: ReflectionJobInput): Promise<{ job: ReflectionJob; duplicate: boolean }> {
    validateReflectionScope(scope); validateReflectionJobInput(input);
    if (Object.keys(input).some(key => !['jobId', 'conversationId', 'kind', 'sourceEventIds', 'sourceDigest',
      'policyVersion', 'modelRevision', 'budget'].includes(key))) {
      throw new ReflectionError('invalid', 'Reflection registration cannot supply internal job state');
    }
    return this.mutate(scope, record => {
      if (!record.enabled) throw new ReflectionError('disabled', 'Reflection is disabled');
      const sameId = record.jobs.find(job => job.jobId === input.jobId);
      if (sameId && (!sameScope(sameId.scope, scope) || reflectionDigest(jobInput(sameId)) !== reflectionDigest(input))) {
        throw new ReflectionError('conflict', 'This reflection job ID already identifies different content');
      }
      const existing = sameId ?? record.jobs.find(job => operationKey(job.scope, job) === operationKey(scope, input));
      if (existing) return { job: existing, duplicate: true };
      if (record.jobs.length >= MAX_JOBS) throw new ReflectionError('unavailable', 'Reflection queue capacity reached');
      const now = Date.now();
      const job: ReflectionJob = { ...structuredClone(jobInput(input)), scope: structuredClone(scope), state: 'queued', cursor: 0,
        createdAt: now, updatedAt: now, generationAttempts: {}, reservedGenerationTokens: 0, observations: [] };
      record.jobs.push(job); return { job, duplicate: false };
    });
  }
  async read(scope: ReflectionScope, jobId: string): Promise<ReflectionJob | null> {
    label(jobId); return structuredClone(this.readRecord(scope).jobs.find(job => job.jobId === jobId && sameScope(job.scope, scope)) ?? null);
  }
  async list(scope: ReflectionScope): Promise<ReflectionJob[]> {
    return structuredClone(this.readRecord(scope).jobs.filter(job => sameScope(job.scope, scope)));
  }
  async claim(scope: ReflectionScope, request: { workerId: string; leaseMs: number; jobId?: string; now?: number }): Promise<{ job: ReflectionJob; lease: ReflectionLease } | null> {
    label(request.workerId); leaseDuration(request.leaseMs); const now = request.now ?? Date.now(); time(now);
    if (request.jobId !== undefined) label(request.jobId);
    return this.mutate(scope, record => {
      if (!record.enabled) return null;
      const job = record.jobs.find(item => sameScope(item.scope, scope) && (!request.jobId || item.jobId === request.jobId)
        && (item.state === 'queued' || (item.state === 'running' && item.lease!.expiresAt <= now)));
      if (!job) return null;
      if (now < job.updatedAt) throw new ReflectionError('invalid', 'Reflection time moved backwards');
      if (record.nextFence >= Number.MAX_SAFE_INTEGER) throw new ReflectionError('unavailable', 'Reflection fence exhausted');
      const lease: ReflectionLease = { jobId: job.jobId, workerId: request.workerId, token: randomUUID(),
        fence: ++record.nextFence, expiresAt: now + request.leaseMs };
      time(lease.expiresAt); job.state = 'running'; job.lease = lease; job.updatedAt = now; delete job.reasonCode;
      return { job, lease };
    });
  }
  async renew(scope: ReflectionScope, lease: ReflectionLease, leaseMs: number, now = Date.now()): Promise<ReflectionLease> {
    leaseDuration(leaseMs); return this.mutate(scope, record => {
      const job = this.owned(record, scope, lease, now); job.lease!.expiresAt = now + leaseMs; time(job.lease!.expiresAt);
      job.updatedAt = now; return job.lease!;
    });
  }
  async checkpoint(scope: ReflectionScope, lease: ReflectionLease, update: { cursor: number; observation: ReflectionObservation }, now = Date.now()): Promise<ReflectionJob> {
    return this.mutate(scope, record => {
      const job = this.owned(record, scope, lease, now); this.validateObservation(update.observation, job);
      if (update.cursor === job.cursor && reflectionDigest(job.observations.at(-1)) === reflectionDigest(update.observation)) return job;
      if (update.cursor !== job.cursor + 1 || update.cursor > 10000 || job.generationPending
        || job.observations.some(item => item.episodeId === update.observation.episodeId)) {
        throw new ReflectionError('conflict', 'Reflection progress must advance one completed episode at a time');
      }
      job.observations.push(structuredClone(update.observation)); job.cursor = update.cursor; job.updatedAt = now;
      delete job.pendingProposal; return job;
    });
  }
  async finish(scope: ReflectionScope, lease: ReflectionLease, update: { state: 'completed' | 'waiting' | 'failed'; reasonCode?: string }, now = Date.now()): Promise<ReflectionJob> {
    if (!['completed', 'waiting', 'failed'].includes(update.state)) throw new ReflectionError('invalid', 'Invalid completion state');
    reason(update.reasonCode);
    return this.mutate(scope, record => {
      const job = this.owned(record, scope, lease, now);
      if (update.state === 'completed' && (job.generationPending || job.pendingProposal || job.cursor === 0)) {
        throw new ReflectionError('conflict', 'Unprocessed reflection work cannot be completed');
      }
      job.state = update.state; job.updatedAt = now; delete job.lease;
      if (update.reasonCode) job.reasonCode = update.reasonCode; else delete job.reasonCode;
      return job;
    });
  }
  async reserveGeneration(scope: ReflectionScope, lease: ReflectionLease, external: boolean, now = Date.now()): Promise<{ job: ReflectionJob; maxTokens: number; attempt: number }> {
    return this.mutate(scope, record => {
      const job = this.owned(record, scope, lease, now); const attempts = job.generationAttempts[String(job.cursor)] ?? 0;
      if (job.generationPending) throw new ReflectionError('conflict', 'A prior generation outcome is unknown');
      if (attempts >= 1 + job.budget.maxProposalRevisions) throw new ReflectionError('budget', 'Proposal revision budget exhausted');
      if (external && (job.budget.maxGeneratedTokens === undefined || job.budget.maxTokensPerCall === undefined)) {
        throw new ReflectionError('budget', 'External generation has no explicit token budget');
      }
      const left = (job.budget.maxGeneratedTokens ?? 0) - job.reservedGenerationTokens;
      const maxTokens = job.budget.maxTokensPerCall === undefined ? 0 : Math.min(job.budget.maxTokensPerCall, left);
      if (job.budget.maxGeneratedTokens !== undefined && maxTokens < 1) throw new ReflectionError('budget', 'Generation token budget exhausted');
      job.generationAttempts[String(job.cursor)] = attempts + 1; job.reservedGenerationTokens += maxTokens;
      job.generationPending = { cursor: job.cursor, attempt: attempts + 1, maxTokens }; job.updatedAt = now;
      return { job, maxTokens, attempt: attempts + 1 };
    });
  }
  async completeGeneration(scope: ReflectionScope, lease: ReflectionLease, proposal: ReflectionJob['pendingProposal'] & {}, reportedTokens?: number, now = Date.now()): Promise<ReflectionJob> {
    if (reportedTokens !== undefined && (!Number.isSafeInteger(reportedTokens) || reportedTokens < 0)) throw new ReflectionError('invalid', 'Invalid measured generation usage');
    return this.mutate(scope, record => {
      const job = this.owned(record, scope, lease, now); validateReflectionProposal(proposal, job.sourceEventIds);
      if (!job.generationPending || job.generationPending.cursor !== job.cursor) throw new ReflectionError('conflict', 'No matching generation reservation');
      if (reportedTokens !== undefined && job.generationPending.maxTokens > 0 && reportedTokens > job.generationPending.maxTokens) {
        throw new ReflectionError('budget', 'Reported usage exceeded its reserved bound');
      }
      job.pendingProposal = structuredClone(proposal); delete job.generationPending; job.updatedAt = now;
      if (reportedTokens !== undefined) job.reportedGenerationTokens = (job.reportedGenerationTokens ?? 0) + reportedTokens;
      return job;
    });
  }
  async cancel(scope: ReflectionScope, jobId: string, now = Date.now()): Promise<ReflectionJob> {
    time(now); return this.mutate(scope, record => {
      const job = this.job(record, scope, jobId);
      if (job.state === 'completed' || job.state === 'cancelled') return job;
      job.state = 'cancelled'; job.updatedAt = now; job.reasonCode = 'cancelled'; delete job.lease; return job;
    });
  }
  async setEnabled(scope: ReflectionScope, enabled: boolean, now = Date.now()): Promise<void> {
    time(now); if (typeof enabled !== 'boolean') throw new ReflectionError('invalid', 'Reflection enabled must be boolean');
    this.mutate(scope, record => {
      record.enabled = enabled;
      if (!enabled) for (const job of record.jobs) {
        if (!['completed', 'cancelled'].includes(job.state)) { job.state = 'cancelled'; job.updatedAt = now;
          job.reasonCode = 'disabled'; delete job.lease; }
      }
    });
  }
  async resume(scope: ReflectionScope, jobId: string, now = Date.now()): Promise<ReflectionJob> {
    time(now); return this.mutate(scope, record => {
      if (!record.enabled) throw new ReflectionError('disabled', 'Reflection is disabled');
      const job = this.job(record, scope, jobId);
      if (job.state !== 'waiting') throw new ReflectionError('conflict', 'Only waiting work can resume');
      if (job.generationPending) throw new ReflectionError('conflict', 'Unknown generation outcome requires explicit reconciliation');
      job.state = 'queued'; job.updatedAt = now; delete job.reasonCode; return job;
    });
  }
}
