// @editedBy SherrySherry 2026-10-30
/** 계산된 독립 관계 근거를 양쪽 쩜에 적용한다. 저장은 호출자의 한 쌍 저장 흐름이 담당한다. */
import { isDeepStrictEqual } from 'node:util';
import type { ProfileCalculation, ProfileCalculationReference, SeonContribution, SeonKind } from './calculationProfiles.ts';
import { pendingLayaTag } from './layaReview.ts';
import type {
  CalculationRefV5, GeneralSeonV5, JJumV5, ParentChildSeonV5, SeonEvidenceV5, UpperLowerSeonV5,
} from './types/jjumV5.ts';
import { sumDecimalNumbers, V5CalculationError } from './v5Calculations.ts';

type Relation = GeneralSeonV5 | ParentChildSeonV5 | UpperLowerSeonV5;
const kinds: readonly SeonKind[] = ['general', 'parentChild', 'upperLower'];
export type SeonEvidenceInputV5 = Omit<SeonEvidenceV5, 'delta' | 'calculationRef'>;
export interface ApplySeonEvidenceInputV5 {
  source: JJumV5;
  target: JJumV5;
  kind: SeonKind;
  seonId: string;
  label: string;
  evidence: SeonEvidenceInputV5;
  calculation: ProfileCalculation<SeonContribution>;
  now?: number;
}
export type AppliedSeonEvidenceV5 = { status: 'ready'; source: JJumV5; target: JJumV5; changed: boolean }
  | { status: 'pending'; reasons: string[] };

