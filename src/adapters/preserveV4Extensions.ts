// @editedBy SherrySherry 2026-11-06
/** 읽기 투영에 노출하지 않고, 파일 갱신 시 기존 v4 확장 정보만 보존한다. */
import { isDeepStrictEqual } from 'node:util';
import type { JJum } from '../types/jjum.ts';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const ROOT_KEYS = new Set([
  'jjumId', 'jjumName', 'aliases', 'type', 'jjtags', 'tags', 'summary', 'facts', 'events', 'context',
  'seons', 'mentionCount', 'mentionHistory', 'mentionHistoryChunks', 'firstSeen', 'lastMentioned',
  'recallCount', 'lastRecalled', 'pinned', 'status', 'mergedFrom', 'mergedInto', 'editHistory',
  'layaTag', 'responseFeedback', 'meta', 'ownerId', 'sourceService', 'schemaVersion',
]);

export class V4ExtensionPreservationError extends Error {
  constructor(field: string) {
    super(`Cannot safely preserve stored v4 extensions in ${field}; explicit reconciliation is required`);
    this.name = 'V4ExtensionPreservationError';
  }
}
const fail = (field: string): never => { throw new V4ExtensionPreservationError(field); };
const extensions = (value: RecordValue, known: ReadonlySet<string>): RecordValue =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)));
const projection = (value: RecordValue, known: ReadonlySet<string>): RecordValue =>
  Object.fromEntries(Object.entries(value).filter(([key]) => known.has(key)));

function restore(previous: RecordValue, next: RecordValue, known: ReadonlySet<string>, field: string): RecordValue {
  const extra = extensions(previous, known);
  for (const [key, value] of Object.entries(extra)) {
    // 알려지지 않은 값의 변경/삭제 의도를 추정하지 않는다. 누락은 기존 원본을 유지한다.
    if (Object.hasOwn(next, key) && next[key] !== undefined && !isDeepStrictEqual(next[key], value)) fail(field);
  }
  return { ...next, ...extra };
}

interface ArrayContract {
  field: 'facts' | 'events' | 'seons' | 'responseFeedback';
  keys: string[];
  identity?: (item: RecordValue) => string | undefined;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const CONTRACTS: ArrayContract[] = [
  // 사실도 생성 시각/출처만으로 같은 객체라고 추정하지 않는다.
  { field: 'facts', keys: ['text', 'addedAt', 'source'] },
  // 사건은 변경 가능한 날짜/내용만 있고 안정적인 ID가 없다. 동일 내용만 안전하게 대응한다.
  { field: 'events', keys: ['date', 'summary', 'refJJumIds'] },
  { field: 'seons', keys: ['targetId', 'weight', 'label', 'lastActivated'], identity: item =>
    text(item.targetId) ? item.targetId : undefined },
  { field: 'responseFeedback', keys: ['timestamp', 'result', 'cues', 'responseId'], identity: item =>
    text(item.responseId) ? item.responseId : undefined },
];

function restoreArray(previous: unknown, next: unknown, contract: ArrayContract): unknown {
  const known = new Set(contract.keys);
  if (!Array.isArray(previous)) {
    if (object(previous) && Object.keys(extensions(previous, known)).length > 0) return fail(contract.field);
    return next;
  }
  const old = previous.filter(object);
  const extended = old.filter(item => Object.keys(extensions(item, known)).length > 0);
  if (!extended.length) return next;
  // 관용적 검증기가 제외한 손상 항목은 호출자의 명시 삭제와 구별할 수 없다.
  const requiredText = contract.field === 'facts' ? 'text' : contract.field === 'events' ? 'summary'
    : contract.field === 'seons' ? 'targetId' : undefined;
  if (requiredText && extended.some(item => typeof item[requiredText] !== 'string')) return fail(contract.field);
  // 명시적으로 비운 목록은 삭제다. 생략/잘못된 형식은 삭제로 추정하지 않는다.
  if (!Array.isArray(next)) return fail(contract.field);
  if (next.length === 0) return [];
  const result = next.map(item => object(item) ? { ...item } : item);
  const matches = new Map<RecordValue, number>();
  const consumed = new Set<number>();
  // 모든 항목을 먼저 대응하여 새 항목과 실제 삭제를 구분한다. 배열 위치는 사용하지 않는다.
  for (const item of old) {
    const candidates = next.flatMap((candidate, index) => object(candidate)
      && isDeepStrictEqual(projection(item, known), projection(candidate, known)) ? [index] : []);
    if (candidates.length === 1 && !consumed.has(candidates[0])) {
      const duplicateOld = old.filter(other => isDeepStrictEqual(projection(item, known), projection(other, known))).length > 1;
      if (!duplicateOld) { matches.set(item, candidates[0]); consumed.add(candidates[0]); }
    }
  }
  for (const item of old) {
    if (matches.has(item)) continue;
    const id = contract.identity?.(item);
    if (id === undefined || old.filter(other => contract.identity?.(other) === id).length !== 1) continue;
    const candidates = next.flatMap((candidate, index) => object(candidate) && contract.identity?.(candidate) === id ? [index] : []);
    if (candidates.length === 1 && !consumed.has(candidates[0])) {
      matches.set(item, candidates[0]); consumed.add(candidates[0]);
    }
  }
  for (const item of extended) {
    const index = matches.get(item);
    if (index !== undefined) {
      result[index] = restore(item, result[index] as RecordValue, known, contract.field);
      continue;
    }
    // 남은 새 항목이 있으면 변경/대체/새 생성 중 무엇인지 안전하게 판별할 수 없다.
    if (next.some((_, index) => !consumed.has(index))) return fail(contract.field);
    // 대응이 모호한 기존 중복을 삭제로 처리하지 않는다.
    if (next.some(candidate => object(candidate) && (isDeepStrictEqual(projection(item, known), projection(candidate, known))
      || contract.identity?.(item) !== undefined && contract.identity?.(candidate) === contract.identity?.(item)))) return fail(contract.field);
    // 나머지 모든 새 항목은 다른 기존 항목과 대응하므로 이 항목의 삭제만 반영한다.
  }
  return result;
}

/** 호출자가 저장 직전 읽은 원문만 사용한다. 반환값은 디스크 저장용이며 모델/API에 전달하지 않는다. */
export function preserveStoredV4Extensions(previous: unknown, next: JJum): JJum {
  // 버전 부재/문자열/구버전의 기존 정규화 계약은 이번 명시적 v4 보존 경로로 바꾸지 않는다.
  if (!object(previous) || previous.schemaVersion !== 4) return next;
  if (typeof previous.ownerId !== 'string' || previous.ownerId.trim() !== next.ownerId
    || typeof previous.jjumId !== 'string' || previous.jjumId.trim() !== next.jjumId
    || next.schemaVersion !== 4) return fail('identity');
  const result = restore(previous, next as unknown as RecordValue, ROOT_KEYS, 'record');
  for (const contract of CONTRACTS) {
    if (Object.hasOwn(previous, contract.field)) result[contract.field] = restoreArray(previous[contract.field], result[contract.field], contract);
  }
  return result as unknown as JJum;
}
