// @editedBy SherrySherry 2026-10-30
/** 개인 계산 자료의 교체 경계. 자료 선택과 의미 판단은 호출 맥락에서 명시한다. */
export type MentionFormula = 'root' | 'logarithm';
export interface CalculationProfileSelection { profileId: string; profileVersion: string }
export interface ProfileTypeCoefficients {
  name: string;
  category: string;
  basePower: number;
  rootAlpha: number;
  rootBeta: number;
  logAlpha: number;
  logBeta: number;
  participatesInGeneralLinkMatrices: boolean;
}
export interface UpperLowerValues { upperReceived: number; lowerReceived: number }
export interface CalculationProfile extends CalculationProfileSelection {
  scope: 'individual';
  packageVersion?: string;
  seonRuleVersion: string;
  /** 계산 표 원문과 수식 선택지의 해시. 포장·설명 메타데이터와 분리한다. */
  coefficientDigest: string;
  seonRuleDigest: string;
  types: ReadonlyMap<string, ProfileTypeCoefficients>;
  general: ReadonlyMap<string, number>;
  parentChild: ReadonlyMap<string, number>;
  upperLower: ReadonlyMap<string, UpperLowerValues>;
}
export interface CalculationProfileProvider {
  load(selection: CalculationProfileSelection): Promise<CalculationProfile>;
}
export interface ProfileCalculationReference extends CalculationProfileSelection {
  packageVersion?: string;
  rule: string;
  ruleVersion?: string;
  coefficientDigest: string;
}
export type ProfileCalculation<T> = {
  status: 'ready'; value: T; calculationRef: ProfileCalculationReference;
} | { status: 'pending'; reasons: string[] };

export class CalculationProfileError extends Error {
  readonly code: 'invalid' | 'unavailable' | 'integrity' | 'ambiguous';
  constructor(code: CalculationProfileError['code'], message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'CalculationProfileError'; this.code = code;
  }
}

export function profilePairKey(first: string, second: string): string {
  return JSON.stringify([first, second]);
}
function pending(reason: string): ProfileCalculation<never> { return { status: 'pending', reasons: [reason] }; }
function reference(profile: CalculationProfile, rule: string, isSeon = false): ProfileCalculationReference {
  return { profileId: profile.profileId, profileVersion: profile.profileVersion,
    ...(profile.packageVersion ? { packageVersion: profile.packageVersion } : {}),
    coefficientDigest: profile.coefficientDigest, rule,
    ...(isSeon ? { ruleVersion: profile.seonRuleVersion } : {}) };
}

/** 프로필 버전 갱신은 기존 자료의 재계산 대상이며 포장 이름만 바뀐 경우와 구별한다. */
export function compareCalculationProfiles(previous: CalculationProfile, next: CalculationProfile): {
  profileChanged: boolean; coefficientsChanged: boolean; seonRulesChanged: boolean; packageChanged: boolean;
  recalculationRequired: boolean;
} {
  const profileChanged = previous.profileId !== next.profileId || previous.profileVersion !== next.profileVersion;
  const coefficientsChanged = previous.coefficientDigest !== next.coefficientDigest;
  if (!profileChanged && coefficientsChanged) {
    throw new CalculationProfileError('integrity', 'The same profile version contains different coefficients');
  }
  const seonRulesChanged = previous.seonRuleVersion !== next.seonRuleVersion || previous.seonRuleDigest !== next.seonRuleDigest;
  return { profileChanged, coefficientsChanged, seonRulesChanged,
    packageChanged: previous.packageVersion !== next.packageVersion,
    recalculationRequired: profileChanged || coefficientsChanged || seonRulesChanged };
}

/** 이름에 연결된 실제 계수만 사용하며 제품 기본식이나 개인 기본 프로필을 선택하지 않는다. */
export function calculateProfileMention(profile: CalculationProfile, input: {
  typeNames: readonly string[]; mentionCount: number; formula?: MentionFormula;
  /** 복수 타입 결합을 호출 정책에서 지정한다. 쩜선 행렬 결합에는 이 규칙을 재사용하지 않는다. */
  combination?: 'mean-alpha-max-beta';
}): ProfileCalculation<number> {
  if (!Number.isSafeInteger(input.mentionCount) || input.mentionCount < 1) {
    throw new CalculationProfileError('invalid', 'Mention count must be a positive safe integer');
  }
  if (input.formula !== 'root' && input.formula !== 'logarithm') return pending('mention-formula-not-selected');
  const types = [...new Set(input.typeNames)];
  if (!types.length) return pending('type-not-selected');
  if (types.some(name => !profile.types.has(name))) return pending('type-not-in-profile');
  if (types.length > 1 && input.combination !== 'mean-alpha-max-beta') return pending('mention-type-combination-policy-missing');
  let alpha = 0, beta = 0, count = 0;
  for (const name of types) {
    const values = profile.types.get(name)!;
    const a = input.formula === 'root' ? values.rootAlpha : values.logAlpha;
    const b = input.formula === 'root' ? values.rootBeta : values.logBeta;
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 1) {
      throw new CalculationProfileError('invalid', 'Selected mention coefficients are invalid');
    }
    alpha += (a - alpha) / ++count;
    beta = Math.max(beta, b);
  }
  const value = input.formula === 'root'
    ? alpha * Math.expm1(Math.log(input.mentionCount) / beta)
    : alpha * (Math.log(input.mentionCount) / Math.log(beta));
  if (!Number.isFinite(value) || value < 0) throw new CalculationProfileError('invalid', 'Mention calculation is outside the finite range');
  return { status: 'ready', value, calculationRef: reference(profile, `mention:${input.formula}`) };
}