function required(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new V5CalculationError('invalid', `${field} is required`);
}
function timestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
    throw new V5CalculationError('invalid', 'A valid integer timestamp is required');
  }
}
function nonnegative(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new V5CalculationError('invalid', 'Seon contributions and totals must be finite and nonnegative');
}
function ref(value: ProfileCalculationReference): CalculationRefV5 {
  required(value.profileId, 'Profile ID'); required(value.profileVersion, 'Profile version'); required(value.rule, 'Calculation rule');
  required(value.coefficientDigest, 'Coefficient digest'); required(value.ruleVersion, 'Calculation rule version');
  if (value.packageVersion !== undefined) required(value.packageVersion, 'Package version');
  return { profileId: value.profileId, profileVersion: value.profileVersion, rule: value.rule,
    coefficientDigest: value.coefficientDigest, ruleVersion: value.ruleVersion,
    ...(value.packageVersion !== undefined ? { packageVersion: value.packageVersion } : {}) };
}
function validateProfileIntegrity(jjums: readonly JJumV5[], incoming: CalculationRefV5): void {
  const digests = new Map<string, string>();
  const check = (value: CalculationRefV5) => {
    const reference = ref(value), key = JSON.stringify([reference.profileId, reference.profileVersion]);
    const digest = digests.get(key);
    if (digest !== undefined && digest !== reference.coefficientDigest) {
      throw new V5CalculationError('integrity', 'The same profile version contains different coefficients');
    }
    digests.set(key, reference.coefficientDigest);
  };
  check(incoming);
  for (const jjum of jjums) for (const kind of kinds) for (const relation of jjum.seons?.[kind] ?? []) {
    for (const item of relation.history) if (item.calculationRef) check(item.calculationRef);
  }
}
function entry(input: SeonEvidenceInputV5, delta: number, calculationRef: CalculationRefV5): SeonEvidenceV5 {
  for (const field of ['evidenceId', 'conversationId', 'utteranceId', 'hostChatbotId'] as const) required(input[field], field);
  timestamp(input.timestamp); nonnegative(delta);
  if (input.occurredAt !== undefined) timestamp(input.occurredAt);
  if (input.replacesEvidenceId !== undefined) required(input.replacesEvidenceId, 'Replaced evidence ID');
  return { evidenceId: input.evidenceId, conversationId: input.conversationId, utteranceId: input.utteranceId,
    hostChatbotId: input.hostChatbotId, timestamp: input.timestamp, delta, calculationRef,
    ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
    ...(input.replacesEvidenceId !== undefined ? { replacesEvidenceId: input.replacesEvidenceId } : {}) };
}
function lookup(jjum: JJumV5, seonId: string, expectedKind: SeonKind): Relation | undefined {
  let found: Relation | undefined;
  for (const kind of kinds) for (const relation of jjum.seons?.[kind] ?? []) {
    if (relation.seonId !== seonId) continue;
    if (found || kind !== expectedKind) throw new V5CalculationError('conflict', 'Seon ID is duplicated or has another relationship kind');
    found = relation;
  }
  return found;
}
function total(history: SeonEvidenceV5[]): number {
  const ids = new Set<string>(), replaced = new Set<string>();
  for (const item of history) {
    for (const field of ['evidenceId', 'conversationId', 'utteranceId', 'hostChatbotId'] as const) required(item[field], field);
    timestamp(item.timestamp);
    if (item.occurredAt !== undefined) timestamp(item.occurredAt);
    if (!Number.isFinite(item.delta)) throw new V5CalculationError('invalid', 'Stored evidence contribution must be finite');
    if (ids.has(item.evidenceId)) throw new V5CalculationError('conflict', 'Evidence IDs must be unique within a relation');
    if (item.calculationRef) ref(item.calculationRef);
    if (item.replacesEvidenceId !== undefined) {
      if (!ids.has(item.replacesEvidenceId) || replaced.has(item.replacesEvidenceId)) {
        throw new V5CalculationError('conflict', 'Correction must replace earlier effective evidence without cycles or branching');
      }
      replaced.add(item.replacesEvidenceId);
    }
    ids.add(item.evidenceId);
  }
  const result = sumDecimalNumbers(history.filter(item => !replaced.has(item.evidenceId)).map(item => item.delta));
  nonnegative(result);
  return result;
}
function weight(relation: Relation): number { return 'receivedWeight' in relation ? relation.receivedWeight : relation.weight; }
function validateRelation(relation: Relation, kind: SeonKind, otherId: string, label: string, source: boolean): void {
  if (relation.targetId !== otherId || relation.label !== label) throw new V5CalculationError('conflict', 'Seon ID has different endpoints or label');
  const expectedRole = kind === 'parentChild' ? (source ? 'parent' : 'child') : kind === 'upperLower' ? (source ? 'upper' : 'lower') : undefined;
  if (('role' in relation ? relation.role : undefined) !== expectedRole) throw new V5CalculationError('conflict', 'Directed relationship roles do not match the supplied order');
  if ((kind === 'upperLower') !== ('receivedWeight' in relation)) throw new V5CalculationError('invalid', 'Relationship weight shape does not match its kind');
  if (!Array.isArray(relation.history) || !relation.history.length) throw new V5CalculationError('invalid', 'Existing relation requires evidence history');
  if (relation.lastActivated !== undefined) timestamp(relation.lastActivated);
  const actual = total(relation.history), stored = weight(relation);
  nonnegative(stored);
  const tolerance = Number.EPSILON * Math.max(1, actual, stored) * Math.max(4, relation.history.length * 4);
  if (Math.abs(actual - stored) > tolerance) throw new V5CalculationError('integrity', 'Stored seon total does not match effective evidence');
}
function metadata(item: SeonEvidenceV5): Omit<SeonEvidenceV5, 'delta'> {
  const { delta: _delta, ...rest } = item; return rest;
}
function validatePair(source: Relation, target: Relation, kind: SeonKind): void {
  if (source.history.length !== target.history.length || source.history.some((item, index) =>
    !isDeepStrictEqual(metadata(item), metadata(target.history[index]))
    || (kind !== 'upperLower' && item.delta !== target.history[index].delta))) {
    throw new V5CalculationError('conflict', 'Relationship counterpart evidence does not match');
  }
  if (kind !== 'upperLower' && weight(source) !== weight(target)) throw new V5CalculationError('conflict', 'Shared relationship weights do not match');
}
function relation(kind: SeonKind, original: Relation | undefined, otherId: string, seonId: string,
  label: string, history: SeonEvidenceV5[], source: boolean, activated: number): Relation {
  const common = { ...original, seonId, targetId: otherId, label, history,
    lastActivated: Math.max(original?.lastActivated ?? 0, activated) };
  const value = total(history);
  if (kind === 'general') return { ...common, weight: value };
  if (kind === 'parentChild') return { ...common, role: source ? 'parent' : 'child', weight: value };
  return { ...common, role: source ? 'upper' : 'lower', receivedWeight: value };
}
function setRelation(jjum: JJumV5, kind: SeonKind, value: Relation): void {
  const seons = jjum.seons ??= {};
  // 종류와 역할은 구성 전에 검사한다. 해당 종류의 배열만 교체한다.
  if (kind === 'general') seons.general = [...(seons.general ?? []).filter(item => item.seonId !== value.seonId), value as GeneralSeonV5];
  else if (kind === 'parentChild') seons.parentChild = [...(seons.parentChild ?? []).filter(item => item.seonId !== value.seonId), value as ParentChildSeonV5];
  else seons.upperLower = [...(seons.upperLower ?? []).filter(item => item.seonId !== value.seonId), value as UpperLowerSeonV5];
}
function pendingReview(jjum: JJumV5, now: number): void {
  const { verdict: _verdict, ...priorTag } = jjum.layaTag;
  jjum.layaTag = { ...priorTag, ...pendingLayaTag(now, '새 관계 근거 또는 정정된 쩜선을 검토해야 합니다.') };
}

