// @editedBy SherrySherry 2026-10-12
/** 쩜의 내용 검토. 처리 상태와 판정을 구별하며 검토용 버전·해시는 저장하지 않는다. */
import type { ConversationTurn } from './adapters/aiAdapter.ts';
import type { StorageAdapter } from './adapters/storageAdapter.ts';
import { withConversationLock } from './conversationIdentity.ts';
import type { JJum, LayaTag, LayaVerdict } from './types/jjum.ts';

export interface LayaReviewRequest {
  jjum: JJum;
  turns: ConversationTurn[];
}

export interface LayaReviewResult {
  verdict: LayaVerdict;
  reason: string;
}

export interface LayaReviewEngine {
  reviewJJum(request: LayaReviewRequest): Promise<LayaReviewResult>;
}

export function isLayaReviewText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 500;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59
    || Number(second) > 59) return false;
  return zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59);
}

function isVerdict(value: unknown): value is LayaVerdict {
  return value === '정상' || value === '이상함' || value === '정보 부족';
}

export function isLayaTag(value: unknown): value is LayaTag {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const tag = value as Record<string, unknown>;
  if (!isLayaReviewText(tag.reason) || !validTimestamp(tag.timestamp)) return false;
  if (tag.state === 'reviewed') return isVerdict(tag.verdict);
  return (tag.state === 'pending' || tag.state === 'failed') && !Object.hasOwn(tag, 'verdict');
}

/** 같은 순간을 한국 시간의 날짜·시각과 명시적인 시간대로 표시한다. */
function reviewTimestamp(now: number): string {
  return new Date(now + 9 * 60 * 60 * 1_000).toISOString().replace(/Z$/, '+09:00');
}

export function pendingLayaTag(now: number, reason = '내용이 수정되어 다시 검토해야 합니다.'): LayaTag {
  if (!Number.isFinite(now) || now < 0 || !isLayaReviewText(reason)) {
    throw new Error('Invalid Laya review timestamp or reason');
  }
  return { state: 'pending', reason, timestamp: reviewTimestamp(now) };
}

/** 객체 키 순서는 무시하고 배열 순서와 내용은 그대로 비교한다. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/** 통계·검토 기록·서비스 확장 정보는 검토 대상 내용의 변경으로 보지 않는다. */
export function layaContentSnapshot(jjum: JJum): string {
  return JSON.stringify(canonical({
    jjumName: jjum.jjumName,
    aliases: jjum.aliases,
    type: jjum.type,
    jjtags: jjum.jjtags,
    summary: jjum.summary,
    facts: jjum.facts.map(({ text, addedAt, source }) => ({ text, addedAt, source })),
    events: jjum.events.map(({ date, summary, refJJumIds }) => ({ date, summary, refJJumIds })),
    context: jjum.context,
    seons: jjum.seons.map(({ targetId, label }) => ({ targetId, label })),
  }));
}

interface ReviewFlight {
  snapshot: string;
  pending: string;
}

const flights = new WeakMap<object, Map<string, ReviewFlight>>();
const queued = new WeakMap<object, Map<string, object>>();
const intentBrand: unique symbol = Symbol('LayaReviewIntent');

/** 저장 잠금 안에서 만든 검토 요청. 저장하거나 호출자가 직접 구성하지 않는다. */
export interface LayaReviewIntent {
  readonly [intentBrand]: true;
}

interface CapturedReview {
  scope: object;
  key: string;
  token: object;
  snapshot: string;
  pending: string;
  turns: ConversationTurn[];
}

const intents = new WeakMap<LayaReviewIntent, CapturedReview>();

function queuedReviews(scope: object): Map<string, object> {
  let pending = queued.get(scope);
  if (!pending) {
    pending = new Map();
    queued.set(scope, pending);
  }
  return pending;
}

function reviewToken(scope: object, key: string): object {
  const pending = queuedReviews(scope);
  const token = pending.get(key) ?? {};
  pending.set(key, token);
  return token;
}

/** 저장한 내용·대기 태그·발화 근거를 묶어, 잠금을 놓은 뒤의 새 수정과 구별한다. */
export function captureLayaReviewIntent(
  storage: StorageAdapter,
  jjum: JJum,
  turns: ConversationTurn[],
): LayaReviewIntent {
  if (jjum.layaTag?.state !== 'pending' || !isLayaTag(jjum.layaTag)) {
    throw new Error('Laya review intent requires a valid pending tag');
  }
  const scope = storage.coordinationScope ?? storage;
  const key = JSON.stringify([jjum.ownerId, jjum.jjumId]);
  const intent: LayaReviewIntent = { [intentBrand]: true };
  intents.set(intent, {
    scope, key, token: reviewToken(scope, key),
    snapshot: layaContentSnapshot(jjum),
    pending: JSON.stringify(canonical(jjum.layaTag)),
    turns: structuredClone(turns),
  });
  return intent;
}

