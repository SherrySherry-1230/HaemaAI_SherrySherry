// @editedBy SherrySherry 2026-10-30
/** 프로필 전환은 쩜별 CAS로 저장한다. 일괄 원자 전환을 가장하지 않는다. */
import type { CalculationProfileProvider, CalculationProfileSelection } from './calculationProfiles.ts';
import type { JJumV5 } from './types/jjumV5.ts';
import { recalculateJJumPower, type PowerEvaluatorV5 } from './v5Calculations.ts';

export interface RecalculationTargetIdentity extends CalculationProfileSelection {
  coefficientDigest: string;
  packageVersion?: string;
  seonRuleVersion: string;
  seonRuleDigest: string;
}
export type RecalculationEntryStatus = 'updated' | 'unchanged' | 'pending' | 'conflict' | 'failed';
export interface RecalculationJournalEntry {
  jjumId: string;
  status: RecalculationEntryStatus;
  updatedAt: number;
  reasons?: string[];
}
export interface ProfileRecalculationOperation {
  operationId: string;
  targetIdentity: RecalculationTargetIdentity;
  status: 'running' | 'pending' | 'complete';
  startedAt: number;
  updatedAt: number;
  /** 최초 완료 시각. 같은 실행을 재개해도 마지막 완료 목표의 근거를 보존한다. */
  completedAt?: number;
  entries: RecalculationJournalEntry[];
}
export interface RecalculationJournalRecord {
  schemaVersion: 1;
  ownerId: string;
  profileId: string;
  revision: number;
  /** 모든 대상이 완료된 마지막 전환. 부분 완료인 목표 버전과 구분한다. */
  activeProfile?: RecalculationTargetIdentity;
  operations: ProfileRecalculationOperation[];
}
export interface ProfileRecalculationJournal {
  withRun<T>(ownerId: string, profileId: string, run: () => Promise<T>): Promise<T>;
  read(ownerId: string, profileId: string): RecalculationJournalRecord | null | Promise<RecalculationJournalRecord | null>;
  write(record: RecalculationJournalRecord, expectedRevision: number | null): void | Promise<void>;
}
export interface ProfileRecalculationRecord { jjum: JJumV5; etag: string }
export interface ProfileRecalculationRepository {
  list(ownerId: string): ProfileRecalculationRecord[] | Promise<ProfileRecalculationRecord[]>;
  read(ownerId: string, jjumId: string): ProfileRecalculationRecord | null | Promise<ProfileRecalculationRecord | null>;
  save(jjum: JJumV5, options: { expectedEtag: string }): unknown | Promise<unknown>;
}
export interface ActivateCalculationProfileOptions {
  ownerId: string;
  selection: CalculationProfileSelection;
  operationId: string;
  provider: CalculationProfileProvider;
  repository: ProfileRecalculationRepository;
  journal: ProfileRecalculationJournal;
  evaluator?: PowerEvaluatorV5;
  now?: number;
}
export interface ProfileActivationResult {
  ownerId: string;
  profileId: string;
  operation: ProfileRecalculationOperation;
  activeProfile?: RecalculationTargetIdentity;
}
export class ProfileRecalculationError extends Error {
  readonly code: 'invalid' | 'conflict' | 'integrity';
  constructor(code: ProfileRecalculationError['code'], message: string) {
    super(message); this.name = 'ProfileRecalculationError'; this.code = code;
  }
}

