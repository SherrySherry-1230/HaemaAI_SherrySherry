// @editedBy SherrySherry 2026-10-31
/** 초안·수신·전송 보고·처리 완료는 서로 다른 사건이다. 이 모듈은 기억 통계를 변경하지 않는다. */
import { randomUUID } from 'node:crypto';
import { journalEntry, layaDigest, layaIdentifier, layaText, LayaJournalError, setJournalEntry, validateLayaScope,
  type LayaJournal, type LayaJournalEntry, type LayaScope } from './layaJournal.ts';

export interface LayaSourceEvent {
  role: 'user' | 'assistant';
  utteranceId: string;
  receivedAt: number;
  textDigest: string;
  textAvailable: boolean;
  text?: string;
  textUnavailableReason?: 'retention_disabled' | 'input_too_long';
  deliveryStatus: 'not_applicable' | 'unconfirmed' | 'host_reported';
  processingState: 'received' | 'completed';
  responseId?: string;
  userTurnId?: string;
  deliveredAt?: number;
  draftId?: string;
  replyToResponseId?: string;
}
export interface LayaHostEventResult {
  status: 'accepted' | 'duplicate' | 'conflict' | 'abstained';
  reasonCode?: string;
  event?: LayaSourceEvent;
  /** 수신 기록만으로 기존 대화 처리의 성공을 주장하지 않는다. */
  needsConversationProcessing?: boolean;
}
export interface LayaDraftInput {
  requestId: string; userTurnId: string; draftId: string; draftText: string;
  revision?: 0 | 1; previousDraftId?: string;
}
export interface LayaResponseInput {
  requestId: string; userTurnId: string; responseId: string; utteranceId: string;
  deliveredAt: number; finalText: string; draftId?: string;
}
export interface LayaFeedbackInput {
  feedbackId: string; userTurnId: string; text: string; replyToResponseId?: string;
  scopeKind: 'expression' | 'address' | 'topic' | 'situation' | 'continuing' | 'unspecified'; evidenceRefs?: string[];
}
export interface LayaRecallDeliveryInput {
  deliveryId: string; userTurnId: string;
  memories: { jjumId: string; mentionTexts: string[] }[];
  userMentionedJJumIds: string[];
}
export interface LayaProactiveEvidence {
  evidenceId: string; responseId: string; utteranceId: string; jjumId: string;
  recallDeliveryId: string; deliveredAt: number; source: 'host_reported';
}
const key = (id: string) => layaDigest(id);
const eventOf = (entry: LayaJournalEntry): LayaSourceEvent => {
  const event = entry.data as unknown as LayaSourceEvent;
  try {
    layaIdentifier(event.utteranceId, 'stored utteranceId');
    if (entry.key !== key(event.utteranceId) || !['user', 'assistant'].includes(event.role)
      || !Number.isSafeInteger(event.receivedAt) || event.receivedAt < 0 || !/^[a-f0-9]{64}$/u.test(event.textDigest)
      || typeof event.textAvailable !== 'boolean' || !['received', 'completed'].includes(event.processingState)) throw new Error('invalid');
    for (const field of ['responseId', 'userTurnId', 'draftId', 'replyToResponseId'] as const) {
      if (event[field] !== undefined) layaIdentifier(event[field], `stored ${field}`);
    }
    if (event.textAvailable) {
      layaText(event.text, 'stored text');
      if (event.textDigest !== layaDigest([event.role, event.text]) || event.textUnavailableReason !== undefined) throw new Error('text mismatch');
    } else if (event.text !== undefined || !['retention_disabled', 'input_too_long'].includes(event.textUnavailableReason!)) throw new Error('invalid retained text');
    if (event.role === 'user' ? event.deliveryStatus !== 'not_applicable' : !['unconfirmed', 'host_reported'].includes(event.deliveryStatus)) throw new Error('invalid delivery');
    if (event.deliveryStatus === 'host_reported' && (!event.responseId || !event.userTurnId
      || !Number.isSafeInteger(event.deliveredAt) || event.deliveredAt! < 0)) throw new Error('missing delivery evidence');
  } catch { throw new LayaJournalError('corrupt', 'Invalid source event; the original was preserved'); }
  return structuredClone(event);
};
function time(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new LayaJournalError('invalid', `Invalid ${name}`);
}