/** source는 부모·상위 역할이다. 일반선의 역방향 재전송은 동일 근거로 처리한다. */
export function applySeonEvidenceV5(input: ApplySeonEvidenceInputV5): AppliedSeonEvidenceV5 {
  const { source, target, kind, seonId, label, evidence, calculation } = input;
  const now = input.now ?? Date.now(); timestamp(now);
  required(seonId, 'Seon ID'); required(label, 'Seon label');
  if (!kinds.includes(kind)) throw new V5CalculationError('invalid', 'Unsupported relationship kind');
  for (const jjum of [source, target]) {
    if (jjum.schemaVersion !== 5) throw new V5CalculationError('invalid', 'Seon updates require explicit v5 records');
    required(jjum.jjumId, 'JJum ID'); required(jjum.ownerId, 'Owner ID');
  }
  if (source.ownerId !== target.ownerId || source.jjumId === target.jjumId) throw new V5CalculationError('conflict', 'Relationship requires distinct JJums belonging to the same owner');
  if (calculation.status === 'pending') {
    if (!calculation.reasons.length || calculation.reasons.some(reason => typeof reason !== 'string' || !reason.trim())) throw new V5CalculationError('invalid', 'Pending calculations require reasons');
    return { status: 'pending', reasons: [...calculation.reasons] };
  }
  const value = calculation.value;
  if (value.kind !== kind) throw new V5CalculationError('conflict', 'Calculated relationship kind does not match the requested kind');
  const calculationRef = ref(calculation.calculationRef);
  validateProfileIntegrity([source, target], calculationRef);
  const sourceEntry = entry(evidence, value.kind === 'upperLower' ? value.upperReceived : value.sharedValue, calculationRef);
  const targetEntry = entry(evidence, value.kind === 'upperLower' ? value.lowerReceived : value.sharedValue, { ...calculationRef });
  const sourceRelation = lookup(source, seonId, kind), targetRelation = lookup(target, seonId, kind);
  if (Boolean(sourceRelation) !== Boolean(targetRelation)) throw new V5CalculationError('conflict', 'Both relationship counterparts must exist or both be absent');
  if (sourceRelation && targetRelation) {
    validateRelation(sourceRelation, kind, target.jjumId, label, true);
    validateRelation(targetRelation, kind, source.jjumId, label, false);
    validatePair(sourceRelation, targetRelation, kind);
    const priorSource = sourceRelation.history.find(item => item.evidenceId === evidence.evidenceId);
    const priorTarget = targetRelation.history.find(item => item.evidenceId === evidence.evidenceId);
    if (priorSource || priorTarget) {
      if (!isDeepStrictEqual(priorSource, sourceEntry) || !isDeepStrictEqual(priorTarget, targetEntry)) throw new V5CalculationError('conflict', 'Evidence ID was reused for a different relationship contribution');
      return { status: 'ready', source: structuredClone(source), target: structuredClone(target), changed: false };
    }
  }
  const nextSource = structuredClone(source), nextTarget = structuredClone(target);
  setRelation(nextSource, kind, relation(kind, sourceRelation, target.jjumId, seonId, label,
    structuredClone([...(sourceRelation?.history ?? []), sourceEntry]), true, evidence.timestamp));
  setRelation(nextTarget, kind, relation(kind, targetRelation, source.jjumId, seonId, label,
    structuredClone([...(targetRelation?.history ?? []), targetEntry]), false, evidence.timestamp));
  pendingReview(nextSource, now); pendingReview(nextTarget, now);
  return { status: 'ready', source: nextSource, target: nextTarget, changed: true };
}
