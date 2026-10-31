// @editedBy SherrySherry 2026-10-31
/** 서버가 확정한 범위에 연결하는 관찰 전용 실행 환경. 원문·기억·점수의 자동 수정은 하지 않는다. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { FileTokenUsageStore } from './adapters/fileTokenUsageStore.ts';
import { FileLayaJournal } from './adapters/fileLayaJournal.ts';
import { FileReflectionJobStore } from './adapters/fileReflectionJobStore.ts';
import { LayaDecisionEngine, type LayaWorkerStatus } from './decision/layaDecisionEngine.ts';
import { LayaHostEventService, type LayaSourceEvent, type LayaDraftInput, type LayaResponseInput,
  type LayaFeedbackInput } from './layaHostEvents.ts';
import { layaDigest, layaIdentifier, type LayaScope } from './layaJournal.ts';
import { LayaObservationService, LAYA_QUESTIONS, type LayaQuestionId, type LayaBinaryPredictor,
  type LayaObservationRequest } from './layaObservation.ts';
import { ReflectionRunner, REFLECTION_KINDS, reflectionDigest, type ReflectionKind,
  type ReflectionGenerator, type ReflectionScope, type ReflectionRunnerOptions } from './reflectionJobs.ts';
import { TokenUsageCollector } from './tokenUsage.ts';
import type { AIUsageEvent } from './adapters/aiUsage.ts';
import type { LayaHttpBackend, LayaHttpBody } from './layaHttp.ts';

export interface LayaRuntimeEngine extends LayaBinaryPredictor {
  awake(): Promise<LayaWorkerStatus>;
  getStatus(): LayaWorkerStatus;
  close(): Promise<void>;
}
export interface LayaRuntimeOptions {
  memoryRoot: string;
  ownerId: string;
  hostChatbotId: string;
  /** 원문 보관은 별도 동의가 있는 서비스 구성에서만 켠다. */
  retainText?: boolean;
  engine?: LayaRuntimeEngine;
  /** 설정 변경·접근 철회는 추론 시작과 결과 반영 직전에 다시 확인한다. */
  authorize?: () => boolean | Promise<boolean>;
  reflectionGenerator?: ReflectionGenerator;
  authorizeExternalGeneration?: ReflectionRunnerOptions['authorizeExternalGeneration'];
}
const POLICY = 'laya-observe-20261031-v1';
const str = (body: LayaHttpBody, key: string): string => {
  const value = body[key]; layaIdentifier(value, key); return value;
};
const rawText = (body: LayaHttpBody, key: string): string => {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim() || value.length > 16000) throw new TypeError(`Invalid ${key}`);
  return value;
};
const numeric = (body: LayaHttpBody, key: string, fallback: number, max: number): number => {
  const value = body[key] ?? fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw new TypeError(`Invalid ${key}`);
  return Number(value);
};
const sourcesDigest = (sources: LayaSourceEvent[]) => reflectionDigest(sources.map(source => ({
  utteranceId: source.utteranceId, role: source.role, textDigest: source.textDigest,
  deliveryStatus: source.deliveryStatus, textAvailable: source.textAvailable,
})));

export class LayaRuntime implements LayaHttpBackend {
  readonly storageId: string;
  readonly hostEvents: LayaHostEventService;
  readonly engine: LayaRuntimeEngine;
  readonly reflectionStore: FileReflectionJobStore;
  private readonly options: LayaRuntimeOptions;
  private readonly ledger: FileTokenUsageStore;
  private readonly observations: LayaObservationService;
  private readonly runner: ReflectionRunner;
  private readonly scope: ReflectionScope;
  private readonly usageContext = new AsyncLocalStorage<{ conversationId: string; utteranceIds: string[] }>();
  private closed = false;

