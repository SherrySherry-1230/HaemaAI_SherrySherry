// @editedBy SherrySherry 2026-10-16
/**
 * 대화-추출-저장 통합 파이프라인 (HaemaAI_SherrySherry/src/)
 *
 * 흐름: extractJJums → createJJum → summarizeJJum → putJJums
 *
 * 쩜(JJum)의 내용·통계·연속 언급 기록과 쩜선(Seon)을 함께 보존한다.
 */

import type {
  AIAdapter,
  ExtractRequest,
  ExtractedDraft,
} from './adapters/aiAdapter.ts';
import type { StorageAdapter } from './adapters/storageAdapter.ts';
import { createJJum } from './createJJum.ts';
import { upsertSeon } from './seons.ts';
import { appendMentionHistory, iterateMentionHistory, DEFAULT_MENTION_HISTORY_CHUNK_SIZE } from './mentionHistory.ts';
import { recall } from './recall.ts';
import {
  captureLayaReviewIntent, invalidateLayaReview, layaContentSnapshot, pendingLayaTag,
  reviewStoredJJum, type LayaReviewEngine, type LayaReviewIntent,
} from './layaReview.ts';
import type { JJum, JJumMention } from './types/jjum.ts';
import {
  prepareConversationRequest,
  conversationReceipt,
  utteranceFingerprint,
  mentionKey,
  withConversationLock,
  type ConversationReceipt,
  type PreparedConversationTurn,
} from './conversationIdentity.ts';

// ═══════════════════════════════════════════════════════════════════
// 단계별 helper
// ═══════════════════════════════════════════════════════════════════

/**
 * 1단계: 대화에서 쩜(JJum) 초안을 추출한다.
 */
export async function extractJJums(
  adapter: AIAdapter,
  req: ExtractRequest,
): Promise<ExtractedDraft[]> {
  return adapter.extractJJums(req);
}

/**
 * 2단계: 추출된 초안(ExtractedDraft)들을 실제 쩜(JJum) 구조로 변환한다.
 *
 * createJJum()은 소유자(ownerId) 기준 쩜 생성을 담당하므로,
 * 초안 정보를 CreateJJumInput 형태로 매핑해 쩜을 만든다.
 *
 * 초안 필드 매핑:
 * - factTexts → facts (JJumFact[] 로 변환, 출처는 conversation)
 * - eventSummary → events (JJumEvent[] 로 변환)
 * - relatedNames → 저장된 쩜 ID가 확인된 뒤 쩜선으로 변환
 */
export function createJJumsFromDrafts(
  ownerId: string,
  drafts: ExtractedDraft[],
  sourceService?: string,
  now?: number,
): JJum[] {
  return drafts.map((d) => {
    const jjum = createJJum({
      ownerId,
      jjumName: d.jjumName,
      type: d.type,
      aliases: d.aliases,
      jjtags: d.tags,
      sourceService,
      now,
    });

    // 사실 조각 매핑
    if (d.factTexts && d.factTexts.length > 0) {
      jjum.facts = d.factTexts.map((text) => ({
        text,
        addedAt: now ?? Date.now(),
        source: 'conversation',
      }));
    }

    // 사건 매핑
    if (d.eventSummary) {
      jjum.events = [
        {
          date: now ?? Date.now(),
          summary: d.eventSummary,
          refJJumIds: [],
        },
      ];
    }

    return jjum;
  });
}

/**
 * 3단계: 쩜(JJum) 요약(summary)을 보강한다.
 *
 * summarizeJJum()은 { summary: string }을 반환하므로,
 * 반환된 summary로 쩜의 summary 필드를 갱신한다.
 *
 * 요약에 실패하면 해당 쩜은 보강하지 않고 원본(초안 기반) 상태 그대로 둔다.
 * 프로세스 중단 없이 다음 쩜으로 넘어간다.
 */
