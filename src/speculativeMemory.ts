// @editedBy SherrySherry 2026-10-16
/**
 * 입력 관찰용 기억 탐색. 실제 저장 자료와 문자열 단서를 사용하며 AI를 호출하지 않는다.
 * 결과의 0~1 값은 기존 recall의 잠정 검색 점수다. 확정 R이나 직접 언급 5점이 아니다.
 * 문장부호와 이름 접두어는 구조적 후보를 준비하는 기준이며 의미 완결을 확정하지 않는다.
 */
import type { StorageAdapter } from './adapters/storageAdapter.ts';
import type { JJum } from './types/jjum.ts';
import type { IncrementalConversationWork, SpeculativeResult } from './incrementalConversation.ts';
import { recall } from './recall.ts';

interface SearchSpan { start: number; end: number }
interface SearchCache {
  scope: string;
  text: string;
  hits: Map<string, SearchSpan[]>;
}

const normalized = (text: string): string => text.toLowerCase();

function assertCurrent(work: IncrementalConversationWork): void {
  if (work.signal.aborted || !work.isCurrent()) {
    const error = new Error('Speculative memory work is no longer current');
    error.name = 'AbortError';
    throw error;
  }
}

function difference(before: string, after: string): { start: number; removed: number; inserted: number } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  return { start, removed: endBefore - start, inserted: endAfter - start };
}

function findSpans(text: string, label: string, first = 0, last = text.length): SearchSpan[] {
  const spans: SearchSpan[] = [];
  let offset = text.indexOf(label, first);
  while (offset !== -1 && offset < last) {
    spans.push({ start: offset, end: offset + label.length });
    offset = text.indexOf(label, offset + 1);
  }
  return spans;
}

/** Search positions are reusable raw lookup material. Scores are never cached. */
function updateSearch(cache: SearchCache | undefined, scope: string, text: string, labels: Set<string>): SearchCache {
  const previous = cache?.scope === scope ? cache : undefined;
  const change = difference(previous?.text ?? '', text);
  const shift = change.inserted - change.removed;
  const hits = new Map<string, SearchSpan[]>();
  for (const label of labels) {
    const old = previous?.hits.get(label);
    if (!old) {
      hits.set(label, findSpans(text, label));
      continue;
    }
    if (change.removed === 0 && change.inserted === 0) {
      hits.set(label, old);
      continue;
    }
    // A label crossing either edit edge may change even if only one character changed.
    const first = Math.max(0, change.start - label.length + 1);
    const oldLast = change.start + change.removed;
    const newLast = change.start + change.inserted;
    const retained = old.filter((hit) => hit.start < first || hit.start >= oldLast)
      .map((hit) => hit.start >= oldLast
        ? { start: hit.start + shift, end: hit.end + shift }
        : hit);
    const revised = findSpans(text, label, first, newLast);
    hits.set(label, [...retained, ...revised].sort((a, b) => a.start - b.start));
  }
  return { scope, text, hits };
}

function readOnlyView(ownerId: string, active: JJum[], work: IncrementalConversationWork): StorageAdapter {
  function check(owner: string): void {
    assertCurrent(work);
    if (owner !== ownerId) throw new Error('Speculative memory owner mismatch');
  }
  function noWrite(): never {
    throw new Error('Speculative memory does not write stored memories');
  }
  return {
    async listJJums(owner) { check(owner); return active; },
    async getJJum(owner, id) { check(owner); return active.find((item) => item.jjumId === id) ?? null; },
    async findByName(owner, name) {
      check(owner);
      const label = normalized(name);
      return active.filter((item) => [item.jjumName, ...item.aliases].some((value) => normalized(value) === label));
    },
    async countJJums(owner) { check(owner); return active.length; },
    putJJum: noWrite,
    putJJums: noWrite,
    patchJJum: noWrite,
    deleteJJum: noWrite,
    touchJJum: noWrite,
    decayWeights: noWrite,
  };
}

/** One explorer is normally retained with one incremental conversation session. */
export class SpeculativeMemoryExplorer {
  private readonly storage: StorageAdapter;
  private readonly ownerId: string;
  private cache: SearchCache | undefined;

  constructor(storage: StorageAdapter, ownerId: string) {
    this.storage = storage;
    this.ownerId = ownerId;
  }

  async analyze(work: IncrementalConversationWork): Promise<SpeculativeResult> {
    assertCurrent(work);
    if (work.ownerId !== this.ownerId) throw new Error('Speculative memory owner mismatch');
    // The text includes submitted context and the current unsubmitted draft, never a forecast.
    const text = normalized(work.turns.map((turn) => turn.text).join('\n'));
    const scope = JSON.stringify([work.ownerId, work.storageId, work.conversationId, work.sessionId]);
    const stored = await this.storage.listJJums(this.ownerId, { status: 'active' });
    assertCurrent(work);
    // Recheck scope/status even when a custom adapter fails to apply its query filter.
    const active = stored.filter((item) => item.ownerId === this.ownerId && item.status === 'active');
    const labels = new Set(active.flatMap((item) => [item.jjumName, ...item.aliases, ...item.jjtags])
      .map((label) => normalized(label.trim())).filter(Boolean));
    const nextCache = updateSearch(this.cache, scope, text, labels);
    const cues = new Set([...nextCache.hits].filter(([, hits]) => hits.length > 0).map(([label]) => label));

    // A previous fragment is reconsidered against actual text, not treated as new evidence.
    // Only labels still present in this work's actual context can become search cues.
    for (const fragment of work.previousFragments) {
      const observed = normalized(fragment.text);
      if (!observed || !text.includes(observed)) continue;
      for (const label of labels) {
        if (observed.includes(label) && nextCache.hits.get(label)?.length) cues.add(label);
      }
    }

    const current = work.turns.at(-1);
    const draft = current?.role === 'user' && current.final === false ? current.text.trim() : '';
    const candidates: NonNullable<SpeculativeResult['candidates']> = [];
    // This retains an observed text fragment, not an inferred fact or a stored JJum draft.
    if (draft && !/[.!?。！？…][\s"'”’）)]*$/u.test(draft)) {
      candidates.push({ text: draft, source: 'observed' });
    }
    const prefix = draft.match(/([가-힣]{2,})$/u)?.[1];
    if (prefix) {
      const predictions = new Set<string>();
      for (const item of active) {
        for (const name of [item.jjumName, ...item.aliases]) {
          const label = normalized(name.trim());
          if (!label.startsWith(prefix) || label === prefix || text.includes(label)) continue;
          predictions.add(name);
          cues.add(label);
        }
      }
      for (const prediction of predictions) candidates.push({ text: prediction, source: 'predicted' });
    }
    assertCurrent(work);
    // Use a fresh read-only view to avoid a second storage read and all statistics updates.
    const found = await recall(readOnlyView(this.ownerId, active, work), this.ownerId, [...cues], {
      touch: false,
      topicLimit: 0,
    });
    assertCurrent(work);
    this.cache = nextCache;
    return {
      scores: found.candidates.map((candidate) => ({ jjumId: candidate.jjum.jjumId, score: candidate.score })),
      retrievedIds: found.candidates.map((candidate) => candidate.jjum.jjumId),
      candidates,
    };
  }
}
