// @editedBy SherrySherry 2026-10-31
/** 확정된 계산 결과와 원래 근거를 보존한다. 미정 평가식을 기본값으로 만들지 않는다. */
import type { CalculationProfile, MentionFormula } from './calculationProfiles.ts';
import type {
  JJumV5, PowerCalculationV5, PowerComponentsV5, PowerEvidenceV5,
} from './types/jjumV5.ts';

const COMPONENTS = ['mention', 'duration', 'emotion', 'seon'] as const;
export const JJUM_POWER_CONTRIBUTION_FLOORS: Readonly<PowerComponentsV5> = Object.freeze({
  mention: 0.23, duration: 0.17, emotion: 0.29, seon: 0.31,
});

export class V5CalculationError extends Error {
  readonly code: 'invalid' | 'conflict' | 'integrity';
  constructor(code: V5CalculationError['code'], message: string) {
    super(message); this.name = 'V5CalculationError'; this.code = code;
  }
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new V5CalculationError('invalid', `${field} is required`);
}
function time(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
    throw new V5CalculationError('invalid', 'A valid integer timestamp is required');
  }
}
function components(value: PowerComponentsV5): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new V5CalculationError('invalid', 'Power components are required');
  for (const field of COMPONENTS) {
    if (!Number.isFinite(value[field]) || value[field] < 0) {
      throw new V5CalculationError('invalid', `Power ${field} must be finite and nonnegative before applying its floor`);
    }
  }
}
function power(value: number): void {
  if (!Number.isFinite(value) || value < 1) throw new V5CalculationError('invalid', 'Stored power must be finite and at least 1');
}
function manner(value: number): void {
  if (!Number.isInteger(value) || value < -13 || value > 13) {
    throw new V5CalculationError('invalid', 'Evaluated mention suitability must be an integer from -13 to 13');
  }
}