export class LayaHostEventService {
  private readonly maxTextChars: number;
  private readonly now: () => number;
  private readonly options: { journal: LayaJournal; retainText?: boolean; maxTextChars?: number; now?: () => number };
  constructor(options: { journal: LayaJournal; retainText?: boolean; maxTextChars?: number; now?: () => number }) {
    this.options = options;
    this.maxTextChars = options.maxTextChars ?? 16_000; this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxTextChars) || this.maxTextChars < 1) throw new LayaJournalError('invalid', 'Invalid text retention limit');
  }
  private textFields(text: string): Pick<LayaSourceEvent, 'textAvailable' | 'text' | 'textUnavailableReason'> {
    if (!this.options.retainText) return { textAvailable: false, textUnavailableReason: 'retention_disabled' };
    if (text.length > this.maxTextChars) return { textAvailable: false, textUnavailableReason: 'input_too_long' };
    return { textAvailable: true, text };
  }
  async registerUser(scope: LayaScope, input: { utteranceId: string; text: string; receivedAt?: number; replyToResponseId?: string }): Promise<LayaHostEventResult> {
    return this.registerTurn(scope, 'user', input);
  }
  async registerAssistant(scope: LayaScope, input: { utteranceId: string; text: string; receivedAt?: number }): Promise<LayaHostEventResult> {
    return this.registerTurn(scope, 'assistant', input);
  }
  private async registerTurn(scope: LayaScope, role: LayaSourceEvent['role'], input: { utteranceId: string; text: string; receivedAt?: number; replyToResponseId?: string }): Promise<LayaHostEventResult> {
    validateLayaScope(scope); layaIdentifier(input.utteranceId, 'utteranceId'); layaText(input.text, 'turn text');
    if (input.replyToResponseId !== undefined) layaIdentifier(input.replyToResponseId, 'replyToResponseId');
    const receivedAt = input.receivedAt ?? this.now(); time(receivedAt, 'receivedAt');
    const digest = layaDigest([role, input.text]);
    return this.options.journal.transaction(scope, entries => {
      const prior = journalEntry(entries, 'host-turn', key(input.utteranceId));
      if (prior) {
        const event = eventOf(prior);
        if (event.role !== role || event.textDigest !== digest || (input.replyToResponseId !== undefined && event.replyToResponseId !== input.replyToResponseId)) {
          return { status: 'conflict', reasonCode: 'utterance_id_conflict' };
        }
        return { status: 'duplicate', event, needsConversationProcessing: event.processingState !== 'completed' };
      }
      const event: LayaSourceEvent = { role, utteranceId: input.utteranceId, receivedAt, textDigest: digest,
        ...this.textFields(input.text), deliveryStatus: role === 'assistant' ? 'unconfirmed' : 'not_applicable', processingState: 'received',
        ...(input.replyToResponseId === undefined ? {} : { replyToResponseId: input.replyToResponseId }) };
      setJournalEntry(entries, 'host-turn', key(input.utteranceId), event as unknown as Record<string, unknown>, this.now());
      return { status: 'accepted', event, needsConversationProcessing: true };
    });
  }
  async registerDraft(scope: LayaScope, input: LayaDraftInput): Promise<LayaHostEventResult> {
    validateLayaScope(scope);
    for (const field of ['requestId', 'userTurnId', 'draftId'] as const) layaIdentifier(input[field], field);
    layaText(input.draftText, 'draftText');
    const revision = input.revision ?? 0;
    if (revision !== 0 && revision !== 1 || revision === 1 && !input.previousDraftId || revision === 0 && input.previousDraftId !== undefined) {
      throw new LayaJournalError('invalid', 'A draft has at most one linked revision');
    }
    if (input.previousDraftId !== undefined) layaIdentifier(input.previousDraftId, 'previousDraftId');
    const digest = layaDigest({ userTurnId: input.userTurnId, draftId: input.draftId, draftText: input.draftText, revision,
      ...(input.previousDraftId === undefined ? {} : { previousDraftId: input.previousDraftId }) });
    return this.options.journal.transaction(scope, entries => {
      const request = journalEntry(entries, 'host-draft-request', key(input.requestId));
      if (request) return { status: request.data.digest === digest ? 'duplicate' : 'conflict', ...(request.data.digest === digest ? {} : { reasonCode: 'request_id_conflict' }) };
      const prior = journalEntry(entries, 'host-draft', key(input.draftId));
      if (prior) {
        if (prior.data.digest !== digest) return { status: 'conflict', reasonCode: 'draft_id_conflict' };
        setJournalEntry(entries, 'host-draft-request', key(input.requestId), { digest }, this.now());
        return { status: 'duplicate' };
      }
      if (revision === 1) {
        const original = journalEntry(entries, 'host-draft', key(input.previousDraftId!));
        if (!original || original.data.revision !== 0 || original.data.userTurnId !== input.userTurnId) return { status: 'conflict', reasonCode: 'invalid_draft_revision' };
        const linked = entries.some(entry => entry.kind === 'host-draft' && entry.data.previousDraftId === input.previousDraftId);
        if (linked) return { status: 'conflict', reasonCode: 'revision_budget_exhausted' };
      }
      setJournalEntry(entries, 'host-draft', key(input.draftId), { draftId: input.draftId, userTurnId: input.userTurnId, digest, revision,
        ...this.textFields(input.draftText), ...(input.previousDraftId === undefined ? {} : { previousDraftId: input.previousDraftId }), delivered: false }, this.now());
      setJournalEntry(entries, 'host-draft-request', key(input.requestId), { digest }, this.now());
      return { status: 'accepted' };
    });
  }
  async registerResponse(scope: LayaScope, input: LayaResponseInput): Promise<LayaHostEventResult> {
    validateLayaScope(scope);
    for (const field of ['requestId', 'userTurnId', 'responseId', 'utteranceId'] as const) layaIdentifier(input[field], field);
    layaText(input.finalText, 'finalText'); time(input.deliveredAt, 'deliveredAt');
    if (input.draftId !== undefined) layaIdentifier(input.draftId, 'draftId');
    const digest = layaDigest({ ...input, requestId: '' });
    const textDigest = layaDigest(['assistant', input.finalText]);
    return this.options.journal.transaction(scope, entries => {
      const request = journalEntry(entries, 'host-response-request', key(input.requestId));
      if (request && request.data.digest !== digest) return { status: 'conflict', reasonCode: 'request_id_conflict' };
      const response = journalEntry(entries, 'host-response', key(input.responseId));
      if (response && response.data.digest !== digest) return { status: 'conflict', reasonCode: 'response_id_conflict' };
      const prior = journalEntry(entries, 'host-turn', key(input.utteranceId));
      const old = prior ? eventOf(prior) : undefined;
      if (old && (old.role !== 'assistant' || old.textDigest !== textDigest || old.responseId !== undefined && old.responseId !== input.responseId)) {
        return { status: 'conflict', reasonCode: 'utterance_id_conflict' };
      }
      if (input.draftId) {
        const draft = journalEntry(entries, 'host-draft', key(input.draftId));
        if (!draft || draft.data.userTurnId !== input.userTurnId) return { status: 'conflict', reasonCode: 'draft_scope_conflict' };
      }
      if (response) {
        if (!old) return { status: 'conflict', reasonCode: 'response_turn_missing' };
        setJournalEntry(entries, 'host-response-request', key(input.requestId), { digest }, this.now());
        return { status: 'duplicate', event: old, needsConversationProcessing: old.processingState !== 'completed' };
      }
      const event: LayaSourceEvent = { ...(old ?? { role: 'assistant', utteranceId: input.utteranceId, receivedAt: this.now(), textDigest,
        ...this.textFields(input.finalText), processingState: 'received' }), deliveryStatus: 'host_reported',
        responseId: input.responseId, userTurnId: input.userTurnId, deliveredAt: input.deliveredAt,
        ...(input.draftId === undefined ? {} : { draftId: input.draftId }) };
      setJournalEntry(entries, 'host-turn', key(input.utteranceId), event as unknown as Record<string, unknown>, this.now());
      setJournalEntry(entries, 'host-response', key(input.responseId), { digest, utteranceId: input.utteranceId }, this.now());
      setJournalEntry(entries, 'host-response-request', key(input.requestId), { digest }, this.now());
      return { status: 'accepted', event, needsConversationProcessing: event.processingState !== 'completed' };
    });
  }
  async registerFeedback(scope: LayaScope, input: LayaFeedbackInput): Promise<LayaHostEventResult> {
    validateLayaScope(scope); layaIdentifier(input.feedbackId, 'feedbackId'); layaIdentifier(input.userTurnId, 'userTurnId');
    layaText(input.text, 'feedback text');
    if (!['expression', 'address', 'topic', 'situation', 'continuing', 'unspecified'].includes(input.scopeKind)) throw new LayaJournalError('invalid', 'Invalid feedback scope');
    if (input.replyToResponseId !== undefined) layaIdentifier(input.replyToResponseId, 'replyToResponseId');
    for (const ref of input.evidenceRefs ?? []) layaIdentifier(ref, 'evidence reference');
    const digest = layaDigest(input);
    return this.options.journal.transaction(scope, entries => {
      const prior = journalEntry(entries, 'host-feedback', key(input.feedbackId));
      if (prior) return { status: prior.data.digest === digest ? 'duplicate' : 'conflict', ...(prior.data.digest === digest ? {} : { reasonCode: 'feedback_id_conflict' }) };
      const response = input.replyToResponseId ? journalEntry(entries, 'host-response', key(input.replyToResponseId)) : undefined;
      const reasonCode = !input.replyToResponseId ? 'ambiguous_feedback_target' : !response ? 'response_unavailable' : 'explicit_response_reference';
      setJournalEntry(entries, 'host-feedback', key(input.feedbackId), { feedbackId: input.feedbackId, userTurnId: input.userTurnId,
        digest, textDigest: layaDigest(input.text), ...this.textFields(input.text), scopeKind: input.scopeKind,
        evidenceRefs: input.evidenceRefs ?? [], targetStatus: response ? 'linked' : 'abstained', reasonCode,
        experienceStatus: 'not_evaluated', ...(response ? { responseId: input.replyToResponseId! } : {}) }, this.now());
      return { status: response ? 'accepted' : 'abstained', reasonCode };
    });
  }
  async claimProcessing(scope: LayaScope, input: { utteranceId: string; processorId: string; leaseMs?: number }): Promise<{ status: 'claimed' | 'busy' | 'completed'; token?: string }> {
    validateLayaScope(scope); layaIdentifier(input.utteranceId, 'utteranceId'); layaIdentifier(input.processorId, 'processorId');
    const leaseMs = input.leaseMs ?? 60_000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new LayaJournalError('invalid', 'Invalid processing lease');
    return this.options.journal.transaction(scope, entries => {
      const turn = journalEntry(entries, 'host-turn', key(input.utteranceId));
      if (!turn) throw new LayaJournalError('invalid', 'The utterance must be registered before processing');
      if (turn.data.processingState === 'completed') return { status: 'completed' };
      const prior = journalEntry(entries, 'host-processing', key(input.utteranceId));
      if (prior && (prior.data.leaseUntil as number) > this.now()) return { status: 'busy' };
      const token = randomUUID();
      setJournalEntry(entries, 'host-processing', key(input.utteranceId), { processorId: input.processorId, token, leaseUntil: this.now() + leaseMs }, this.now());
      return { status: 'claimed', token };
    });
  }
  async markConversationProcessed(scope: LayaScope, input: { utteranceId: string; textDigest: string; token?: string }): Promise<boolean> {
    validateLayaScope(scope); layaIdentifier(input.utteranceId, 'utteranceId');
    return this.options.journal.transaction(scope, entries => {
      const turn = journalEntry(entries, 'host-turn', key(input.utteranceId));
      if (!turn || turn.data.textDigest !== input.textDigest) return false;
      const claim = journalEntry(entries, 'host-processing', key(input.utteranceId));
      if (claim && (claim.data.token !== input.token || (claim.data.leaseUntil as number) <= this.now())) return false;
      turn.data.processingState = 'completed'; turn.updatedAt = new Date(this.now()).toISOString();
      return true;
    });
  }
  async registerRecallDelivery(scope: LayaScope, input: LayaRecallDeliveryInput): Promise<LayaHostEventResult> {
    validateLayaScope(scope); layaIdentifier(input.deliveryId, 'deliveryId'); layaIdentifier(input.userTurnId, 'userTurnId');
    for (const memory of input.memories) { layaIdentifier(memory.jjumId, 'jjumId'); for (const text of memory.mentionTexts) layaText(text, 'mention text', 512); }
    for (const id of input.userMentionedJJumIds) layaIdentifier(id, 'jjumId');
    const data = { deliveryId: input.deliveryId, userTurnId: input.userTurnId,
      memories: input.memories.map(memory => ({ jjumId: memory.jjumId, mentionDigests: memory.mentionTexts.map(text => layaDigest(text)) })),
      userMentionedJJumIds: [...new Set(input.userMentionedJJumIds)] };
    const digest = layaDigest(data);
    return this.options.journal.transaction(scope, entries => {
      const prior = journalEntry(entries, 'host-recall-delivery', key(input.deliveryId));
      if (prior) return { status: prior.data.digest === digest ? 'duplicate' : 'conflict' };
      setJournalEntry(entries, 'host-recall-delivery', key(input.deliveryId), { ...data, digest }, this.now());
      return { status: 'accepted' };
    });
  }
  /** 인증된 전달 보고와 문자 구간의 대응만 확인한다. 의미상 동일성·감쇠값은 여기서 확정하지 않는다. */
  async registerProactiveEvidence(scope: LayaScope, input: { responseId: string; finalText: string; mentions: { jjumId: string; start: number; end: number; recallDeliveryId: string }[] }): Promise<LayaProactiveEvidence[]> {
    validateLayaScope(scope); layaIdentifier(input.responseId, 'responseId'); layaText(input.finalText, 'finalText');
    return this.options.journal.transaction(scope, entries => {
      const response = journalEntry(entries, 'host-response', key(input.responseId));
      const turn = response ? journalEntry(entries, 'host-turn', key(response.data.utteranceId as string)) : undefined;
      if (!turn || turn.data.deliveryStatus !== 'host_reported' || turn.data.textDigest !== layaDigest(['assistant', input.finalText])) return [];
      const accepted: LayaProactiveEvidence[] = [];
      for (const mention of input.mentions) {
        layaIdentifier(mention.jjumId, 'jjumId'); layaIdentifier(mention.recallDeliveryId, 'recallDeliveryId');
        if (!Number.isSafeInteger(mention.start) || !Number.isSafeInteger(mention.end) || mention.start < 0 || mention.end <= mention.start || mention.end > input.finalText.length) continue;
        const delivery = journalEntry(entries, 'host-recall-delivery', key(mention.recallDeliveryId));
        if (!delivery || delivery.data.userTurnId !== turn.data.userTurnId || (delivery.data.userMentionedJJumIds as string[]).includes(mention.jjumId)) continue;
        const memory = (delivery.data.memories as { jjumId: string; mentionDigests: string[] }[]).find(item => item.jjumId === mention.jjumId);
        if (!memory?.mentionDigests.includes(layaDigest(input.finalText.slice(mention.start, mention.end)))) continue;
        const evidenceId = layaDigest([input.responseId, mention.jjumId]);
        if (journalEntry(entries, 'host-proactive-evidence', evidenceId)) continue;
        const evidence: LayaProactiveEvidence = { evidenceId, responseId: input.responseId, utteranceId: turn.data.utteranceId as string,
          jjumId: mention.jjumId, recallDeliveryId: mention.recallDeliveryId, deliveredAt: turn.data.deliveredAt as number, source: 'host_reported' };
        setJournalEntry(entries, 'host-proactive-evidence', evidenceId, evidence as unknown as Record<string, unknown>, this.now()); accepted.push(evidence);
      }
      return accepted;
    });
  }
  async getConversation(scope: LayaScope): Promise<{ turns: LayaSourceEvent[]; drafts: Record<string, unknown>[]; feedback: Record<string, unknown>[]; proactiveEvidence: LayaProactiveEvidence[] }> {
    validateLayaScope(scope);
    const entries = await this.options.journal.read(scope);
    // 입력 순서는 최초 등록 순서다. 외부에서 받은 발화 시각이 새 입력의 도착 순서를 되돌리지 않는다.
    return { turns: entries.filter(entry => entry.kind === 'host-turn').map(eventOf),
      drafts: entries.filter(entry => entry.kind === 'host-draft').map(entry => structuredClone(entry.data)),
      feedback: entries.filter(entry => entry.kind === 'host-feedback').map(entry => structuredClone(entry.data)),
      proactiveEvidence: entries.filter(entry => entry.kind === 'host-proactive-evidence').map(entry => structuredClone(entry.data) as unknown as LayaProactiveEvidence) };
  }
  async getSourceEvents(scope: LayaScope, ids: readonly string[]): Promise<LayaSourceEvent[]> {
    ids.forEach(id => layaIdentifier(id, 'source event id'));
    return (await this.getConversation(scope)).turns.filter(turn => ids.includes(turn.utteranceId) || turn.responseId !== undefined && ids.includes(turn.responseId));
  }
}
