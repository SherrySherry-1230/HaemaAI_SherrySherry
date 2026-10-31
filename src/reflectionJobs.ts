// @editedBy SherrySherry 2026-10-31
/** 복기 작업은 실제 새 발화가 아니다. 이 모듈은 관찰 후보만 기록하고 기억·점수를 변경하지 않는다. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const REFLECTION_KINDS = ['episode', 'aliases', 'relationship', 'correction',
  'positive_response', 'memory_connections', 'policy_recalculation', 'response_practice', 'training_candidates'] as const;
export type ReflectionKind = typeof REFLECTION_KINDS[number];
export type ReflectionState = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export interface ReflectionScope {
  storageId: string;
  ownerId: string;
  hostChatbotId: string;
  /** 실제 허용 범위의 지문. 전체 공개 여부를 호스트 인지 완료로 해석하지 않는다. */
  accessDigest: string;
}
export interface ReflectionBudget {
  /** 한 번의 실행 기회에서 처리할 최대 에피소드 수. 전체 자료의 길이를 추정하지 않는다. */
  maxEpisodes: number;
  maxRuntimeMs: number;
  maxQuestions: number;
  maxProposalRevisions: 0 | 1;
  /** 외부 생성 호출의 명시적 상한. 없으면 외부 호출은 허용되지 않는다. */
  maxGeneratedTokens?: number;
  maxTokensPerCall?: number;
}
export interface ReflectionLease { jobId: string; workerId: string; token: string; fence: number; expiresAt: number }
export interface ReflectionCheck {
  questionId: string;
  status: 'decided' | 'abstained' | 'failed' | 'skipped';
  answer?: 'yes' | 'no';
  pTrue?: number;
  reasonCode: string;
  inputEvidenceRefs: string[];
}
export interface ReflectionProposal {
  targetRef: string;
  beforeDigest: string;
  proposedChange: Record<string, unknown>;
  sourceEventIds: string[];
  reasonCode: string;
}
export interface ReflectionObservation {
  episodeId: string;
  sourceDigest: string;
  proposal?: ReflectionProposal;
  checks: ReflectionCheck[];
  disposition: 'observation' | 'needs_information' | 'training_candidate';
  /** 학습 후보도 검수·별도 훈련 전에는 모델 가중치를 바꾸지 않는다. */
  vetted?: boolean;
  labelEvidenceRefs?: string[];
}
export interface ReflectionJobInput {
  jobId: string;
  conversationId?: string;
  kind: ReflectionKind;
  sourceEventIds: string[];
  sourceDigest: string;
  policyVersion: string;
  modelRevision: string;
  budget: ReflectionBudget;
}
export interface ReflectionJob extends ReflectionJobInput {
  scope: ReflectionScope;
  state: ReflectionState;
  cursor: number;
  createdAt: number;
  updatedAt: number;
  lease?: ReflectionLease;
  reasonCode?: string;
  generationAttempts: Record<string, number>;
  reservedGenerationTokens: number;
  /** 예약 상한은 실제 사용량이 아니다. 실제 보고가 없으면 사용량을 만들지 않는다. */
  reportedGenerationTokens?: number;
  generationPending?: { cursor: number; attempt: number; maxTokens: number };
  pendingProposal?: ReflectionProposal;
  observations: ReflectionObservation[];
}
export interface ReflectionJobStore {
  enqueue(scope: ReflectionScope, input: ReflectionJobInput): Promise<{ job: ReflectionJob; duplicate: boolean }>;
  read(scope: ReflectionScope, jobId: string): Promise<ReflectionJob | null>;
  list(scope: ReflectionScope): Promise<ReflectionJob[]>;
  claim(scope: ReflectionScope, request: { workerId: string; leaseMs: number; jobId?: string; now?: number }): Promise<{ job: ReflectionJob; lease: ReflectionLease } | null>;
  renew(scope: ReflectionScope, lease: ReflectionLease, leaseMs: number, now?: number): Promise<ReflectionLease>;
  checkpoint(scope: ReflectionScope, lease: ReflectionLease, update: { cursor: number; observation: ReflectionObservation }, now?: number): Promise<ReflectionJob>;
  finish(scope: ReflectionScope, lease: ReflectionLease, update: { state: 'completed' | 'waiting' | 'failed'; reasonCode?: string }, now?: number): Promise<ReflectionJob>;
  reserveGeneration(scope: ReflectionScope, lease: ReflectionLease, external: boolean, now?: number): Promise<{ job: ReflectionJob; maxTokens: number; attempt: number }>;
  completeGeneration(scope: ReflectionScope, lease: ReflectionLease, proposal: ReflectionProposal, reportedTokens?: number, now?: number): Promise<ReflectionJob>;
  cancel(scope: ReflectionScope, jobId: string, now?: number): Promise<ReflectionJob>;
  setEnabled(scope: ReflectionScope, enabled: boolean, now?: number): Promise<void>;
  resume(scope: ReflectionScope, jobId: string, now?: number): Promise<ReflectionJob>;
}
export class ReflectionError extends Error {
  readonly code: 'invalid' | 'conflict' | 'locked' | 'corrupt' | 'unavailable' | 'disabled' | 'budget' | 'stale';
  constructor(code: ReflectionError['code'], message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'ReflectionError'; this.code = code;
  }
}