/** 같은 시각에 내용을 바꿨다가 되돌려도 진행 중이던 응답을 적용하지 않게 한다. */
export function invalidateLayaReview(storage: StorageAdapter, ownerId: string, jjumId: string): void {
  const scope = storage.coordinationScope ?? storage;
  const key = JSON.stringify([ownerId, jjumId]);
  flights.get(scope)?.delete(key);
  queued.get(scope)?.delete(key);
}

/** AI 대기 중에는 소유자 잠금을 놓고, 결과를 반영할 때 최신 내용을 다시 확인한다. */
export async function reviewStoredJJum(
  storage: StorageAdapter,
  engine: LayaReviewEngine | undefined,
  ownerId: string,
  jjumId: string,
  turns: ConversationTurn[] | LayaReviewIntent,
  now?: number,
): Promise<void> {
  if (!engine) return;
  const key = JSON.stringify([ownerId, jjumId]);
  const scope = storage.coordinationScope ?? storage;
  const requested = Array.isArray(turns) ? undefined : intents.get(turns);
  if (!Array.isArray(turns) && !requested) throw new Error('Unknown Laya review intent');
  if (requested && (requested.scope !== scope || requested.key !== key)) return;
  const token = requested?.token ?? reviewToken(scope, key);
  const evidence = requested?.turns ?? structuredClone(turns as ConversationTurn[]);
  const active = flights.get(scope) ?? new Map<string, ReviewFlight>();
  flights.set(scope, active);
  const claim = await withConversationLock(storage, ownerId, async () => {
    const current = await storage.getJJum(ownerId, jjumId);
    if (queued.get(scope)?.get(key) !== token
      || !current || current.ownerId !== ownerId || current.jjumId !== jjumId
      || current.layaTag?.state !== 'pending') return undefined;
    if (!isLayaTag(current.layaTag)) throw new Error('Stored Laya review is invalid');
    const snapshot = layaContentSnapshot(current);
    const pending = JSON.stringify(canonical(current.layaTag));
    if (requested && (requested.snapshot !== snapshot || requested.pending !== pending)) return undefined;
    const previous = active.get(key);
    if (previous?.snapshot === snapshot && previous.pending === pending) return undefined;
    const flight: ReviewFlight = { snapshot, pending };
    const copy = structuredClone(current);
    active.set(key, flight);
    return { current: copy, flight };
  });
  if (!claim) return;
  try {
    let result: LayaReviewResult | undefined;
    try {
      const response: unknown = await engine.reviewJJum({
        jjum: claim.current,
        turns: evidence.map((turn) => ({ ...turn })),
      });
      if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
        const candidate = response as Record<string, unknown>;
        if (isVerdict(candidate.verdict) && isLayaReviewText(candidate.reason)) {
          result = { verdict: candidate.verdict, reason: candidate.reason };
        }
      }
    } catch {
      // 외부 오류 원문에는 비공개 입력이 섞일 수 있어 저장하지 않는다.
    }
    await withConversationLock(storage, ownerId, async () => {
      const current = await storage.getJJum(ownerId, jjumId);
      if (active.get(key) !== claim.flight || !current || current.ownerId !== ownerId
        || current.jjumId !== jjumId || current.layaTag?.state !== 'pending'
        || layaContentSnapshot(current) !== claim.flight.snapshot
        || JSON.stringify(canonical(current.layaTag)) !== claim.flight.pending) return;
      const timestamp = reviewTimestamp(now ?? Date.now());
      const layaTag: LayaTag = result
        ? { ...current.layaTag, state: 'reviewed', ...result, timestamp }
        : { ...current.layaTag, state: 'failed', reason: '검토 결과를 확인하지 못했습니다. 새 근거에 따른 수정 후 다시 검토합니다.', timestamp };
      if (storage.compareAndSetLayaTag) {
        await storage.compareAndSetLayaTag(ownerId, jjumId, claim.flight.snapshot, current.layaTag, layaTag);
      } else {
        // 조건부 갱신이 없는 저장소는 같은 소유자 잠금에 참여하는 쓰기 범위에서 보호한다.
        await storage.putJJum(ownerId, { ...current, layaTag });
      }
    });
  } finally {
    if (active.get(key) === claim.flight) {
      active.delete(key);
      if (queued.get(scope)?.get(key) === token) queued.get(scope)?.delete(key);
    }
  }
}
