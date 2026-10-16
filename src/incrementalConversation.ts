// @editedBy SherrySherry 2026-10-16
import { randomUUID } from 'node:crypto';
import type { PreparedConversationTurn } from './conversationIdentity.ts';

export interface IncrementalConversationScope {
  ownerId: string;
  storageId: string;
  conversationId: string;
}

/** revision은 입력 내용 버전이고 sequence는 실제 제출 순서다. */
export interface IncrementalConversationInput {
  sessionId: string;
  inputId: string;
  sequence: number;
  revision: number;
  text: string;
  at?: number;
}

export interface InputContinuity {
  status: 'likely' | 'undetermined';
  provisional: true;
  precedingInputIds: string[];
  evidence: string[];
}

export interface IncrementalTextChange {
  /** UTF-16 기준 위치. 서로게이트 쌍의 중간은 가리키지 않는다. */
  start: number;
  removed: string;
  inserted: string;
}

export interface SpeculativeResult {
  scores?: { jjumId: string; score: number }[];
  candidates?: { text: string; source: 'observed' | 'predicted' }[];
  retrievedIds?: string[];
}

/** 임시 후보는 저장된 쩜과 별개의 값이며 저장 권한을 갖지 않는다. */
export interface TemporaryJJumFragment {
  fragmentId: string;
  inputId: string;
  revision: number;
  generation: number;
  text: string;
  source: 'observed' | 'predicted';
}

export interface IncrementalConversationWork extends IncrementalConversationScope {
  kind: 'snapshot' | 'submit';
  sessionId: string;
  generation: number;
  inputId: string;
  sequence: number;
  revision: number;
  /** 같은 실제 재시도의 재전송을 구별한다. 최초 제출에는 없다. */
  retryId?: string;
  turns: PreparedConversationTurn[];
  changed: IncrementalTextChange;
  previousFragments: TemporaryJJumFragment[];
  signal: AbortSignal;
  /** 외부 부작용을 적용하기 직전에도 확인해야 한다. */
  isCurrent: () => boolean;
  evidenceUtteranceIds: string[];
  meaningUnitId: string;
  continuity: InputContinuity;
}

export interface IncrementalConversationHooks {
  analyze?: (work: IncrementalConversationWork) => Promise<SpeculativeResult>;
  process?: (work: IncrementalConversationWork) => Promise<unknown>;
}

export interface IncrementalInputRecord extends Omit<IncrementalConversationInput, 'sessionId'> {
  receivedAt: number;
  meaningUnitId: string;
  continuity: InputContinuity;
}

export interface IncrementalSubmission extends IncrementalInputRecord {
  processing: {
    /** completed는 hook 종료를 뜻한다. 기억 저장 여부는 result의 계약에 따른다. */
    status: 'pending' | 'completed' | 'failed' | 'superseded';
    result?: unknown;
    error?: 'PROCESSING_FAILED';
  };
}

export interface IncrementalConversationView extends IncrementalConversationScope {
  sessionId: string;
  disposed: boolean;
  submittedCount: number;
  nextSequence: number;
  analysisGeneration: number;
  processGeneration: number;
  turns: PreparedConversationTurn[];
  submissions: IncrementalSubmission[];
  draft: IncrementalInputRecord | null;
  recallScores: {
    status: 'uncomputed' | 'pending' | 'ready' | 'error';
    values: { jjumId: string; score: number }[] | null;
    generation: number;
    inputId: string | null;
    revision: number | null;
  };
  candidates: TemporaryJJumFragment[];
  carryoverFragments: TemporaryJJumFragment[];
  retrievedIds: string[];
  hostHandoff: 'policy_pending';
}

export interface IncrementalConversationAcceptance {
  accepted: boolean;
  replayed: boolean;
  stale: boolean;
  session: IncrementalConversationView;
}

function validId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 512) {
    throw new TypeError(`${field} must be a nonblank identifier of at most 512 characters`);
  }
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function meaningfulText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