export function reflectionDigest(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort()
      .map(key => [key, canonical((item as Record<string, unknown>)[key])])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
}
export function validateReflectionJSON(value: unknown): void {
  try {
    const text = JSON.stringify(value);
    if (text === undefined || Buffer.byteLength(text) > 1024 * 1024 || !isDeepStrictEqual(JSON.parse(text), value)) {
      throw new Error('Invalid JSON data');
    }
  } catch (cause) { throw new ReflectionError('invalid', 'Reflection input must be bounded, lossless JSON', { cause }); }
}
export function validateReflectionScope(scope: ReflectionScope): void {
  for (const key of ['storageId', 'ownerId', 'hostChatbotId', 'accessDigest'] as const) {
    const value = scope?.[key];
    if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > 512
      || /[\u0000-\u001f\u007f]/u.test(value)) throw new ReflectionError('invalid', 'A valid authorized reflection scope is required');
  }
}
export function validateReflectionJobInput(input: ReflectionJobInput): void {
  validateReflectionJSON(input);
  for (const field of ['jobId', 'sourceDigest', 'policyVersion', 'modelRevision'] as const) {
    if (typeof input?.[field] !== 'string' || !input[field].trim() || input[field].length > 512
      || /[\u0000-\u001f\u007f]/u.test(input[field])) throw new ReflectionError('invalid', 'Invalid reflection job identity');
  }
  if (input.conversationId !== undefined && (typeof input.conversationId !== 'string' || !input.conversationId.trim()
    || input.conversationId.length > 512 || /[\u0000-\u001f\u007f]/u.test(input.conversationId))) {
    throw new ReflectionError('invalid', 'Invalid reflection conversation ID');
  }
  if (!REFLECTION_KINDS.includes(input.kind) || !Array.isArray(input.sourceEventIds)
    || input.sourceEventIds.length === 0 || input.sourceEventIds.length > 10000
    || new Set(input.sourceEventIds).size !== input.sourceEventIds.length
    || input.sourceEventIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 512)) {
    throw new ReflectionError('invalid', 'Reflection sources and kind must be explicit');
  }
  const b = input.budget;
  if (!b || !Number.isSafeInteger(b.maxEpisodes) || b.maxEpisodes < 1 || b.maxEpisodes > 10000
    || !Number.isSafeInteger(b.maxRuntimeMs) || b.maxRuntimeMs < 1 || b.maxRuntimeMs > 3600000
    || !Number.isSafeInteger(b.maxQuestions) || b.maxQuestions < 1 || b.maxQuestions > 4
    || ![0, 1].includes(b.maxProposalRevisions)) throw new ReflectionError('invalid', 'Invalid bounded reflection budget');
  for (const n of [b.maxGeneratedTokens, b.maxTokensPerCall]) {
    if (n !== undefined && (!Number.isSafeInteger(n) || n < 1 || n > 10000000)) {
      throw new ReflectionError('invalid', 'Generation budget must be an explicit positive token bound');
    }
  }
  if ((b.maxGeneratedTokens === undefined) !== (b.maxTokensPerCall === undefined)) {
    throw new ReflectionError('invalid', 'Generation total and per-call budgets must be supplied together');
  }
}
export function validateReflectionProposal(proposal: ReflectionProposal, sources: readonly string[]): void {
  validateReflectionJSON(proposal);
  if (!proposal || ['targetRef', 'beforeDigest', 'reasonCode'].some(key =>
    typeof (proposal as unknown as Record<string, unknown>)[key] !== 'string'
    || !(proposal as unknown as Record<string, string>)[key].trim())
    || !proposal.proposedChange || typeof proposal.proposedChange !== 'object' || Array.isArray(proposal.proposedChange)
    || !Array.isArray(proposal.sourceEventIds) || proposal.sourceEventIds.length === 0
    || proposal.sourceEventIds.some(id => !sources.includes(id))) {
    throw new ReflectionError('invalid', 'A reflection proposal needs target, current digest, and permitted source evidence');
  }
}
export interface ReflectionEpisode {
  episodeId: string;
  sourceDigest: string;
  sourceEventIds: string[];
  /** 최소 원문은 실행 중에만 읽고 큐 원본에 자동 복제하지 않는다. */
  context: unknown;
  /** 호출부가 실제 원문과 연결해 준비한 후보. 없으면 명시적인 생성기가 필요하다. */
  proposal?: ReflectionProposal;
  isLast?: boolean;
}
export interface ReflectionGenerator {
  external: boolean;
  generate(input: { job: ReflectionJob; episode: ReflectionEpisode; previous?: ReflectionProposal;
    maxTokens: number; attempt: number; signal: AbortSignal }): Promise<{ proposal: ReflectionProposal; usageTokens?: number }>;
}
export interface ReflectionReviewer {
  review(input: { job: ReflectionJob; episode: ReflectionEpisode; proposal: ReflectionProposal;
    maxQuestions: number; signal: AbortSignal }): Promise<ReflectionCheck[]>;
}
export interface ReflectionRunnerOptions {
  store: ReflectionJobStore;
  /** 인증 및 현재 공유 허용 범위를 매 실행/저장 전에 확인한다. */
  authorize(scope: ReflectionScope): boolean | Promise<boolean>;
  loadEpisode(job: ReflectionJob, cursor: number, signal: AbortSignal): Promise<ReflectionEpisode | { done: true } | null>;
  generator?: ReflectionGenerator;
  reviewer?: ReflectionReviewer;
  /** 실제 현재 근거·정정·대상 지문 확인. 없으면 관찰 저장도 보류한다. */
  isCurrent(job: ReflectionJob, episode: ReflectionEpisode, proposal?: ReflectionProposal): boolean | Promise<boolean>;
  /** 외부 호출의 일일 토큰·비용을 먼저 예약한다. reservationId별 멱등 장부가 필요하며 없으면 대기한다. */
  authorizeExternalGeneration?(scope: ReflectionScope, request: { jobId: string; cursor: number; attempt: number;
    maxTokens: number; reservationId: string }): boolean | Promise<boolean>;
  now?: () => number;
}