export type SeonKind = 'general' | 'parentChild' | 'upperLower';
export type SeonSituation = 'direct-meeting' | 'indirect-acquaintance';
export type SeonAttenuation = { kind: 'none' }
  | { kind: 'unresolved'; reason: string }
  | { kind: 'factor'; factor: number; reason: string; policyId: string; application?: 'multiply' };
export type SeonContribution = { kind: 'general' | 'parentChild'; sharedValue: number }
  | { kind: 'upperLower'; upperReceived: number; lowerReceived: number };

/** 확인된 관계 근거 한 건의 기여만 산출한다. 누적·중복 처리는 저장 계층에서 수행한다. */
export function calculateProfileSeon(profile: CalculationProfile, input: {
  kind: SeonKind;
  evidenceId: string;
  relationshipConfirmed: boolean;
  sourceJJumId: string;
  targetJJumId: string;
  /** parentChild는 parent→child, upperLower는 upper→lower 순서다. */
  sourceTypes: readonly string[];
  targetTypes: readonly string[];
  situations?: readonly SeonSituation[];
  attenuation?: SeonAttenuation;
}): ProfileCalculation<SeonContribution> {
  if (!['general', 'parentChild', 'upperLower'].includes(input.kind)) throw new CalculationProfileError('invalid', 'Unsupported seon kind');
  if (input.relationshipConfirmed !== true || !input.evidenceId?.trim()) return pending('relationship-evidence-unconfirmed');
  if (!input.sourceJJumId?.trim() || !input.targetJJumId?.trim()) return pending('relationship-identity-missing');
  if (input.sourceJJumId === input.targetJJumId) return pending('self-seon-not-allowed');
  const source = [...new Set(input.sourceTypes)], target = [...new Set(input.targetTypes)];
  if (!source.length || !target.length) return pending('type-not-selected');
  if ([...source, ...target].some(name => !profile.types.has(name))) return pending('type-not-in-profile');
  const situations = [...new Set(input.situations ?? [])];
  if (situations.some(s => s !== 'direct-meeting' && s !== 'indirect-acquaintance')) {
    throw new CalculationProfileError('invalid', 'Unsupported seon situation');
  }
  if (situations.length > 1) return pending('situation-selection-policy-missing');
  if (input.kind === 'upperLower' && situations.length) return pending('upper-lower-situation-allocation-policy-missing');
  if (!input.attenuation) return pending('attenuation-assessment-missing');
  if (!['none', 'unresolved', 'factor'].includes(input.attenuation.kind)) {
    throw new CalculationProfileError('invalid', 'Unsupported attenuation assessment');
  }
  if (input.attenuation.kind === 'unresolved') return pending('attenuation-policy-missing');
  let factor = 1;
  if (input.attenuation.kind === 'factor') {
    const attenuation = input.attenuation;
    if (!Number.isFinite(attenuation.factor) || attenuation.factor < 0 || attenuation.factor > 1
        || !attenuation.reason?.trim() || !attenuation.policyId?.trim()) {
      throw new CalculationProfileError('invalid', 'Attenuation requires a finite factor and supplied policy');
    }
    if (situations.includes('indirect-acquaintance') && attenuation.reason === 'indirect-acquaintance') {
      return pending('duplicate-indirectness-attenuation');
    }
    if (input.kind !== 'upperLower' && attenuation.application !== 'multiply') return pending('attenuation-application-policy-missing');
    factor = attenuation.factor;
  }
  let value: SeonContribution;
  let rule: string;
  if (situations.length) {
    rule = `seon:${input.kind}:situation:${situations[0]}`;
    value = { kind: input.kind as 'general' | 'parentChild',
      sharedValue: (situations[0] === 'direct-meeting' ? 0.5 : 0.2) * factor };
  } else {
    if (source.length !== 1 || target.length !== 1) return pending('seon-type-combination-policy-missing');
    if (!profile.types.get(source[0])!.participatesInGeneralLinkMatrices
        || !profile.types.get(target[0])!.participatesInGeneralLinkMatrices) return pending('type-excluded-from-seon-matrix');
    const key = profilePairKey(source[0], target[0]);
    rule = `seon:${input.kind}:matrix`;
    if (input.kind === 'upperLower') {
      const row = profile.upperLower.get(key);
      if (!row) return pending('seon-matrix-value-missing');
      value = { kind: 'upperLower', upperReceived: row.upperReceived * factor, lowerReceived: row.lowerReceived * factor };
    } else if (input.kind === 'general' || input.kind === 'parentChild') {
      const row = (input.kind === 'general' ? profile.general : profile.parentChild).get(key);
      if (row === undefined) return pending('seon-matrix-value-missing');
      value = { kind: input.kind, sharedValue: row * factor };
    } else throw new CalculationProfileError('invalid', 'Unsupported seon kind');
  }
  const values = value.kind === 'upperLower' ? [value.upperReceived, value.lowerReceived] : [value.sharedValue];
  if (values.some(n => !Number.isFinite(n) || n < 0)) throw new CalculationProfileError('invalid', 'Seon contribution is invalid');
  return { status: 'ready', value, calculationRef: reference(profile, rule, true) };
}