export async function summarizeJJums(
  adapter: AIAdapter,
  jjums: JJum[],
  hint?: string,
): Promise<JJum[]> {
  const results: JJum[] = [];

  for (const jjum of jjums) {
    try {
      const { summary } = await adapter.summarizeJJum(jjum, hint);
      if (typeof summary !== 'string') {
        throw new Error('AI summary must be a string');
      }
      results.push({ ...jjum, summary });
    } catch (err) {
      // 요약 실패 시 중단하지 않고 초안 상태 그대로 저장 대상에 포함
      results.push(jjum);
    }
  }

  return results;
}

/**
 * 4단계: 쩜(JJum) 목록을 저장소에 저장한다.
 */
export async function putJJums(
  storage: StorageAdapter,
  ownerId: string,
  jjums: JJum[],
): Promise<void> {
  await storage.putJJums(ownerId, jjums);
}

// ═══════════════════════════════════════════════════════════════════
// 통합 파이프라인
// ═══════════════════════════════════════════════════════════════════

export interface ConversationProcessingResult {
  storedCount: number;
  failedSummaries: number;
  receipt: ConversationReceipt;
}

/** 새 입력이 현재 작업을 대체했다. 이미 저장한 확정 기억의 삭제를 뜻하지 않는다. */
export class ConversationSupersededError extends Error {
  constructor() {
    super('Conversation processing was superseded by newer input');
    this.name = 'ConversationSupersededError';
  }
}

/** 준비된 발화 식별 정보를 보존하여 실패 후 같은 요청을 재시도할 수 있게 한다. */
export class ConversationProcessingError extends Error {
  readonly receipt: ConversationReceipt;