function required(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new ProfileRecalculationError('invalid', `${label} is required`);
}
function sameTarget(first: RecalculationTargetIdentity, second: RecalculationTargetIdentity): boolean {
  return first.profileId === second.profileId && first.profileVersion === second.profileVersion
    && first.coefficientDigest === second.coefficientDigest && first.packageVersion === second.packageVersion
    && first.seonRuleVersion === second.seonRuleVersion && first.seonRuleDigest === second.seonRuleDigest;
}
function isComplete(entry: RecalculationJournalEntry): boolean {
  return entry.status === 'updated' || entry.status === 'unchanged';
}
function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(sorted(value));
}
/** 쩜 계산 자료에는 규칙 문서 식별자가 없으므로 장부와 실제 계산 이력을 함께 확인한다. */
function unchangedRuleIssue(
  jjum: JJumV5, target: RecalculationTargetIdentity, operations: ProfileRecalculationOperation[],
): string | undefined {
  const current = jjum.powerCalculation;
  if (!current || current.profileVersion !== target.profileVersion
    || current.coefficientDigest !== target.coefficientDigest) return undefined;
  const provenTargets = operations.filter(operation => operation.targetIdentity.profileId === current.profileId
    && operation.targetIdentity.profileVersion === current.profileVersion
    && operation.targetIdentity.coefficientDigest === current.coefficientDigest
    && operation.entries.some(entry => entry.jjumId === jjum.jjumId
      && (isComplete(entry) || (entry.status === 'pending' && entry.reasons?.includes('recalculation-not-started'))))
    && jjum.powerHistory?.some(history => history.operationId === operation.operationId
      && canonical(history.calculation) === canonical(current))).map(operation => operation.targetIdentity);
  if (provenTargets.some(previous => previous.seonRuleVersion === target.seonRuleVersion
    && previous.seonRuleDigest === target.seonRuleDigest)) return undefined;
  return provenTargets.length ? 'seon-rule-change-recalculation-policy-missing' : 'seon-rule-application-unverified';
}
function errorEntry(jjumId: string, error: unknown, now: number): RecalculationJournalEntry {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unavailable';
  const status = ['conflict', 'integrity', 'locked'].includes(code) ? 'conflict' : 'failed';
  // 저장소/평가자의 오류 본문에 기억 내용이나 경로가 섞여 있을 수 있으므로 장부에는 분류만 쓴다.
  const allowed = ['conflict', 'integrity', 'locked', 'invalid', 'policy_pending', 'corrupt', 'unsupported_version', 'unavailable'];
  return { jjumId, status, updatedAt: now, reasons: [`recalculation-${allowed.includes(code) ? code : 'unavailable'}`] };
}

/**
 * 실행 시작 시 존재하는 해당 소유자·프로필의 모든 쩜을 처리한다. 재시도는 저장된 쩜을
 * 다시 읽으므로 저장 성공 뒤 장부 쓰기만 실패한 경우도 계산 이력으로 중복을 막는다.
 * 개별 쩜 CAS 이후의 동시 변경까지 일괄 잠그지는 않으며 마지막 관찰에서 발견되면 보류한다.
 */