function changeBetween(previous: string, next: string): IncrementalTextChange {
  const before = Array.from(previous);
  const after = Array.from(next);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]) end++;
  return {
    start: before.slice(0, start).join('').length,
    removed: before.slice(start, before.length - end).join(''),
    inserted: after.slice(start, after.length - end).join(''),
  };
}

function toTurn(record: IncrementalInputRecord, final: boolean): PreparedConversationTurn {
  return {
    role: 'user', utteranceId: record.inputId, text: record.text, receivedAt: record.receivedAt,
    ...(record.at === undefined ? {} : { at: record.at }), final,
  };
}

function validResult(result: SpeculativeResult): SpeculativeResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('Invalid speculative result');
  const clean: SpeculativeResult = {};
  if (result.scores !== undefined) {
    if (!Array.isArray(result.scores)) throw new TypeError('Invalid speculative scores');
    const scores = new Map<string, number>();
    for (const score of result.scores) {
      validId(score?.jjumId, 'jjumId');
      if (!Number.isFinite(score.score) || score.score < 0 || scores.has(score.jjumId)) {
        throw new TypeError('Invalid speculative score');
      }
      scores.set(score.jjumId, score.score);
    }
    clean.scores = [...scores].map(([jjumId, score]) => ({ jjumId, score }));
  }
  if (result.candidates !== undefined) {
    if (!Array.isArray(result.candidates)) throw new TypeError('Invalid speculative candidates');
    clean.candidates = result.candidates.map((candidate) => {
      if (typeof candidate?.text !== 'string' || !candidate.text.trim() ||
        !['observed', 'predicted'].includes(candidate.source)) throw new TypeError('Invalid speculative candidate');
      return { text: candidate.text, source: candidate.source };
    });
  }
  if (result.retrievedIds !== undefined) {
    if (!Array.isArray(result.retrievedIds)) throw new TypeError('Invalid retrieved identifiers');
    result.retrievedIds.forEach((id) => validId(id, 'jjumId'));
    clean.retrievedIds = [...new Set(result.retrievedIds)];
  }
  return clean;
}

/**
 * 호출 주기나 호스트 응답 시점을 정하지 않는 세션 조정기다.
 * 입력 접수는 동기적으로 끝나며 분석·저장은 별도 작업이다. 세션 자체는 메모리를 저장하지 않는다.
 */
export class IncrementalConversationSession {
  readonly sessionId = randomUUID();
  private readonly scope: IncrementalConversationScope;
  private readonly hooks: IncrementalConversationHooks;
  private disposed = false;
  private analysisGeneration = 0;
  private processGeneration = 0;
  private submissions: IncrementalSubmission[] = [];
  private draft: IncrementalInputRecord | null = null;
  private analysisController: AbortController | null = null;
  private processController: AbortController | null = null;
  private retryInputs = new Map<string, string>();
  private candidates: TemporaryJJumFragment[] = [];
  private carryoverFragments: TemporaryJJumFragment[] = [];
  private retrievedIds: string[] = [];
  private recallScores: IncrementalConversationView['recallScores'] = {
    status: 'uncomputed', values: null, generation: 0, inputId: null, revision: null,
  };

  constructor(scope: IncrementalConversationScope, hooks: IncrementalConversationHooks = {}) {
    for (const key of ['ownerId', 'storageId', 'conversationId'] as const) validId(scope?.[key], key);
    this.scope = { ownerId: scope.ownerId, storageId: scope.storageId, conversationId: scope.conversationId };
    this.hooks = { ...hooks };
  }