  constructor(receipt: ConversationReceipt, cause: unknown) {
    super('Conversation processing failed', { cause });
    this.name = 'ConversationProcessingError';
    this.receipt = receipt;
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/** 잘못된 초안 하나가 다른 정상 초안의 처리를 막지 않게 한다. */
function isStorageDraft(value: unknown): value is ExtractedDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.jjumName === 'string' && draft.jjumName.trim().length > 0
    && typeof draft.type === 'string'
    && isStringArray(draft.aliases) && isStringArray(draft.tags) && isStringArray(draft.factTexts)
    && (draft.eventSummary === undefined || typeof draft.eventSummary === 'string')
    && (draft.relatedNames === undefined || isStringArray(draft.relatedNames))
    && (draft.updateMemo === undefined || (typeof draft.updateMemo === 'string'
      && draft.updateMemo.trim().length > 0 && draft.updateMemo.length <= 500))
    && (draft.requestLayaReview === undefined || typeof draft.requestLayaReview === 'boolean')
    && Array.isArray(draft.mentions);
}

/**
 * 확정 발화 근거가 있는 초안을 저장한다. 같은 발화의 재전송은 이력으로 확인한다.
 * 쩜 내용·언급 이력을 먼저 저장하고, 모든 대상이 저장된 뒤 빠진 쩜선을 복구한다.
 * 재시도에는 prepareConversationRequest()로 미리 준비한 동일 요청을 재사용해야 한다.
 */
export async function processConversationToStorage(
  aiAdapter: AIAdapter,
  storageAdapter: StorageAdapter,
  ownerId: string,
  extractReq: ExtractRequest,
  options?: {
    sourceService?: string;
    summarizeHint?: string;
    /** 묶음 하나의 크기. 가득 차면 같은 쩜의 다음 묶음으로 이어 저장한다. */
    maxMentionHistoryEntries?: number;
    /** 생성·실제 내용 수정 뒤 사용할 검토 엔진. 미연결 시 판정 없이 대기를 보존한다. */
    reviewEngine?: LayaReviewEngine;
    /** 최신 입력에 해당하는 작업인지 확인한다. false가 되면 남은 반영을 중단한다. */
    isCurrent?: () => boolean;
    /** 문맥과 구별되는 이번 처리 대상. 지정하면 이 안의 확정 근거가 있는 초안만 저장한다. */
    evidenceUtteranceIds?: readonly string[];
  },
): Promise<ConversationProcessingResult> {
  if (ownerId !== extractReq.ownerId) throw new Error('Conversation ownerId must match request ownerId');
  const now = extractReq.now ?? Date.now();
  const prepared = prepareConversationRequest({ ...extractReq, now });
  const receipt = conversationReceipt(prepared);
  const reviewTargets = new Map<string, PreparedConversationTurn[]>();
  const reviewIntents = new Map<string, LayaReviewIntent>();
  const evidenceIds = options?.evidenceUtteranceIds === undefined
    ? undefined : new Set(options.evidenceUtteranceIds);
  const assertCurrent = (): void => {
    if (options?.isCurrent && !options.isCurrent()) throw new ConversationSupersededError();
  };
  const pendingInvalidations = new Set<string>();
  const invalidateReview = (jjumId: string): void => {
    if (options?.isCurrent) pendingInvalidations.add(jjumId);
    else invalidateLayaReview(storageAdapter, ownerId, jjumId);
  };
  const savePlannedJJums = async (jjums: JJum[]): Promise<void> => {
    if (!options?.isCurrent) {
      await putJJums(storageAdapter, ownerId, jjums);
      return;
    }
    // 저장한 파일은 되돌리지 않는다. 다음 파일·관계·검토부터 중단하고 재시도 이력을 남긴다.
    for (const jjum of jjums) {
      assertCurrent();
      if (pendingInvalidations.delete(jjum.jjumId)) invalidateLayaReview(storageAdapter, ownerId, jjum.jjumId);
      await storageAdapter.putJJum(ownerId, jjum);
      assertCurrent();
    }
  };
  try {
    const chunkSize = options?.maxMentionHistoryEntries ?? DEFAULT_MENTION_HISTORY_CHUNK_SIZE;
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error('Invalid mention history chunk size');
    const result = await withConversationLock(storageAdapter, ownerId, async () => {
      assertCurrent();
      const stored = await storageAdapter.listJJums(ownerId);
      assertCurrent();
      const turns = new Map(prepared.turns.map((turn) => [turn.utteranceId, turn]));
      // 비활성 쩜의 기록도 확인하여 같은 ID로 확정 발화를 바꾸지 못하게 한다.
      for (const jjum of stored) {
        for (const mention of iterateMentionHistory(jjum)) {
          if (mention.conversationId !== prepared.conversationId) continue;
          const turn = turns.get(mention.utteranceId);
          if (turn && (mention.fingerprint !== utteranceFingerprint(turn)
            || mention.role !== turn.role || mention.occurredAt !== turn.at)) {
            throw new Error('Stored utterance identity conflict');
          }
        }
      }
      const current = stored.filter((jjum) => jjum.status === 'active');
      const inactive = stored.filter((jjum) => jjum.status !== 'active');
      const knownNames = [...new Set([
        ...current.flatMap((jjum) => [jjum.jjumName, ...jjum.aliases]),
        ...(prepared.knownNames ?? []),
      ])];
      // 기존 회상 규칙으로 찾은 내용과 검토를 먼저 제공한다. 조회 단계에서는 회상 통계를 쓰지 않는다.
      const contextText = prepared.turns.map((turn) => turn.text).join(' ').toLowerCase();
      const recalled = await recall(storageAdapter, ownerId, [...new Set([
        ...contextText.split(/\s+/).filter(Boolean),
        ...current.flatMap((jjum) => [jjum.jjumName, ...jjum.aliases, ...jjum.jjtags])
          .filter((name) => name.trim() && contextText.includes(name.trim().toLowerCase())),
      ])], { touch: false, now, topicLimit: 0 });
      assertCurrent();
      const drafts = await extractJJums(aiAdapter, {
        ...prepared, knownNames, recalledJJums: recalled.candidates.map((candidate) => candidate.jjum),
      });
      assertCurrent();
      if (!Array.isArray(drafts)) throw new Error('AI drafts must be an array');
      const all = new Map(current.map((jjum) => [jjum.jjumId, jjum]));
      const changed = new Map<string, JJum>();
      const created = new Set<string>();
      const related = new Map<string, string[]>();
      const evidenceByJJum = new Map<string, Map<string, PreparedConversationTurn>>();
      const updateMemos = new Map<string, string>();
      const requestedReviews = new Set<string>();
      const originals = new Map(current.map((jjum) => [jjum.jjumId, jjum]));
      const persisted = new Map(stored.map((jjum) => [jjum.jjumId,
        new Set(Array.from(iterateMentionHistory(jjum), (mention) => mentionKey(mention.conversationId, mention.utteranceId))),
      ]));
      const normalize = (name: string): string => name.trim().toLowerCase();
      const matches = (name: string): JJum[] => {
        const key = normalize(name);
        return [...all.values()].filter((jjum) =>
          [jjum.jjumName, ...jjum.aliases].some((candidate) => normalize(candidate) === key));
      };
      for (const draft of drafts) {
        if (!isStorageDraft(draft)) continue;
        const candidates = matches(draft.jjumName);
        if (candidates.length > 1) continue;
        const existing = candidates[0];
        const previousKeys = existing ? persisted.get(existing.jjumId) : undefined;
        const evidence = new Map<string, { turn: PreparedConversationTurn; kind: JJumMention['kind'] }>();
        const conflictingKinds = new Set<string>();
        for (const mention of draft.mentions!) {
          if (typeof mention !== 'object' || mention === null) continue;
          const turn = turns.get(mention.utteranceId);
          if (!turn?.final) continue;
          if (!(turn.role === 'assistant' ? mention.kind === 'host'
            : mention.kind === 'initiated' || mention.kind === 'prompted')) continue;
          const previous = evidence.get(turn.utteranceId);
          if (previous && previous.kind !== mention.kind) conflictingKinds.add(turn.utteranceId);
          evidence.set(turn.utteranceId, { turn, kind: mention.kind });
        }
        if (evidence.size === 0) continue;
        if (evidenceIds && ![...evidence.keys()].some((utteranceId) => evidenceIds.has(utteranceId))) continue;
        // 비활성 쩜에 이미 반영된 발화는 새 쩜으로 복제하거나 상태를 되살리지 않는다.
        const inactiveReplay = inactive.some((jjum) =>
          [jjum.jjumName, ...jjum.aliases].some((name) => normalize(name) === normalize(draft.jjumName))
          && [...evidence.keys()].every((utteranceId) =>
            persisted.get(jjum.jjumId)?.has(mentionKey(prepared.conversationId, utteranceId))));
        if (inactiveReplay) continue;
        for (const utteranceId of conflictingKinds) {
          if (!previousKeys?.has(mentionKey(prepared.conversationId, utteranceId))) {
            throw new Error('Conflicting mention kinds');
          }
        }
        const fullReplay = existing && [...evidence.keys()].every((utteranceId) =>
          previousKeys?.has(mentionKey(prepared.conversationId, utteranceId)));
        if (fullReplay) {
          related.set(existing.jjumId, [...(related.get(existing.jjumId) ?? []), ...(draft.relatedNames ?? [])]);
          // 마지막 검토 요청의 근거가 모두 있는 재전송만 재개한다. 예전 대화가 새 대기를 가져가지 않는다.
          const requested = [...existing.editHistory].reverse().find((entry) => entry.reviewRequested)?.evidence;
          if (existing.layaTag?.state === 'pending' && requested?.conversationId === prepared.conversationId
            && requested.utteranceIds.length > 0 && requested.utteranceIds.every((id) => turns.get(id)?.final)) {
            reviewTargets.set(existing.jjumId, requested.utteranceIds.map((id) => turns.get(id)!));
          }
          continue;
        }
        const fresh = createJJumsFromDrafts(ownerId, [draft], options?.sourceService, now)[0];
        let jjum: JJum;
        if (existing) {
          const seenFacts = new Set(existing.facts.map((fact) => fact.text));
          const facts = [...existing.facts];
          for (const fact of fresh.facts) {
            if (seenFacts.has(fact.text)) continue;
            seenFacts.add(fact.text);
            facts.push(fact);
          }
          jjum = {
            ...existing,
            aliases: [...new Set([...existing.aliases, ...fresh.aliases])],
            jjtags: [...new Set([...existing.jjtags, ...fresh.jjtags])],
            type: existing.type === 'unknown' ? fresh.type : existing.type,
            facts,
            events: [...existing.events, ...fresh.events],
          };
        } else {
          jjum = fresh;
          created.add(jjum.jjumId);
        }
        const additions: JJumMention[] = [];
        const freshEvidence = evidenceByJJum.get(jjum.jjumId) ?? new Map<string, PreparedConversationTurn>();
        for (const { turn } of evidence.values()) {
          if (!previousKeys?.has(mentionKey(prepared.conversationId, turn.utteranceId))) {
            freshEvidence.set(turn.utteranceId, turn);
          }
        }
        evidenceByJJum.set(jjum.jjumId, freshEvidence);
        if (freshEvidence.size > 0) {
          if (draft.updateMemo) updateMemos.set(jjum.jjumId, draft.updateMemo.trim());
          if (draft.requestLayaReview) requestedReviews.add(jjum.jjumId);
        }
        const byKey = new Map(Array.from(iterateMentionHistory(jjum),
          (mention) => [mentionKey(mention.conversationId, mention.utteranceId), mention] as const));
        for (const { turn, kind } of evidence.values()) {
          const key = mentionKey(prepared.conversationId, turn.utteranceId);
          const previous = byKey.get(key);
          if (previous) {
            if (!previousKeys?.has(key) && previous.kind !== kind) throw new Error('Conflicting mention kinds');
            continue;
          }
          const mention: JJumMention = {
            conversationId: prepared.conversationId, utteranceId: turn.utteranceId,
            role: turn.role, kind,
            ...(turn.at === undefined ? {} : { occurredAt: turn.at }),
            receivedAt: turn.receivedAt, recordedAt: now,
            fingerprint: utteranceFingerprint(turn), counted: kind === 'initiated',
          };
          additions.push(mention);
          byKey.set(key, mention);
          if (!created.has(jjum.jjumId) && mention.counted) jjum.mentionCount += 1;
          if (turn.role === 'user') jjum.lastMentioned = Math.max(jjum.lastMentioned, turn.at ?? turn.receivedAt);
        }
        Object.assign(jjum, appendMentionHistory(jjum, additions, chunkSize));
        if (created.has(jjum.jjumId)) jjum.mentionCount = Math.max(1, [...byKey.values()].filter((mention) => mention.counted).length);
        all.set(jjum.jjumId, jjum);
        changed.set(jjum.jjumId, jjum);
        related.set(jjum.jjumId, [...(related.get(jjum.jjumId) ?? []), ...(draft.relatedNames ?? [])]);
      }

      const content = [...changed.values()];
      const summarized: JJum[] = [];
      let failedSummaries = 0;
      for (const candidate of content) {
        assertCurrent();
        const original = originals.get(candidate.jjumId);
        const contentChanged = !original || layaContentSnapshot(original) !== layaContentSnapshot(candidate);
        let jjum = candidate;
        if (contentChanged) {
          [jjum] = await summarizeJJums(aiAdapter, [candidate], options?.summarizeHint);
          // 요약 helper의 일반 오류 대체와 별개로 오래된 작업은 저장하지 않는다.
          assertCurrent();
          if (jjum === candidate) failedSummaries++;
        }
        const evidence = [...(evidenceByJJum.get(jjum.jjumId)?.values() ?? [])];
        if (contentChanged || (requestedReviews.has(jjum.jjumId) && evidence.length > 0)) {
          invalidateReview(jjum.jjumId);
          jjum = {
            ...jjum,
            layaTag: pendingLayaTag(now, contentChanged
              ? '새로 생성되거나 수정된 쩜의 검토를 기다립니다.'
              : '새 대화 근거에 따른 재검토를 기다립니다.'),
            editHistory: [...jjum.editHistory, {
              date: now,
              action: original ? (contentChanged ? 'conversation_update' : 'laya_review_requested') : 'conversation_create',
              by: 'ai',
              memo: updateMemos.get(jjum.jjumId) ?? (contentChanged
                ? '확정 발화의 근거를 반영하고 기존 사실과 출처를 보존했습니다.'
                : '새 확정 발화의 근거로 Laya 재검토를 요청했습니다.'),
              evidence: { conversationId: prepared.conversationId, utteranceIds: evidence.map((turn) => turn.utteranceId) },
              reviewRequested: true,
            }],
          };
          reviewTargets.set(jjum.jjumId, evidence);
        }
        summarized.push(jjum);
      }
      const savedIds = new Set<string>();
      if (summarized.length > 0) {
        await savePlannedJJums(summarized);
        for (const jjum of summarized) {
          all.set(jjum.jjumId, jjum);
          savedIds.add(jjum.jjumId);
        }
      }

      assertCurrent();
      // 이 단계에 도달하면 모든 새 쩜이 저장되어 임시 ID를 가리키는 쩜선이 남지 않는다.
      const connections = new Map<string, JJum>();
      const connect = (sourceId: string, targetId: string, evidence: PreparedConversationTurn[]): void => {
        const source = all.get(sourceId)!;
        if (source.seons.some((seon) => seon.targetId === targetId && !seon.label)) return;
        const updated = { ...source, seons: [...source.seons] };
        upsertSeon(updated, targetId, 1, undefined, now);
        invalidateReview(sourceId);
        updated.layaTag = pendingLayaTag(now, '대화 근거로 연결 정보가 바뀌어 검토를 기다립니다.');
        const combinedEvidence = new Map<string, PreparedConversationTurn>();
        for (const turn of [
          ...(reviewTargets.get(sourceId) ?? []),
          ...(evidenceByJJum.get(sourceId)?.values() ?? []),
          ...evidence,
        ]) combinedEvidence.set(turn.utteranceId, turn);
        updated.editHistory = [...updated.editHistory, {
          date: now, action: 'conversation_relation_update', by: 'ai',
          memo: '확정 발화의 근거로 쩜선 연결을 추가했습니다.',
          ...(combinedEvidence.size > 0 ? {
            evidence: { conversationId: prepared.conversationId, utteranceIds: [...combinedEvidence.keys()] },
          } : {}),
          reviewRequested: true,
        }];
        reviewTargets.set(sourceId, [...combinedEvidence.values()]);
        all.set(sourceId, updated);
        connections.set(sourceId, updated);
      };
      for (const [sourceId, names] of related) {
        for (const name of names) {
          const targets = matches(name);
          if (targets.length !== 1 || targets[0].jjumId === sourceId) continue;
          const evidence = [...(evidenceByJJum.get(sourceId)?.values() ?? [])];
          // 부분 저장의 재시도라면 이미 저장된 발화 근거로 빠진 연결만 복구한다.
          const relationEvidence = evidence.length > 0 ? evidence : prepared.turns.filter((turn) =>
            turn.final && [...iterateMentionHistory(all.get(sourceId)!)].some((mention) =>
              mention.conversationId === prepared.conversationId && mention.utteranceId === turn.utteranceId));
          connect(sourceId, targets[0].jjumId, relationEvidence);
          connect(targets[0].jjumId, sourceId, relationEvidence);
        }
      }
      if (connections.size > 0) {
        await savePlannedJJums([...connections.values()]);
        for (const id of connections.keys()) savedIds.add(id);
      }
      assertCurrent();
      if (options?.reviewEngine) {
        for (const [jjumId, evidence] of reviewTargets) {
          assertCurrent();
          reviewIntents.set(jjumId, captureLayaReviewIntent(storageAdapter, all.get(jjumId)!, evidence));
        }
      }
      return { storedCount: savedIds.size, failedSummaries, receipt };
    });
    // 모델 실행 중 소유자 잠금을 잡지 않는다. 서비스가 결과 저장 직전 현재 내용을 다시 확인한다.
    for (const [jjumId, intent] of reviewIntents) {
      assertCurrent();
      await reviewStoredJJum(storageAdapter, options?.reviewEngine, ownerId, jjumId, intent, undefined, options?.isCurrent);
      assertCurrent();
    }
    assertCurrent();
    return result;
  } catch (cause) {
    throw new ConversationProcessingError(receipt,
      options?.isCurrent && !options.isCurrent() ? new ConversationSupersededError() : cause);
  }
}