export async function activateCalculationProfile(options: ActivateCalculationProfileOptions): Promise<ProfileActivationResult> {
  const { ownerId, selection, operationId, provider, repository, journal, evaluator } = options;
  required(ownerId, 'Owner ID'); required(selection.profileId, 'Profile ID');
  required(selection.profileVersion, 'Profile version'); required(operationId, 'Operation ID');
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new ProfileRecalculationError('invalid', 'A valid integer timestamp is required');
  }
  const profile = await provider.load(selection);
  if (profile.profileId !== selection.profileId || profile.profileVersion !== selection.profileVersion) {
    throw new ProfileRecalculationError('integrity', 'The provider returned a different profile selection');
  }
  required(profile.coefficientDigest, 'Coefficient digest'); required(profile.seonRuleVersion, 'Rule version');
  required(profile.seonRuleDigest, 'Rule digest');
  const targetIdentity: RecalculationTargetIdentity = {
    profileId: profile.profileId, profileVersion: profile.profileVersion,
    coefficientDigest: profile.coefficientDigest, seonRuleVersion: profile.seonRuleVersion,
    seonRuleDigest: profile.seonRuleDigest,
    ...(profile.packageVersion === undefined ? {} : { packageVersion: profile.packageVersion }),
  };
  return journal.withRun(ownerId, selection.profileId, async () => {
    const original = await journal.read(ownerId, selection.profileId);
    const record: RecalculationJournalRecord = original ? structuredClone(original) : {
      schemaVersion: 1, ownerId, profileId: selection.profileId, revision: 0, operations: [],
    };
    if (record.schemaVersion !== 1 || record.ownerId !== ownerId || record.profileId !== selection.profileId
      || !Number.isSafeInteger(record.revision) || record.revision < 0 || !Array.isArray(record.operations)) {
      throw new ProfileRecalculationError('integrity', 'The journal scope or revision is invalid');
    }
    const operationIds = new Set<string>();
    for (const prior of record.operations) {
      if (operationIds.has(prior.operationId)) throw new ProfileRecalculationError('integrity', 'Duplicate journal operation ID');
      operationIds.add(prior.operationId);
      if (prior.targetIdentity.profileId !== record.profileId) throw new ProfileRecalculationError('integrity', 'Journal profile scope mismatch');
      if (prior.targetIdentity.profileVersion === targetIdentity.profileVersion
        && prior.targetIdentity.coefficientDigest !== targetIdentity.coefficientDigest) {
        throw new ProfileRecalculationError('integrity', 'The same profile version contains different coefficients');
      }
    }
    let operation = record.operations.find(item => item.operationId === operationId);
    if (operation && !sameTarget(operation.targetIdentity, targetIdentity)) {
      throw new ProfileRecalculationError('conflict', 'The operation ID belongs to a different profile target');
    }
    const initial = await repository.list(ownerId);
    const selected = initial.filter(item => item.jjum.ownerId === ownerId
      && item.jjum.powerCalculation?.profileId === selection.profileId);
    const ids = new Set(selected.map(item => item.jjum.jjumId));
    if (ids.size !== selected.length) throw new ProfileRecalculationError('integrity', 'Duplicate stored JJum ID');
    if (!operation) {
      operation = { operationId, targetIdentity, status: 'running', startedAt: now, updatedAt: now, entries: [] };
      record.operations.push(operation);
    }
    for (const entry of operation.entries) ids.add(entry.jjumId);
    operation.status = 'running'; operation.updatedAt = now;
    for (const jjumId of ids) {
      required(jjumId, 'JJum ID');
      if (!operation.entries.some(entry => entry.jjumId === jjumId)) {
        operation.entries.push({ jjumId, status: 'pending', updatedAt: now, reasons: ['recalculation-not-started'] });
      }
    }
    let expectedRevision: number | null = original?.revision ?? null;
    const persist = async (): Promise<void> => {
      record.revision = (expectedRevision ?? 0) + 1;
      await journal.write(structuredClone(record), expectedRevision);
      expectedRevision = record.revision;
    };
    await persist();
    for (const jjumId of ids) {
      let entry: RecalculationJournalEntry;
      try {
        const current = await repository.read(ownerId, jjumId);
        if (!current || current.jjum.ownerId !== ownerId || current.jjum.jjumId !== jjumId
          || current.jjum.powerCalculation?.profileId !== selection.profileId) {
          entry = { jjumId, status: 'conflict', updatedAt: now, reasons: ['recalculation-record-missing-or-scope-changed'] };
        } else {
          const ruleIssue = unchangedRuleIssue(current.jjum, targetIdentity, original?.operations ?? []);
          if (ruleIssue) {
            // 같은 계수 버전의 helper no-op은 새 규칙 적용의 증거가 아니다.
            entry = { jjumId, status: 'pending', updatedAt: now, reasons: [ruleIssue] };
          } else {
            const result = await recalculateJJumPower(current.jjum, profile, evaluator, operationId, now);
            if (result.status === 'pending') {
              entry = { jjumId, status: 'pending', updatedAt: now, reasons: [...result.reasons] };
            } else if (!result.changed) {
              entry = { jjumId, status: 'unchanged', updatedAt: now };
            } else {
              await repository.save(result.jjum, { expectedEtag: current.etag });
              entry = { jjumId, status: 'updated', updatedAt: now };
            }
          }
        }
      } catch (error) {
        entry = errorEntry(jjumId, error, now);
      }
      const index = operation.entries.findIndex(item => item.jjumId === jjumId);
      operation.entries[index] = entry; operation.updatedAt = now;
      // 장부 저장 실패는 호출자에게 전달한다. 같은 실행을 이어서 조용히 진행하지 않는다.
      await persist();
    }
    // 처리 중 새 쩜 생성/다른 프로필 수정이 있었으면 현재 목표를 모두 적용했다고 기록하지 않는다.
    const finalRecords = await repository.list(ownerId);
    const finalById = new Map(finalRecords.filter(item => item.jjum.ownerId === ownerId)
      .map(item => [item.jjum.jjumId, item.jjum]));
    for (const entry of operation.entries) {
      if (!isComplete(entry)) continue;
      const current = finalById.get(entry.jjumId);
      if (!current || current.powerCalculation?.profileId !== profile.profileId
        || current.powerCalculation.profileVersion !== profile.profileVersion
        || current.powerCalculation.coefficientDigest !== profile.coefficientDigest) {
        entry.status = 'conflict'; entry.updatedAt = now; entry.reasons = ['recalculation-record-changed-after-processing'];
      }
    }
    for (const current of finalById.values()) {
      if (current.powerCalculation?.profileId !== profile.profileId || operation.entries.some(entry => entry.jjumId === current.jjumId)) continue;
      operation.entries.push({ jjumId: current.jjumId, status: 'pending', updatedAt: now,
        reasons: ['recalculation-record-added-during-run'] });
    }
    operation.status = operation.entries.every(isComplete) ? 'complete' : 'pending';
    operation.updatedAt = now;
    if (operation.status === 'complete') {
      operation.completedAt ??= now;
      record.activeProfile = structuredClone(targetIdentity);
    }
    await persist();
    return { ownerId, profileId: selection.profileId, operation: structuredClone(operation),
      ...(record.activeProfile ? { activeProfile: structuredClone(record.activeProfile) } : {}) };
  });
}