  constructor(options: LayaRuntimeOptions) {
    layaIdentifier(options.ownerId, 'ownerId'); layaIdentifier(options.hostChatbotId, 'hostChatbotId');
    this.options = options;
    this.ledger = new FileTokenUsageStore(options.memoryRoot); this.storageId = this.ledger.storageId;
    this.scope = { storageId: this.storageId, ownerId: options.ownerId, hostChatbotId: options.hostChatbotId,
      accessDigest: layaDigest([this.storageId, options.ownerId, options.hostChatbotId, POLICY]) };
    const journal = new FileLayaJournal({ root: options.memoryRoot });
    this.hostEvents = new LayaHostEventService({ journal, retainText: options.retainText === true });
    this.reflectionStore = new FileReflectionJobStore({ root: options.memoryRoot });
    this.engine = options.engine ?? new LayaDecisionEngine();
    this.observations = new LayaObservationService({ journal,
      predictor: { predictBinary: request => this.measuredPredict(request) },
      authorize: async request => await this.authorized() && request.accessDigest === this.scope.accessDigest
        && request.scope.ownerId === options.ownerId && request.scope.hostChatbotId === options.hostChatbotId
        && request.scope.storageId === this.storageId,
      // 한국어 실측 보정 전 임계값은 관찰 기록에만 사용한다.
      questionPolicies: Object.fromEntries(Object.keys(LAYA_QUESTIONS).map(id => [id, { tNo: 0.2, tYes: 0.8 }])),
    });
    this.runner = new ReflectionRunner({ store: this.reflectionStore,
      authorize: async scope => await this.authorized() && reflectionDigest(scope) === reflectionDigest(this.scope),
      generator: options.reflectionGenerator, authorizeExternalGeneration: options.authorizeExternalGeneration,
      loadEpisode: async (job, cursor) => {
        if (cursor > 0) return { done: true };
        if (!job.conversationId) return null;
        const sources = await this.hostEvents.getSourceEvents(this.conversationScope(job.conversationId), job.sourceEventIds);
        if (!this.sourcesComplete(sources, job.sourceEventIds) || sources.some(source => !source.textAvailable)) return null;
        const assistant = sources.filter(source => source.role === 'assistant' && source.deliveryStatus === 'host_reported').at(-1);
        const proposal = assistant && ['episode', 'training_candidates'].includes(job.kind) ? {
          targetRef: assistant.utteranceId, beforeDigest: assistant.textDigest,
          proposedChange: { reviewOnly: true, responseId: assistant.responseId! },
          sourceEventIds: job.sourceEventIds, reasonCode: 'review_actual_delivered_response',
        } : undefined;
        return { episodeId: job.jobId, sourceDigest: sourcesDigest(sources), sourceEventIds: job.sourceEventIds,
          context: sources, ...(proposal ? { proposal } : {}), isLast: true };
      },
      isCurrent: async (job, episode) => {
        if (!job.conversationId || !await this.authorized()) return false;
        const sources = await this.hostEvents.getSourceEvents(this.conversationScope(job.conversationId), job.sourceEventIds);
        return this.sourcesComplete(sources, job.sourceEventIds) && sourcesDigest(sources) === episode.sourceDigest
          && episode.sourceDigest === job.sourceDigest && job.policyVersion === POLICY
          && job.modelRevision === this.engine.getStatus().modelRevision;
      },
      reviewer: { review: async ({ job, episode, proposal, maxQuestions, signal }) => {
        const sources = episode.context as LayaSourceEvent[];
        const proposalDigest = reflectionDigest(proposal);
        const generation = job.generationAttempts[String(job.cursor)] ?? 0;
        const request = this.observationRequest(job.conversationId!, `reflection:${layaDigest([job.jobId, proposalDigest])}`, job.sourceEventIds[0],
          'reflection', { kind: 'reflection', id: job.jobId, revision: proposalDigest }, generation, { sources, proposal }, sources,
          (['R01', 'R03'] as LayaQuestionId[]).slice(0, maxQuestions));
        return (await this.observe(request, signal, () => Promise.resolve(true))).checks;
      } },
    });
  }
  private async authorized(): Promise<boolean> { return !this.closed && (await this.options.authorize?.() ?? true); }
  private async assertAuthorized(): Promise<void> {
    if (!await this.authorized()) throw Object.assign(new Error('Access revoked'), { code: 'forbidden' });
  }
  conversationScope(conversationId: string): LayaScope {
    layaIdentifier(conversationId, 'conversationId');
    return { storageId: this.storageId, ownerId: this.options.ownerId, hostChatbotId: this.options.hostChatbotId, conversationId };
  }
  private sourcesComplete(sources: LayaSourceEvent[], ids: string[]): boolean {
    return ids.every(id => sources.some(source => source.utteranceId === id || source.responseId === id));
  }
  async awake() { try { return await this.engine.awake(); } catch { return this.engine.getStatus(); } }
  async close() { this.closed = true; await this.engine.close(); }
  async status() {
    await this.assertAuthorized();
    return { mode: 'observe', actionable: false, worker: this.engine.getStatus(), policyVersion: POLICY,
      textRetention: this.options.retainText === true, background: 'opportunity', nativeMobileScheduler: false };
  }
  async conversation(conversationId: string) {
    await this.assertAuthorized();
    return { ...await this.hostEvents.getConversation(this.conversationScope(conversationId)),
      usage: this.ledger.read(this.options.ownerId, conversationId) };
  }
  async registerTurns(body: LayaHttpBody) {
    await this.assertAuthorized(); const scope = this.conversationScope(str(body, 'conversationId'));
    if (!Array.isArray(body.turns) || !body.turns.length || body.turns.length > 64) throw new TypeError('Invalid turns');
    const inputs = body.turns.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid turn');
      const item = value as LayaHttpBody;
      const utteranceId = str(item, 'utteranceId'), text = rawText(item, 'text');
      if (!['user', 'assistant'].includes(String(item.role))) throw new TypeError('Invalid role');
      const receivedAt = item.receivedAt;
      if (receivedAt !== undefined && (!Number.isSafeInteger(receivedAt) || Number(receivedAt) < 0)) throw new TypeError('Invalid receivedAt');
      return { role: item.role, utteranceId, text,
        ...(receivedAt === undefined ? {} : { receivedAt: Number(receivedAt) }),
        ...(item.replyToResponseId === undefined ? {} : { replyToResponseId: str(item, 'replyToResponseId') }) };
    });
    const results = [];
    for (const input of inputs) {
      const result = input.role === 'user' ? await this.hostEvents.registerUser(scope, input) : await this.hostEvents.registerAssistant(scope, input);
      results.push(result);
      if (result.status === 'conflict') return { status: 'conflict', results };
    }
    return { status: 'accepted', results, processing: 'registration_only' };
  }
  private questions(body: LayaHttpBody, defaults: LayaQuestionId[]): LayaQuestionId[] {
    const values = body.questionIds ?? defaults;
    if (!Array.isArray(values) || !values.length || values.length > 4 || new Set(values).size !== values.length
      || values.some(id => typeof id !== 'string' || !Object.hasOwn(LAYA_QUESTIONS, id))) throw new TypeError('Invalid question IDs');
    return values as LayaQuestionId[];
  }
  private observationRequest(conversationId: string, jobId: string, triggerEventId: string,
    stage: LayaObservationRequest['stage'], targetRef: LayaObservationRequest['targetRef'], requestGeneration: number,
    state: unknown, sources: LayaSourceEvent[], questionIds: LayaQuestionId[]): LayaObservationRequest {
    const evidence = sources.filter(source => source.textAvailable && source.text !== undefined)
      .map(source => ({ ref: source.utteranceId, text: source.text! }));
    const ready = this.engine.getStatus();
    const hasUser = sources.some(source => source.role === 'user' && source.textAvailable);
    const hasDeliveredResponse = sources.some(source => source.role === 'assistant' && source.deliveryStatus === 'host_reported' && source.textAvailable);
    // 단계별로 확인한 최소 조건만 승인한다. 임의 질문 ID가 필수 근거 검사를 우회하지 않는다.
    const supported = questionIds.filter(id => id === 'R01' && hasUser && (stage === 'draft' || stage === 'reflection' && hasDeliveredResponse)
      || id === 'R11' && stage === 'feedback' && hasUser && hasDeliveredResponse);
    return { scope: this.conversationScope(conversationId), jobId, triggerEventId, stage, targetRef, requestGeneration,
      state, evidence, questionIds, eligibility: Object.fromEntries(supported.map(id => [id,
        { applicable: evidence.length > 0, evidenceRefs: evidence.map(item => item.ref) }])),
      questionVersion: 'questions-20261031-v1', policyVersion: POLICY,
      modelRevision: ready.modelRevision ?? 'unavailable', tokenizerRevision: ready.tokenizerRevision ?? 'unavailable',
      accessDigest: this.scope.accessDigest, deadlineAt: Date.now() + 15_000 };
  }
  private observe(request: LayaObservationRequest, signal?: AbortSignal, isCurrent = async () => true) {
    return this.usageContext.run({ conversationId: request.scope.conversationId, utteranceIds: [request.triggerEventId] },
      () => this.observations.evaluate(request, async () => !signal?.aborted && await this.authorized() && await isCurrent(), {
        signal,
        finalizeGuard: entries => {
          if (this.closed) return false;
          if (request.stage !== 'draft') return true;
          const user = entries.filter(entry => entry.kind === 'host-turn' && entry.data.role === 'user').at(-1);
          const draft = entries.filter(entry => entry.kind === 'host-draft' && entry.data.userTurnId === request.triggerEventId).at(-1);
          return user?.data.utteranceId === request.triggerEventId && draft?.data.draftId === request.targetRef.id;
        },
      }));
  }
  async hostDraft(body: LayaHttpBody, signal?: AbortSignal) {
    await this.assertAuthorized(); const conversationId = str(body, 'conversationId'), scope = this.conversationScope(conversationId);
    const input: LayaDraftInput = { requestId: str(body, 'requestId'), userTurnId: str(body, 'userTurnId'),
      draftId: str(body, 'draftId'), draftText: rawText(body, 'draftText'),
      ...(body.revision === undefined ? {} : { revision: body.revision as 0 | 1 }),
      ...(body.previousDraftId === undefined ? {} : { previousDraftId: str(body, 'previousDraftId') }) };
    const questionIds = this.questions(body, ['R01', 'R03']);
    const registration = await this.hostEvents.registerDraft(scope, input);
    if (registration.status === 'conflict') return registration;
    const sources = await this.hostEvents.getSourceEvents(scope, [input.userTurnId]);
    const request = this.observationRequest(conversationId, `draft:${layaDigest(input.draftId)}`, input.userTurnId, 'draft',
      { kind: 'draft', id: input.draftId }, input.revision ?? 0, { draft: input.draftText, sources }, sources, questionIds);
    const observation = await this.observe(request, signal, async () => {
      const current = await this.hostEvents.getConversation(scope);
      return current.turns.filter(turn => turn.role === 'user').at(-1)?.utteranceId === input.userTurnId
        && current.drafts.filter(draft => draft.userTurnId === input.userTurnId).at(-1)?.draftId === input.draftId;
    });
    return { ...registration, observation };
  }
  async hostResponse(body: LayaHttpBody) {
    await this.assertAuthorized(); const scope = this.conversationScope(str(body, 'conversationId'));
    const input: LayaResponseInput = { requestId: str(body, 'requestId'), userTurnId: str(body, 'userTurnId'),
      responseId: str(body, 'responseId'), utteranceId: str(body, 'utteranceId'), finalText: rawText(body, 'finalText'),
      deliveredAt: body.deliveredAt as number, ...(body.draftId === undefined ? {} : { draftId: str(body, 'draftId') }) };
    return this.hostEvents.registerResponse(scope, input);
  }
  async feedback(body: LayaHttpBody, signal?: AbortSignal) {
    await this.assertAuthorized();
    const conversationId = str(body, 'conversationId');
    const input: LayaFeedbackInput = { feedbackId: str(body, 'feedbackId'), userTurnId: str(body, 'userTurnId'),
      text: rawText(body, 'text'), scopeKind: body.scopeKind as LayaFeedbackInput['scopeKind'],
      ...(body.replyToResponseId === undefined ? {} : { replyToResponseId: str(body, 'replyToResponseId') }) };
    const scope = this.conversationScope(conversationId);
    const registration = await this.hostEvents.registerFeedback(scope, input);
    if (registration.status !== 'accepted' && registration.status !== 'duplicate') return registration;
    if (!input.replyToResponseId) return registration;
    const sources = await this.hostEvents.getSourceEvents(scope, [input.userTurnId, input.replyToResponseId]);
    const request = this.observationRequest(conversationId, `feedback:${layaDigest(input.feedbackId)}`, input.userTurnId, 'feedback',
      { kind: 'feedback', id: input.feedbackId }, 0, { feedback: input, sources }, sources, ['R11', 'R13']);
    const observation = await this.observe(request, signal);
    return { ...registration, observation };
  }
  async listReflections() { await this.assertAuthorized(); return this.reflectionStore.list(this.scope); }
  async enqueueReflection(body: LayaHttpBody) {
    await this.assertAuthorized();
    const conversationId = str(body, 'conversationId'), kind = str(body, 'kind') as ReflectionKind;
    if (!REFLECTION_KINDS.includes(kind) || !Array.isArray(body.sourceEventIds) || !body.sourceEventIds.length
      || body.sourceEventIds.length > 64 || body.sourceEventIds.some(id => typeof id !== 'string')) throw new TypeError('Invalid sources');
    const ids = body.sourceEventIds as string[];
    const sources = await this.hostEvents.getSourceEvents(this.conversationScope(conversationId), ids);
    if (!this.sourcesComplete(sources, ids)) throw new TypeError('Missing source events');
    // responseId는 같은 실제 발화의 별칭이다. 이후 근거 참조와 멱등 키는 발화 ID로 통일한다.
    const sourceEventIds = [...new Set(sources.map(source => source.utteranceId))];
    return this.reflectionStore.enqueue(this.scope, { jobId: str(body, 'jobId'), conversationId, kind, sourceEventIds,
      sourceDigest: sourcesDigest(sources), policyVersion: POLICY, modelRevision: this.engine.getStatus().modelRevision ?? 'unavailable',
      budget: { maxEpisodes: 1, maxRuntimeMs: 15_000, maxQuestions: 4, maxProposalRevisions: 1 } });
  }
  async runReflectionOpportunity(body: LayaHttpBody, signal?: AbortSignal) {
    await this.assertAuthorized();
    return this.runner.runOpportunity({ scope: this.scope, workerId: `service:${process.pid}`, maxJobs: 1,
      budgetMs: numeric(body, 'budgetMs', 15000, 30000), signal });
  }
  async cancelReflection(body: LayaHttpBody) { await this.assertAuthorized(); return this.reflectionStore.cancel(this.scope, str(body, 'jobId')); }
  async resumeReflection(body: LayaHttpBody) { await this.assertAuthorized(); return this.reflectionStore.resume(this.scope, str(body, 'jobId')); }
  async setReflectionEnabled(body: LayaHttpBody) {
    await this.assertAuthorized(); if (typeof body.enabled !== 'boolean') throw new TypeError('Invalid enabled flag');
    await this.reflectionStore.setEnabled(this.scope, body.enabled); return { enabled: body.enabled };
  }
  private async measuredPredict(request: Parameters<LayaBinaryPredictor['predictBinary']>[0]) {
    const context = this.usageContext.getStore();
    if (!context) throw new Error('Missing usage scope');
    const collector = new TokenUsageCollector({ ownerId: this.options.ownerId, storageId: this.storageId, ...context });
    const model = this.engine.getStatus().modelRevision ?? 'laya-unavailable';
    const event: AIUsageEvent = { callId: randomUUID(), scope: 'haema', state: 'pending', provider: 'laya', model,
      requestedModel: model, modelSource: 'requested', task: 'review', source: 'unreported', usageSource: null,
      inputTokens: null, outputTokens: null, totalTokens: null };
    collector.record(event); this.ledger.save(collector.snapshot('pending'));
    try {
      const result = await this.engine.predictBinary(request);
      collector.record({ ...event, state: 'complete', model: result.modelRevision, modelSource: 'response',
        source: result.inputTokens === undefined ? 'unreported' : 'provider',
        usageSource: result.inputTokens === undefined ? null : 'laya.tokenizer', inputTokens: result.inputTokens ?? null });
      this.ledger.save(collector.snapshot('complete')); return result;
    } catch (error) {
      // 중단·미제공은 사용량 0 또는 집계 완료로 바꾸지 않는다.
      this.ledger.save(collector.snapshot('pending')); throw error;
    }
  }
}
