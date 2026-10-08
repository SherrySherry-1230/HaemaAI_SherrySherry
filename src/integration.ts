// @editedBy SherrySherry 2026-10-08
/**
 * 대화-추출-저장 통합 파이프라인 (HaemaAI_SherrySherry/src/)
 *
 * 흐름: extractJJums → createJJum → summarizeJJum → putJJums
 *
 * 용어 규칙 (구용어 금지):
 * - HCell/Cell/Tail 사용 금지
 * - JJum / jjum / Seon 만 사용
 * - 점 → 쩜, 선 → 쩜선
 */

import type {
  AIAdapter,
  ExtractRequest,
  ExtractedDraft,
} from './adapters/aiAdapter.ts';
import type { StorageAdapter } from './adapters/storageAdapter.ts';
import { createJJum } from './createJJum.ts';
import { upsertSeon } from './seons.ts';
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
    maxMentionHistoryEntries?: number;
  },
): Promise<ConversationProcessingResult> {
  if (ownerId !== extractReq.ownerId) throw new Error('Conversation ownerId must match request ownerId');
  const now = extractReq.now ?? Date.now();
  const prepared = prepareConversationRequest({ ...extractReq, now });
  const receipt = conversationReceipt(prepared);
  try {
    const limit = options?.maxMentionHistoryEntries ?? 10_000;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid mention history limit');
    return await withConversationLock(storageAdapter, ownerId, async () => {
      const stored = await storageAdapter.listJJums(ownerId);
      const turns = new Map(prepared.turns.map((turn) => [turn.utteranceId, turn]));
      // 비활성 쩜의 기록도 확인하여 같은 ID로 확정 발화를 바꾸지 못하게 한다.
      for (const jjum of stored) {
        for (const mention of jjum.mentionHistory ?? []) {
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
      const drafts = await extractJJums(aiAdapter, { ...prepared, knownNames });
      if (!Array.isArray(drafts)) throw new Error('AI drafts must be an array');
      const all = new Map(current.map((jjum) => [jjum.jjumId, jjum]));
      const changed = new Map<string, JJum>();
      const created = new Set<string>();
      const related = new Map<string, string[]>();
      const persisted = new Map(stored.map((jjum) => [jjum.jjumId,
        new Set((jjum.mentionHistory ?? []).map((mention) => mentionKey(mention.conversationId, mention.utteranceId))),
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
            editHistory: [...existing.editHistory, { date: now, action: 'conversation_update', by: 'ai' }],
          };
        } else {
          jjum = fresh;
          created.add(jjum.jjumId);
        }
        const history = [...(jjum.mentionHistory ?? [])];
        const byKey = new Map(history.map((mention) => [mentionKey(mention.conversationId, mention.utteranceId), mention]));
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
          history.push(mention);
          byKey.set(key, mention);
          if (!created.has(jjum.jjumId) && mention.counted) jjum.mentionCount += 1;
          if (turn.role === 'user') jjum.lastMentioned = Math.max(jjum.lastMentioned, turn.at ?? turn.receivedAt);
        }
        jjum.mentionHistory = history;
        if (created.has(jjum.jjumId)) jjum.mentionCount = Math.max(1, history.filter((mention) => mention.counted).length);
        all.set(jjum.jjumId, jjum);
        changed.set(jjum.jjumId, jjum);
        related.set(jjum.jjumId, [...(related.get(jjum.jjumId) ?? []), ...(draft.relatedNames ?? [])]);
      }

      // 전체 변경의 이력 상한을 저장 전에 확인하고 기존 이력은 잘라내지 않는다.
      for (const jjum of changed.values()) {
        const length = jjum.mentionHistory?.length ?? 0;
        if (length > limit && length > (persisted.get(jjum.jjumId)?.size ?? 0)) {
          throw new Error('Mention history limit exceeded');
        }
      }
      const content = [...changed.values()];
      const summarized = await summarizeJJums(aiAdapter, content, options?.summarizeHint);
      const failedSummaries = summarized.filter((jjum, index) => jjum === content[index]).length;
      const savedIds = new Set<string>();
      if (summarized.length > 0) {
        await putJJums(storageAdapter, ownerId, summarized);
        for (const jjum of summarized) {
          all.set(jjum.jjumId, jjum);
          savedIds.add(jjum.jjumId);
        }
      }

      // 이 단계에 도달하면 모든 새 쩜이 저장되어 임시 ID를 가리키는 쩜선이 남지 않는다.
      const connections = new Map<string, JJum>();
      const connect = (sourceId: string, targetId: string): void => {
        const source = all.get(sourceId)!;
        if (source.seons.some((seon) => seon.targetId === targetId && !seon.label)) return;
        const updated = { ...source, seons: [...source.seons] };
        upsertSeon(updated, targetId, 1, undefined, now);
        all.set(sourceId, updated);
        connections.set(sourceId, updated);
      };
      for (const [sourceId, names] of related) {
        for (const name of names) {
          const targets = matches(name);
          if (targets.length !== 1 || targets[0].jjumId === sourceId) continue;
          connect(sourceId, targets[0].jjumId);
          connect(targets[0].jjumId, sourceId);
        }
      }
      if (connections.size > 0) {
        await putJJums(storageAdapter, ownerId, [...connections.values()]);
        for (const id of connections.keys()) savedIds.add(id);
      }
      return { storedCount: savedIds.size, failedSummaries, receipt };
    });
  } catch (cause) {
    throw new ConversationProcessingError(receipt, cause);
  }
}