  read(): IncrementalConversationView {
    return copy({
      ...this.scope, sessionId: this.sessionId, disposed: this.disposed,
      submittedCount: this.submissions.length, nextSequence: this.submissions.length + 1,
      analysisGeneration: this.analysisGeneration, processGeneration: this.processGeneration,
      turns: [...this.submissions.map((entry) => toTurn(entry, true)), ...(this.draft ? [toTurn(this.draft, false)] : [])],
      submissions: this.submissions, draft: this.draft, recallScores: this.recallScores,
      candidates: this.candidates, carryoverFragments: this.carryoverFragments,
      retrievedIds: this.retrievedIds, hostHandoff: 'policy_pending' as const,
    });
  }

  snapshot(input: IncrementalConversationInput): IncrementalConversationAcceptance {
    this.validateInput(input);
    // 호출자가 접수 객체를 다시 사용해도 비동기 결과의 식별자는 바뀌지 않는다.
    input = { ...input };
    if (this.submissions.some((entry) => entry.inputId === input.inputId) || input.sequence <= this.submissions.length) {
      return this.acceptance(false, false, true);
    }
    this.validateNext(input);
    const previous = this.draft;
    if (previous && input.revision < previous.revision) return this.acceptance(false, false, true);
    if (previous && input.revision === previous.revision) {
      if (input.text !== previous.text || input.at !== previous.at) throw new TypeError('Conflicting snapshot revision');
      return this.acceptance(false, true, false);
    }
    this.draft = this.makeRecord(input, previous);
    const changed = changeBetween(previous?.text ?? '', input.text);
    if (previous && meaningfulText(previous.text) === meaningfulText(input.text)) {
      // 내용이 같은 주기 알림은 기존 작업을 다시 호출하지 않는다.
      this.recallScores.revision = input.revision;
      return this.acceptance(true, false, false);
    }
    this.invalidateAnalysis(input);
    const previousFragments = this.peekPreviousFragments(input.inputId);
    if (input.text.trim() && this.hooks.analyze) {
      const controller = new AbortController();
      this.analysisController = controller;
      const generation = this.analysisGeneration;
      const work = this.work('snapshot', this.draft, generation, changed, previousFragments, controller);
      this.recallScores.status = 'pending';
      void Promise.resolve().then(() => {
        if (!work.isCurrent()) return undefined;
        work.previousFragments = this.consumePreviousFragments(input.inputId);
        return this.hooks.analyze!(work);
      }).then((result) => {
        if (!work.isCurrent() || result === undefined) return;
        const clean = validResult(result);
        this.recallScores = {
          status: clean.scores === undefined ? 'uncomputed' : 'ready', values: clean.scores ?? null,
          generation, inputId: input.inputId, revision: this.draft!.revision,
        };
        this.candidates = (clean.candidates ?? []).map((candidate) => ({
          ...candidate, fragmentId: randomUUID(), inputId: input.inputId,
          revision: this.draft!.revision, generation,
        }));
        this.retrievedIds = clean.retrievedIds ?? [];
      }).catch(() => {
        if (work.isCurrent()) this.recallScores = {
          status: 'error', values: null, generation, inputId: input.inputId, revision: this.draft!.revision,
        };
      });
    }
    return this.acceptance(true, false, false);
  }

  submit(input: IncrementalConversationInput): IncrementalConversationAcceptance {
    this.validateInput(input);
    const replay = this.submissions.find((entry) => entry.inputId === input.inputId);
    if (replay) {
      if (replay.sequence !== input.sequence || replay.text !== input.text || replay.at !== input.at) {
        throw new TypeError('Conflicting submitted input');
      }
      return this.acceptance(false, true, false);
    }
    this.validateNext(input);
    const previous = this.draft;
    if (previous && (input.revision < previous.revision ||
      (input.revision === previous.revision && (input.text !== previous.text || input.at !== previous.at)))) {
      throw new TypeError('Submission must preserve or advance the snapshot revision');
    }
    if (!input.text.trim()) throw new TypeError('Submitted text must be nonblank');
    const entry: IncrementalSubmission = {
      ...this.makeRecord(input, previous), processing: { status: this.hooks.process ? 'pending' : 'completed' },
    };
    const changed = changeBetween(previous?.text ?? '', input.text);
    // 제출 직전 후보는 다음 입력에서만 검토한다. 제출 사실은 후보의 저장 근거가 아니다.
    this.carryoverFragments = [...this.carryoverFragments, ...copy(this.candidates)];
    this.invalidateAnalysis(null);
    this.draft = null;
    this.submissions.push(entry);
    this.startProcessing(entry, changed);
    return this.acceptance(true, false, false);
  }