function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new ReflectionError('budget', 'Execution opportunity ended'));
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) { signal.removeEventListener('abort', stop); stop(); return; }
    Promise.resolve().then(() => {
      if (signal.aborted) throw new ReflectionError('budget', 'Execution opportunity ended');
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/** OS가 허용한 짧은 실행 기회에 호출한다. 운영체제 스케줄러·모델 훈련·실제 기억 변경을 대신하지 않는다. */
export class ReflectionRunner {
  private readonly now: () => number;
  private readonly options: ReflectionRunnerOptions;
  constructor(options: ReflectionRunnerOptions) { this.options = options; this.now = options.now ?? Date.now; }

  async runOpportunity(input: { scope: ReflectionScope; workerId: string; budgetMs: number; maxJobs?: number; signal?: AbortSignal }): Promise<{
    claimed: number; completed: number; waiting: number; failed: number; cancelled: number;
  }> {
    validateReflectionScope(input.scope);
    if (!Number.isSafeInteger(input.budgetMs) || input.budgetMs < 1 || input.budgetMs > 3600000
      || !Number.isSafeInteger(input.maxJobs ?? 1) || (input.maxJobs ?? 1) < 1 || (input.maxJobs ?? 1) > 10) {
      throw new ReflectionError('invalid', 'A bounded execution opportunity is required');
    }
    const summary = { claimed: 0, completed: 0, waiting: 0, failed: 0, cancelled: 0 };
    const deadline = this.now() + input.budgetMs;
    for (let count = 0; count < (input.maxJobs ?? 1) && this.now() < deadline && !input.signal?.aborted; count++) {
      const authorization = new AbortController();
      const cancelAuthorization = () => authorization.abort();
      input.signal?.addEventListener('abort', cancelAuthorization, { once: true });
      if (input.signal?.aborted) authorization.abort();
      const authorizationTimer = setTimeout(cancelAuthorization, Math.max(1, deadline - this.now()));
      let allowed: boolean;
      try { allowed = await abortable(() => Promise.resolve(this.options.authorize(input.scope)), authorization.signal); }
      catch (error) { if (error instanceof ReflectionError && error.code === 'budget') break; throw error; }
      finally { clearTimeout(authorizationTimer); input.signal?.removeEventListener('abort', cancelAuthorization); }
      if (!allowed || this.now() >= deadline || input.signal?.aborted) break;
      const claimed = await this.options.store.claim(input.scope, { workerId: input.workerId,
        leaseMs: Math.min(3600000, Math.max(1000, deadline - this.now() + 1000)), now: this.now() });
      if (!claimed) break;
      summary.claimed++;
      const { lease } = claimed;
      let job = claimed.job;
      const controller = new AbortController();
      const stop = () => controller.abort();
      input.signal?.addEventListener('abort', stop, { once: true });
      if (input.signal?.aborted) stop();
      const remaining = Math.max(1, Math.min(deadline - this.now(), job.budget.maxRuntimeMs));
      const timer = setTimeout(stop, remaining);
      const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
        return abortable(operation, controller.signal);
      };
      const finish = async (state: 'completed' | 'waiting' | 'failed', reasonCode?: string) => {
        await this.options.store.finish(input.scope, lease, { state, ...(reasonCode ? { reasonCode } : {}) }, this.now());
        summary[state]++;
      };
      try {
        if (job.generationPending) { await finish('waiting', 'generation_outcome_unknown'); continue; }
        if (!this.options.reviewer) { await finish('waiting', 'model_unavailable'); continue; }
        for (let processed = 0; processed < job.budget.maxEpisodes; processed++) {
          const episode = await bounded(() => this.options.loadEpisode(structuredClone(job), job.cursor, controller.signal));
          if (!episode) { await finish('waiting', 'source_unavailable'); break; }
          if ('done' in episode) {
            if (episode.done !== true) throw new ReflectionError('invalid', 'Episode exhaustion must be explicit');
            await finish(job.cursor > 0 ? 'completed' : 'waiting', job.cursor > 0 ? undefined : 'source_unavailable'); break;
          }
          if (!episode.sourceEventIds.length || episode.sourceEventIds.some(id => !job.sourceEventIds.includes(id))
            || !await bounded(() => Promise.resolve(this.options.authorize(input.scope)))
            || !await bounded(() => Promise.resolve(this.options.isCurrent(job, episode)))) {
            await finish('waiting', 'source_or_access_changed'); break;
          }
          let proposal = job.pendingProposal ?? episode.proposal;
          if (proposal) validateReflectionProposal(proposal, episode.sourceEventIds);
          if (!proposal && !this.options.generator) { await finish('waiting', 'model_unavailable'); break; }
          if (!proposal && this.options.generator?.external && !job.budget.maxGeneratedTokens) {
            await finish('waiting', 'external_budget_missing'); break;
          }
          if (!proposal && this.options.generator?.external && !this.options.authorizeExternalGeneration) {
            await finish('waiting', 'daily_budget_unavailable'); break;
          }
          const assertCurrent = async (candidate?: ReflectionProposal) => {
            if (!await bounded(() => Promise.resolve(this.options.authorize(input.scope)))
              || !await bounded(() => Promise.resolve(this.options.isCurrent(job, episode, candidate)))) {
              throw new ReflectionError('stale', 'Sources or permissions changed before reflection inference');
            }
            const current = await this.options.store.read(input.scope, job.jobId);
            if (current?.state !== 'running' || current.lease?.token !== lease.token || current.lease.fence !== lease.fence
              || current.lease.expiresAt <= this.now()) throw new ReflectionError('stale', 'Reflection inference no longer owns its job');
          };
          const generate = async (previous?: ReflectionProposal): Promise<ReflectionProposal> => {
            if (controller.signal.aborted) throw new ReflectionError('budget', 'Execution opportunity ended');
            await assertCurrent(previous);
            if (this.options.generator!.external) {
              const attempt = (job.generationAttempts[String(job.cursor)] ?? 0) + 1;
              const maxTokens = Math.min(job.budget.maxTokensPerCall ?? 0,
                (job.budget.maxGeneratedTokens ?? 0) - job.reservedGenerationTokens);
              if (attempt > 1 + job.budget.maxProposalRevisions || maxTokens < 1) {
                throw new ReflectionError('budget', 'Generation token or revision budget exhausted');
              }
              // 호출 전 확정 거부는 결과 불명 예약으로 저장하지 않는다.
              if (!await bounded(() => Promise.resolve(this.options.authorizeExternalGeneration?.(input.scope,
                { jobId: job.jobId, cursor: job.cursor, attempt, maxTokens,
                  reservationId: reflectionDigest([input.scope, job.jobId, job.cursor, attempt]) }) ?? false))) {
                throw new ReflectionError('budget', 'External daily or cost budget is unavailable');
              }
              await assertCurrent(previous);
            }
            const reservation = await this.options.store.reserveGeneration(input.scope, lease,
              this.options.generator!.external, this.now());
            job = reservation.job;
            await assertCurrent(previous);
            const result = await bounded(() => this.options.generator!.generate({ job: structuredClone(job), episode,
              ...(previous ? { previous } : {}), maxTokens: reservation.maxTokens, attempt: reservation.attempt, signal: controller.signal }));
            validateReflectionProposal(result.proposal, episode.sourceEventIds);
            if (!await bounded(() => Promise.resolve(this.options.isCurrent(job, episode, result.proposal)))) {
              throw new ReflectionError('stale', 'Sources changed while proposing a reflection');
            }
            job = await this.options.store.completeGeneration(input.scope, lease, result.proposal, result.usageTokens, this.now());
            return result.proposal;
          };
          if (!proposal) proposal = await generate();
          await assertCurrent(proposal);
          let checks = await bounded(() => this.options.reviewer!.review({ job: structuredClone(job), episode, proposal: proposal!,
            maxQuestions: job.budget.maxQuestions, signal: controller.signal }));
          validateChecks(checks, job.budget.maxQuestions, episode.sourceEventIds);
          if (checks.some(check => check.status === 'abstained') && this.options.generator
            && (!this.options.generator.external || (job.budget.maxGeneratedTokens !== undefined && this.options.authorizeExternalGeneration))
            && job.budget.maxProposalRevisions === 1
            && (job.generationAttempts[String(job.cursor)] ?? 0) > 0
            && (job.generationAttempts[String(job.cursor)] ?? 0) < 2) {
            proposal = await generate(proposal);
            await assertCurrent(proposal);
            checks = await bounded(() => this.options.reviewer!.review({ job: structuredClone(job), episode, proposal: proposal!,
              maxQuestions: job.budget.maxQuestions, signal: controller.signal }));
            validateChecks(checks, job.budget.maxQuestions, episode.sourceEventIds);
          }
          if (!await bounded(() => Promise.resolve(this.options.authorize(input.scope)))
            || !await bounded(() => Promise.resolve(this.options.isCurrent(job, episode, proposal)))) {
            await finish('waiting', 'source_or_access_changed'); break;
          }
          const insufficient = checks.some(check => check.status === 'abstained' || check.status === 'failed');
          job = await this.options.store.checkpoint(input.scope, lease, { cursor: job.cursor + 1, observation: {
            episodeId: episode.episodeId, sourceDigest: episode.sourceDigest, proposal, checks,
            disposition: insufficient ? 'needs_information' : job.kind === 'training_candidates' ? 'training_candidate' : 'observation',
            ...(job.kind === 'training_candidates' ? { vetted: false, labelEvidenceRefs: [...proposal.sourceEventIds] } : {}),
          } }, this.now());
          if (episode.isLast === true) { await finish('completed'); break; }
          if (processed + 1 >= job.budget.maxEpisodes) { await finish('waiting', 'episode_budget_exhausted'); break; }
          if (controller.signal.aborted || this.now() >= deadline) { await finish('waiting', 'execution_opportunity_ended'); break; }
        }
      } catch (error) {
        try {
          if (error instanceof ReflectionError && ['stale', 'disabled'].includes(error.code)) {
            const latest = await this.options.store.read(input.scope, job.jobId);
            if (latest?.state === 'cancelled') summary.cancelled++;
            else if (latest?.state === 'running' && latest.lease?.token === lease.token) await finish('waiting', 'source_or_access_changed');
            else summary.waiting++;
          } else await finish(error instanceof ReflectionError && error.code === 'budget' ? 'waiting' : 'failed',
            error instanceof ReflectionError && error.code === 'budget' ? 'execution_budget_or_interruption' : 'execution_failed');
        } catch { summary.waiting++; }
      } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', stop); controller.abort(); }
    }
    return summary;
  }
}

function validateChecks(checks: ReflectionCheck[], limit: number, sources: readonly string[]): void {
  validateReflectionJSON(checks);
  if (!Array.isArray(checks) || checks.length === 0 || checks.length > limit
    || new Set(checks.map(check => check.questionId)).size !== checks.length) throw new ReflectionError('invalid', 'Invalid reflection checks');
  for (const check of checks) {
    if (!check || typeof check.questionId !== 'string' || !check.questionId.trim()
      || typeof check.reasonCode !== 'string' || !check.reasonCode.trim()
      || !['decided', 'abstained', 'failed', 'skipped'].includes(check.status)
      || (check.status === 'decided' ? !['yes', 'no'].includes(check.answer ?? '') : check.answer !== undefined)
      || (check.pTrue !== undefined && (!Number.isFinite(check.pTrue) || check.pTrue < 0 || check.pTrue > 1))
      || !Array.isArray(check.inputEvidenceRefs) || (check.status === 'decided' && check.inputEvidenceRefs.length === 0)
      || check.inputEvidenceRefs.some(ref => !sources.includes(ref))) {
      throw new ReflectionError('invalid', 'Unknown or unsupported reflection check result');
    }
  }
}