/** Number의 십진 표현을 합산한다. 보정 하한 합 1을 이진 누적 오차로 바꾸지 않는다. */
function decimalParts(value: number): { digits: bigint; scale: number } {
  const [coefficient, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  let digits = BigInt(whole + fraction);
  let scale = fraction.length - Number(exponent);
  if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
  return { digits, scale };
}
function decimalNumber(digits: bigint, scale: number): number {
  const result = Number(`${digits}e-${scale}`);
  if (!Number.isFinite(result)) throw new V5CalculationError('invalid', 'Sum exceeds the finite numeric representation');
  return result;
}

/** 유한한 Number의 십진 원값을 합산한다. 화면용 자릿수 제한은 적용하지 않는다. */
export function sumDecimalNumbers(values: readonly number[]): number {
  if (values.some(value => !Number.isFinite(value))) throw new V5CalculationError('invalid', 'Decimal inputs must be finite');
  if (!values.length) return 0;
  const parts = values.map(decimalParts);
  const scale = parts.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  return decimalNumber(parts.reduce((sum, value) => sum + value.digits * 10n ** BigInt(scale - value.scale), 0n), scale);
}

export function calculateJJumPower(contributions: PowerComponentsV5): {
  power: number; adjustedContributions: PowerComponentsV5;
} {
  components(contributions);
  const adjustedContributions = Object.fromEntries(COMPONENTS.map(field =>
    [field, Math.max(contributions[field], JJUM_POWER_CONTRIBUTION_FLOORS[field])])) as unknown as PowerComponentsV5;
  const value = sumDecimalNumbers(COMPONENTS.map(field => adjustedContributions[field]));
  power(value);
  return { power: value, adjustedContributions };
}

/** 표시 문자열만 만든다. 양수 십진 반올림은 표시 선택이며 저장 자료를 수정하지 않는다. */
export function formatJJumPower(value: number): string {
  power(value);
  const { digits, scale } = decimalParts(value);
  let tenths: bigint;
  if (scale <= 1) tenths = digits * 10n ** BigInt(1 - scale);
  else {
    const divisor = 10n ** BigInt(scale - 1);
    tenths = digits / divisor + (digits % divisor * 2n >= divisor ? 1n : 0n);
  }
  return `${tenths / 10n}.${tenths % 10n}`;
}

function canonical(value: unknown): string {
  const visit = (item: unknown): unknown => Array.isArray(item) ? item.map(visit)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, visit((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(visit(value));
}

function effectiveEvidence(evidence: PowerEvidenceV5[]): PowerEvidenceV5[] {
  const byId = new Map<string, PowerEvidenceV5>();
  for (const item of evidence) {
    text(item.evidenceId, 'Power evidence ID');
    if (byId.has(item.evidenceId)) throw new V5CalculationError('conflict', 'Duplicate power evidence ID');
    byId.set(item.evidenceId, item);
  }
  const replaced = new Set<string>();
  for (const item of evidence) {
    if (item.replacesEvidenceId === undefined) continue;
    text(item.replacesEvidenceId, 'Replaced power evidence ID');
    if (!byId.has(item.replacesEvidenceId) || replaced.has(item.replacesEvidenceId)) {
      throw new V5CalculationError('conflict', 'Power correction must replace one existing contribution without branching');
    }
    replaced.add(item.replacesEvidenceId);
    const seen = new Set([item.evidenceId]);
    let previous: string | undefined = item.replacesEvidenceId;
    while (previous !== undefined) {
      if (seen.has(previous)) throw new V5CalculationError('conflict', 'Power evidence correction contains a cycle');
      seen.add(previous);
      previous = byId.get(previous)?.replacesEvidenceId;
    }
  }
  return evidence.filter(item => !replaced.has(item.evidenceId));
}

export interface PowerEvaluationInputV5 {
  jjum: JJumV5;
  profile: CalculationProfile;
  /** 정정 전 원본을 포함한 보존 근거. */
  evidence: PowerEvidenceV5[];
  /** 정정으로 대체된 기여를 제외한 현재 유효 근거. */
  effectiveEvidence: PowerEvidenceV5[];
}
export type PowerEvaluationV5 = {
  status: 'ready'; policyVersion: string; formula: MentionFormula;
  contributions: PowerComponentsV5; rawScores?: PowerComponentsV5;
} | { status: 'pending'; reasons: string[] };
export type PowerEvaluatorV5 = (input: PowerEvaluationInputV5) => PowerEvaluationV5 | Promise<PowerEvaluationV5>;
export type PowerRecalculationV5 = { status: 'ready'; jjum: JJumV5; changed: boolean }
  | { status: 'pending'; reasons: string[] };

/** 기존 전체 근거로 재산정한다. 최신 프로필의 수식·환산 정책은 평가자가 명시적으로 제공한다. */
export async function recalculateJJumPower(
  input: JJumV5, targetProfile: CalculationProfile, evaluator: PowerEvaluatorV5 | undefined,
  operationId: string, now: number = Date.now(),
): Promise<PowerRecalculationV5> {
  if (input.schemaVersion !== 5) throw new V5CalculationError('invalid', 'Power recalculation requires an explicit v5 record');
  power(input.jjumPower); text(operationId, 'Recalculation operation ID'); time(now);
  text(targetProfile.profileId, 'Target profile ID'); text(targetProfile.profileVersion, 'Target profile version');
  text(targetProfile.coefficientDigest, 'Target coefficient digest');
  const jjum = structuredClone(input);
  const previous = jjum.powerCalculation;
  if (!previous || !Array.isArray(previous.evidence) || previous.evidence.length === 0) {
    return { status: 'pending', reasons: ['power-evidence-and-profile-required'] };
  }
  if (previous.profileId !== targetProfile.profileId) {
    throw new V5CalculationError('conflict', 'A different personal profile cannot silently replace the recorded profile');
  }
  if (previous.profileVersion === targetProfile.profileVersion && previous.coefficientDigest !== targetProfile.coefficientDigest) {
    throw new V5CalculationError('integrity', 'The same profile version contains different coefficients');
  }
  const applied = jjum.powerHistory?.find(item => item.operationId === operationId);
  if (applied) {
    if (applied.calculation.profileId !== targetProfile.profileId
      || applied.calculation.profileVersion !== targetProfile.profileVersion
      || applied.calculation.coefficientDigest !== targetProfile.coefficientDigest
      || canonical(applied.calculation.evidence) !== canonical(previous.evidence)) {
      throw new V5CalculationError('conflict', 'Recalculation operation ID was reused with a different profile or evidence');
    }
    return { status: 'ready', jjum, changed: false };
  }
  // 같은 계수 버전의 포장 변경만으로 새 계산·이력을 만들지 않는다.
  if (previous.profileVersion === targetProfile.profileVersion) return { status: 'ready', jjum, changed: false };
  if (!evaluator) return { status: 'pending', reasons: ['power-contribution-policy-missing'] };
  const evidence = structuredClone(previous.evidence);
  const active = effectiveEvidence(evidence);
  const evaluated = await evaluator({ jjum: structuredClone(jjum), profile: structuredClone(targetProfile),
    evidence: structuredClone(evidence), effectiveEvidence: structuredClone(active) });
  if (evaluated.status === 'pending') {
    if (!evaluated.reasons.length || evaluated.reasons.some(reason => typeof reason !== 'string' || !reason.trim())) {
      throw new V5CalculationError('invalid', 'A pending power evaluation requires its unresolved reasons');
    }
    return { status: 'pending', reasons: [...evaluated.reasons] };
  }
  text(evaluated.policyVersion, 'Power evaluation policy version');
  if (evaluated.formula !== 'root' && evaluated.formula !== 'logarithm') {
    throw new V5CalculationError('invalid', 'Power evaluation must explicitly select a supplied mention formula');
  }
  if (evaluated.rawScores !== undefined) components(evaluated.rawScores);
  const result = calculateJJumPower(evaluated.contributions);
  const calculation: PowerCalculationV5 = {
    profileId: targetProfile.profileId, profileVersion: targetProfile.profileVersion,
    coefficientDigest: targetProfile.coefficientDigest, formula: evaluated.formula,
    policyVersion: evaluated.policyVersion, evidence,
    ...(evaluated.rawScores ? { rawScores: structuredClone(evaluated.rawScores) } : {}),
    contributions: structuredClone(evaluated.contributions), calculatedAt: now,
  };
  jjum.powerHistory = [...(jjum.powerHistory ?? []), { operationId, timestamp: now,
    previousPower: jjum.jjumPower, power: result.power,
    previousCalculation: structuredClone(previous), calculation: structuredClone(calculation) }];
  jjum.jjumPower = result.power;
  jjum.powerCalculation = calculation;
  // 계산 출처·숫자 갱신은 본문 내용 검토와 별개이며 기존 검토 태그를 보존한다.
  return { status: 'ready', jjum, changed: true };
}

export type MentionSuitabilityUpdateV5 = {
  evidenceId: string; policyVersion: string; reason: string; timestamp: number;
} & ({ value: number; delta?: never } | { delta: number; value?: never });

/** 외부 평가 단계가 공급한 가감 또는 확정값만 적용한다. 미평가를 0으로 만들지 않는다. */
export function updateMentionSuitability(input: JJumV5, update: MentionSuitabilityUpdateV5): JJumV5 {
  if (input.schemaVersion !== 5) throw new V5CalculationError('invalid', 'Mention suitability updates require a v5 record');
  manner(input.mentionSuitability);
  text(update.evidenceId, 'Manner evidence ID'); text(update.policyVersion, 'Manner policy version');
  text(update.reason, 'Manner evaluation reason'); time(update.timestamp);
  if (update.reason.length > 500) throw new V5CalculationError('invalid', 'Manner reason must not exceed 500 characters');
  const absolute = Object.hasOwn(update, 'value'), relative = Object.hasOwn(update, 'delta');
  if (absolute === relative) throw new V5CalculationError('invalid', 'Provide exactly one evaluated manner value or delta');
  if (relative && !Number.isSafeInteger(update.delta)) throw new V5CalculationError('invalid', 'Manner delta must be a safe integer');
  const previous = input.mannerHistory?.find(item => item.evidenceId === update.evidenceId);
  const value = absolute ? update.value! : (previous?.previousValue ?? input.mentionSuitability) + update.delta!;
  manner(value);
  if (previous) {
    if (previous.value !== value || previous.policyVersion !== update.policyVersion || previous.reason !== update.reason) {
      throw new V5CalculationError('conflict', 'Manner evidence ID was reused for a different evaluation');
    }
    return structuredClone(input);
  }
  const jjum = structuredClone(input);
  jjum.mannerHistory = [...(jjum.mannerHistory ?? []), {
    evidenceId: update.evidenceId, timestamp: update.timestamp,
    previousValue: jjum.mentionSuitability, value, policyVersion: update.policyVersion, reason: update.reason,
  }];
  // 매너 평가 이력만 바뀌었으므로 본문의 검토 상태는 초기화하지 않는다.
  jjum.mentionSuitability = value;
  return jjum;
}