  /** 실패한 최신 제출만 명시적인 재시도 식별자로 다시 처리한다. 제출 자체는 반복하지 않는다. */
  retry(input: IncrementalConversationInput, retryId: string): IncrementalConversationAcceptance {
    this.validateInput(input);
    validId(retryId, 'retryId');
    const entry = this.submissions.find((submission) => submission.inputId === input.inputId);
    if (!entry || entry.sequence !== input.sequence || entry.text !== input.text || entry.at !== input.at) {
      throw new TypeError('Conflicting retry input');
    }
    if (this.retryInputs.has(retryId)) {
      if (this.retryInputs.get(retryId) !== input.inputId) throw new TypeError('Conflicting retry identifier');
      return this.acceptance(false, true, false);
    }
    if (entry !== this.submissions.at(-1) || entry.processing.status !== 'failed' || !this.hooks.process) {
      throw new TypeError('Conflicting retry: only the latest failed submission can be retried');
    }
    this.retryInputs.set(retryId, input.inputId);
    this.startProcessing(entry, { start: input.text.length, removed: '', inserted: '' }, retryId);
    return this.acceptance(true, false, false);
  }

  private startProcessing(entry: IncrementalSubmission, changed: IncrementalTextChange, retryId?: string): void {
    this.invalidateProcess();
    if (this.hooks.process) {
      const controller = new AbortController();
      this.processController = controller;
      const work = this.work('submit', entry, this.processGeneration, changed, this.peekPreviousFragments(entry.inputId), controller);
      if (retryId !== undefined) work.retryId = retryId;
      void Promise.resolve().then(() => {
        if (!work.isCurrent()) return undefined;
        work.previousFragments = this.consumePreviousFragments(entry.inputId);
        return this.hooks.process!(work);
      }).then((result) => {
        if (!work.isCurrent()) return;
        const clean: unknown = copy(result ?? null);
        entry.processing = {
          status: clean && typeof clean === 'object' && 'success' in clean && clean.success === false ? 'failed' : 'completed',
          result: clean,
        };
      }).catch(() => {
        if (work.isCurrent()) entry.processing = { status: 'failed', error: 'PROCESSING_FAILED' };
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateAnalysis(null);
    this.invalidateProcess();
    this.draft = null;
    this.carryoverFragments = [];
  }

  private validateInput(input: IncrementalConversationInput): void {
    if (this.disposed) throw new TypeError('Session is disposed');
    if (!input || typeof input !== 'object') throw new TypeError('Input is required');
    if (input.sessionId !== this.sessionId) throw new TypeError('Session identifier mismatch');
    validId(input.inputId, 'inputId');
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new TypeError('sequence must be a positive safe integer');
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new TypeError('revision must be a nonnegative safe integer');
    if (typeof input.text !== 'string') throw new TypeError('text must be a string');
    if (input.at !== undefined && (!Number.isFinite(input.at) || input.at < 0)) throw new TypeError('at must be a nonnegative timestamp');
  }

  private validateNext(input: IncrementalConversationInput): void {
    if (input.sequence !== this.submissions.length + 1) throw new TypeError('Input sequence must be the next submission');
    if (this.draft && this.draft.inputId !== input.inputId) throw new TypeError('Conflicting input identifier for sequence');
  }

  private makeRecord(input: IncrementalConversationInput, previous: IncrementalInputRecord | null): IncrementalInputRecord {
    const prior = this.submissions.at(-1);
    const evidence: string[] = [];
    if (prior && !/[.!?。！？…][\s\u0022'”’»)]*$/u.test(prior.text.trim())) evidence.push('previous_submission_has_no_terminal_punctuation');
    if (prior && /^(?:그리고|그래서|그런데|하지만|또한|또는|그러므로|수(?:는|도|가)?\s|and\b|but\b|because\b)/iu.test(input.text.trim())) {
      evidence.push('current_submission_has_connective_opening');
    }
    const likely = Boolean(prior && evidence.length);
    const precedingInputIds = likely ? this.submissions.filter((entry) => entry.meaningUnitId === prior!.meaningUnitId).map((entry) => entry.inputId) : [];
    return {
      inputId: input.inputId, sequence: input.sequence, revision: input.revision, text: input.text,
      ...(input.at === undefined ? {} : { at: input.at }), receivedAt: previous?.receivedAt ?? Date.now(),
      meaningUnitId: likely ? prior!.meaningUnitId : previous?.continuity.status === 'undetermined' ? previous.meaningUnitId : randomUUID(),
      continuity: { status: likely ? 'likely' : 'undetermined', provisional: true, precedingInputIds, evidence },
    };
  }

  private peekPreviousFragments(inputId: string): TemporaryJJumFragment[] {
    return copy(this.carryoverFragments.filter((fragment) => fragment.inputId !== inputId));
  }

  private consumePreviousFragments(inputId: string): TemporaryJJumFragment[] {
    const fragments = this.peekPreviousFragments(inputId);
    const consumed = new Set(fragments.map((fragment) => fragment.fragmentId));
    this.carryoverFragments = this.carryoverFragments.filter((fragment) => !consumed.has(fragment.fragmentId));
    return fragments;
  }

  private invalidateAnalysis(input: IncrementalConversationInput | null): void {
    this.analysisController?.abort();
    this.analysisController = null;
    this.analysisGeneration++;
    this.recallScores = {
      status: 'uncomputed', values: null, generation: this.analysisGeneration,
      inputId: input?.inputId ?? null, revision: input?.revision ?? null,
    };
    this.candidates = [];
    this.retrievedIds = [];
  }

  private invalidateProcess(): void {
    this.processController?.abort();
    this.processController = null;
    this.processGeneration++;
    // 현재 제출은 아직 이 세대의 controller를 받지 않았다.
    for (const entry of this.submissions) {
      if (entry.processing.status === 'pending') entry.processing = { status: 'superseded' };
    }
    if (!this.disposed && this.hooks.process) this.submissions.at(-1)!.processing = { status: 'pending' };
  }

  private work(
    kind: 'snapshot' | 'submit', record: IncrementalInputRecord, generation: number,
    changed: IncrementalTextChange, previousFragments: TemporaryJJumFragment[], controller: AbortController,
  ): IncrementalConversationWork {
    const turns = this.submissions.map((entry) => toTurn(entry, true));
    if (kind === 'snapshot') turns.push(toTurn(record, false));
    return {
      ...this.scope, kind, sessionId: this.sessionId, generation,
      inputId: record.inputId, sequence: record.sequence, revision: record.revision,
      turns: copy(turns), changed: copy(changed), previousFragments: copy(previousFragments), signal: controller.signal,
      isCurrent: () => !this.disposed && !controller.signal.aborted &&
        generation === (kind === 'snapshot' ? this.analysisGeneration : this.processGeneration),
      // 이전 제출은 문맥이고, 이번 작업의 새 저장 근거는 현재 제출만 허용한다.
      evidenceUtteranceIds: kind === 'submit' ? [record.inputId] : [],
      meaningUnitId: record.meaningUnitId, continuity: copy(record.continuity),
    };
  }

  private acceptance(accepted: boolean, replayed: boolean, stale: boolean): IncrementalConversationAcceptance {
    return { accepted, replayed, stale, session: this.read() };
  }
}
