// @editedBy SherrySherry 2026-10-30
/** 저장 전 검사. 누락값·현재 시각·점수·타입 정책을 임의로 보충하지 않는다. */
import { isDeepStrictEqual } from 'node:util';
import { isLayaTag, isLayaReviewText } from '../layaReview.ts';
import { calculateJJumPower } from '../v5Calculations.ts';
import type { JJumV5, PowerComponentsV5, TypeRequirementCatalogV5 } from './jjumV5.ts';

export interface JJumV5Issue {
  code: 'missing' | 'invalid' | 'unknown_field' | 'policy_pending';
  path: string;
  message: string;
}
export interface JJumV5ValidationOptions {
  typeRequirements?: TypeRequirementCatalogV5;
  /** 저장 준비에서는 true. 기존 파일의 구조만 읽을 때에만 false를 사용한다. */
  requireTypePolicies?: boolean;
}
export interface JJumV5ValidationResult {
  ok: boolean;
  validStructure: boolean;
  jjum?: JJumV5;
  issues: JJumV5Issue[];
  missing: string[];
  policyPending: string[];
  /** 구조 검사 성공은 내용 정상 판정이 아니다. 실제 Laya 요청에 이 결과를 전달한다. */
  layaReview: { state: 'pending'; reason: string };
}

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const string = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const time = (value: unknown): value is number => Number.isSafeInteger(value)
  && Number.isFinite(new Date(value as number).getTime());
const present = (value: unknown): boolean => value !== undefined && value !== null
  && !(typeof value === 'string' && value.trim() === '') && !(Array.isArray(value) && value.length === 0)
  && !(object(value) && Object.keys(value).length === 0);

const REQUIRED = ['schemaVersion', 'jjumId', 'jjumName', 'type', 'summary', 'ownerId', 'hostChatbotId',
  'sourceService', 'jjumPower', 'mentionSuitability', 'mentionCount', 'firstSeen', 'lastMentioned',
  'recallCount', 'status', 'layaTag', 'visibility'] as const;
const OPTIONAL = ['sensitivity', 'hostKnowledge', 'typeDetails', 'powerCalculation', 'powerHistory', 'mannerHistory',
  'aliases', 'jjtags', 'facts', 'events', 'context', 'seons', 'mentionHistory', 'mentionHistoryChunks',
  'recallHistory', 'hostProactiveMentionHistory', 'lastRecalled', 'pinned', 'mergedFrom', 'mergedInto',
  'editHistory', 'responseFeedback', 'meta'] as const;

function jsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (finite(value)) return true;
  if ((!object(value) && !Array.isArray(value)) || seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every(item => jsonValue(item, seen));
  seen.delete(value);
  return valid;
}

/** 저장 직전 선택 키만 생략한다. 필수 값과 opaque 서비스 데이터의 내부는 변경하지 않는다. */
export function normalizeJJumV5Optionals(input: unknown): unknown {
  if (!object(input)) return input;
  const value = structuredClone(input);
  const omit = (item: unknown, fields: readonly string[]) => {
    if (!object(item)) return;
    for (const key of fields) if (Object.hasOwn(item, key) && !present(item[key])) delete item[key];
  };
  const each = (items: unknown, fn: (item: unknown) => void) => { if (Array.isArray(items)) items.forEach(fn); };
  omit(value, OPTIONAL);
  if (object(value.seons)) {
    for (const kind of ['general', 'parentChild', 'upperLower']) {
      if (Object.hasOwn(value.seons, kind) && !present(value.seons[kind])) delete value.seons[kind];
    }
    for (const relations of Object.values(value.seons)) each(relations, item => {
      omit(item, ['lastActivated']);
      if (object(item)) each(item.history, entry => {
        omit(entry, ['occurredAt', 'replacesEvidenceId', 'calculationRef']);
        if (object(entry)) omit(entry.calculationRef, ['packageVersion']);
      });
    });
    if (Object.keys(value.seons).length === 0) delete value.seons;
  }
  each(value.events, item => omit(item, ['refJJumIds']));
  each(value.mentionHistory, item => omit(item, ['occurredAt']));
  each(value.mentionHistoryChunks, item => {
    if (object(item)) each(item.entries, entry => omit(entry, ['occurredAt']));
  });
  each(value.editHistory, item => omit(item, ['field', 'memo', 'evidence', 'reviewRequested', 'introductionRevision']));
  each(value.responseFeedback, item => omit(item, ['responseId']));
  const calculation = (item: unknown) => {
    omit(item, ['rawScores']);
    if (object(item)) each(item.evidence, entry => omit(entry, ['occurredAt', 'replacesEvidenceId']));
  };
  calculation(value.powerCalculation);
  each(value.powerHistory, item => {
    omit(item, ['previousCalculation']);
    if (object(item)) { calculation(item.calculation); calculation(item.previousCalculation); }
  });
  return value;
}

export function validateJJumV5(input: unknown, options: JJumV5ValidationOptions = {}): JJumV5ValidationResult {
  const issues: JJumV5Issue[] = [];
  const policyPending: string[] = [];
  const issue = (path: string, message: string, code: JJumV5Issue['code'] = 'invalid') => issues.push({ code, path, message });
  const required = (o: Obj, keys: readonly string[], prefix = '') => {
    for (const key of keys) if (!present(o[key])) issue(`${prefix}${key}`, '필수 정보가 없습니다.', 'missing');
  };
  const keys = (o: Obj, allowed: readonly string[], prefix = '') => {
    for (const key of Object.keys(o)) if (!allowed.includes(key)) issue(`${prefix}${key}`, '허용되지 않은 저장 키입니다.', 'unknown_field');
  };
  const stringFields = (o: Obj, names: readonly string[], prefix: string) => {
    for (const name of names) if (o[name] !== undefined && !string(o[name])) issue(`${prefix}${name}`, '비어 있지 않은 문자열이 필요합니다.');
  };
  const timeFields = (o: Obj, names: readonly string[], prefix: string) => {
    for (const name of names) if (o[name] !== undefined && !time(o[name])) issue(`${prefix}${name}`, '밀리초 정수 시각이 필요합니다.');
  };
  const stringArray = (value: unknown, path: string, unique = true): value is string[] => {
    if (!Array.isArray(value) || value.length === 0 || value.some(item => !string(item))) {
      issue(path, '비어 있지 않은 문자열 목록이 필요합니다.'); return false;
    }
    if (unique && new Set(value).size !== value.length) issue(path, '중복 값은 허용하지 않습니다.');
    return true;
  };
  const records = (value: unknown, path: string, visit: (item: Obj, prefix: string, index: number) => void) => {
    if (!Array.isArray(value) || value.length === 0) { issue(path, '비어 있지 않은 객체 목록이 필요합니다.'); return; }
    value.forEach((item, index) => {
      if (!object(item)) issue(`${path}[${index}]`, '객체가 필요합니다.');
      else visit(item, `${path}[${index}].`, index);
    });
  };
  const result = (): JJumV5ValidationResult => {
    const validStructure = !issues.some(item => item.code !== 'policy_pending');
    const ok = issues.length === 0;
    return { ok, validStructure, ...(ok ? { jjum: structuredClone(input) as JJumV5 } : {}), issues,
      missing: [...new Set(issues.filter(item => item.code === 'missing').map(item => item.path))], policyPending,
      layaReview: { state: 'pending', reason: ok ? '저장 전 형식 검사를 통과했으며 내용 검토를 기다립니다.'
        : `저장 전 검사에서 누락·형식·정책 확인 ${issues.length}건이 남아 있습니다.` } };
  };
  if (!object(input)) { issue('', '쩜은 JSON 객체여야 합니다.'); return result(); }
  if (!jsonValue(input)) { issue('', '유한한 JSON 자료만 저장할 수 있습니다.'); return result(); }
  const d = input;
  required(d, REQUIRED);
  keys(d, [...REQUIRED, ...OPTIONAL]);
  stringFields(d, ['jjumId', 'jjumName', 'summary', 'ownerId', 'hostChatbotId', 'sourceService'], '');
  if (d.schemaVersion !== 5) issue('schemaVersion', 'v5 자료만 이 검증 경로에 넣을 수 있습니다.');
  if (d.type !== undefined) stringArray(d.type, 'type');
  if (!finite(d.jjumPower) || d.jjumPower < 1) issue('jjumPower', '소수 원값은 유한하며 1 이상이어야 합니다.');
  if (!Number.isInteger(d.mentionSuitability) || (d.mentionSuitability as number) < -10 || (d.mentionSuitability as number) > 10) {
    issue('mentionSuitability', '평가된 정수 -10~10이 필요합니다. 미평가를 0으로 보충하지 않습니다.');
  }
  for (const [name, minimum] of [['mentionCount', 1], ['recallCount', 0]] as const) {
    if (!Number.isSafeInteger(d[name]) || (d[name] as number) < minimum) issue(name, `${minimum} 이상의 안전한 정수가 필요합니다.`);
  }
  timeFields(d, ['firstSeen', 'lastMentioned', 'lastRecalled'], '');
  if (!['active', 'resting', 'archived', 'merged'].includes(d.status as string)) issue('status', '지원하지 않는 상태입니다.');
  if (!isLayaTag(d.layaTag)) issue('layaTag', '검토 상태·이유·시각 조합이 유효하지 않습니다.');
  if (object(d.layaTag)) keys(d.layaTag, ['state', 'reason', 'timestamp', 'verdict'], 'layaTag.');

  for (const key of OPTIONAL) if (Object.hasOwn(d, key) && !present(d[key])) issue(key, '정보가 없는 선택 키는 생략해야 합니다.');
  if (object(d.visibility)) {
    keys(d.visibility, ['scope', 'hostIds'], 'visibility.');
    if (!['private', 'restricted', 'public'].includes(d.visibility.scope as string)) issue('visibility.scope', '공개 범위가 필요합니다.');
    if (d.visibility.scope === 'restricted') {
      if (d.visibility.hostIds === undefined) issue('visibility.hostIds', '지정 공개 대상이 필요합니다.', 'missing');
      else stringArray(d.visibility.hostIds, 'visibility.hostIds');
    } else if (Object.hasOwn(d.visibility, 'hostIds')) issue('visibility.hostIds', '지정 공개에서만 대상 목록을 사용합니다.');
  } else issue('visibility', '공개 범위 객체가 필요합니다.');
  stringFields(d, ['sensitivity', 'mergedInto'], '');
  if (d.pinned !== undefined && typeof d.pinned !== 'boolean') issue('pinned', 'boolean이 필요합니다.');
  for (const name of ['aliases', 'jjtags', 'mergedFrom'] as const) if (d[name] !== undefined) stringArray(d[name], name);
  if (Array.isArray(d.aliases) && d.aliases.includes(d.jjumName)) issue('aliases', '대표 이름을 별칭에 중복 저장하지 않습니다.');
  if (d.status === 'merged' && !string(d.mergedInto)) issue('mergedInto', '병합 대상 ID가 필요합니다.', 'missing');
  if (d.mergedInto === d.jjumId) issue('mergedInto', '자신에게 병합할 수 없습니다.');
  if (Array.isArray(d.mergedFrom) && d.mergedFrom.includes(d.jjumId)) issue('mergedFrom', '자신을 흡수 대상으로 기록할 수 없습니다.');
  for (const name of ['context', 'meta', 'typeDetails']) if (d[name] !== undefined && !object(d[name])) issue(name, '객체가 필요합니다.');

  if (d.hostKnowledge !== undefined) {
    const seen = new Set<unknown>();
    records(d.hostKnowledge, 'hostKnowledge', (item, p) => {
      required(item, ['hostChatbotId', 'evidenceIds', 'learnedAt'], p);
      keys(item, ['hostChatbotId', 'evidenceIds', 'learnedAt'], p);
      stringFields(item, ['hostChatbotId'], p); stringArray(item.evidenceIds, `${p}evidenceIds`); timeFields(item, ['learnedAt'], p);
      if (seen.has(item.hostChatbotId)) issue(`${p}hostChatbotId`, '같은 호스트의 인지 근거는 한 항목에 보존합니다.');
      seen.add(item.hostChatbotId);
    });
  }
  if (d.facts !== undefined) records(d.facts, 'facts', (item, p) => {
    required(item, ['text', 'addedAt', 'source'], p); keys(item, ['text', 'addedAt', 'source'], p);
    stringFields(item, ['text'], p); timeFields(item, ['addedAt'], p);
    if (!['conversation', 'user_edit', 'batch'].includes(item.source as string)) issue(`${p}source`, '확인된 출처가 필요합니다.');
  });
  if (d.events !== undefined) records(d.events, 'events', (item, p) => {
    required(item, ['date', 'summary'], p); keys(item, ['date', 'summary', 'refJJumIds'], p);
    stringFields(item, ['summary'], p); timeFields(item, ['date'], p);
    if (item.refJJumIds !== undefined) stringArray(item.refJJumIds, `${p}refJJumIds`);
  });

  const mentionKeys = new Set<string>();
  const mentions = (value: unknown, path: string) => records(value, path, (item, p) => {
    required(item, ['hostChatbotId', 'conversationId', 'utteranceId', 'fingerprint', 'role', 'kind', 'counted', 'receivedAt', 'recordedAt'], p);
    keys(item, ['hostChatbotId', 'conversationId', 'utteranceId', 'fingerprint', 'role', 'kind', 'counted', 'receivedAt', 'recordedAt', 'occurredAt'], p);
    stringFields(item, ['hostChatbotId', 'conversationId', 'utteranceId'], p); timeFields(item, ['receivedAt', 'recordedAt', 'occurredAt'], p);
    if (typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(item.fingerprint)) issue(`${p}fingerprint`, '발화 변경 확인 SHA256이 필요합니다.');
    if (!(item.role === 'user' && ['initiated', 'prompted'].includes(item.kind as string)
      || item.role === 'assistant' && item.kind === 'host')) issue(`${p}kind`, '발화 역할과 종류가 맞지 않습니다.');
    if (typeof item.counted !== 'boolean' || item.counted !== (item.kind === 'initiated')) issue(`${p}counted`, '사용자 선행 언급만 집계합니다.');
    const key = JSON.stringify([item.conversationId, item.utteranceId]);
    if (mentionKeys.has(key)) issue(p.slice(0, -1), '같은 발화는 모든 묶음에서 한 번만 기록합니다.');
    mentionKeys.add(key);
  });
  if (d.mentionHistory !== undefined) {
    mentions(d.mentionHistory, 'mentionHistory');
    if (Array.isArray(d.mentionHistory) && d.mentionHistory.length > 10_000) issue('mentionHistory', '10,000건 이후에는 후속 묶음을 사용합니다.');
  }
  if (d.mentionHistoryChunks !== undefined) {
    if (!Array.isArray(d.mentionHistory) || d.mentionHistory.length !== 10_000) issue('mentionHistory', '후속 묶음 전 첫 묶음 10,000건이 필요합니다.');
    records(d.mentionHistoryChunks, 'mentionHistoryChunks', (item, p, i) => {
      required(item, ['sequence', 'entries'], p); keys(item, ['sequence', 'entries'], p);
      if (item.sequence !== i + 2) issue(`${p}sequence`, '2부터 연속 번호를 사용합니다.');
      mentions(item.entries, `${p}entries`);
      if (Array.isArray(item.entries) && (item.entries.length > 10_000
        || i < (d.mentionHistoryChunks as unknown[]).length - 1 && item.entries.length !== 10_000)) issue(`${p}entries`, '중간 묶음은 10,000건이며 마지막 묶음은 최대 10,000건입니다.');
    });
  }
  for (const name of ['recallHistory', 'hostProactiveMentionHistory']) if (d[name] !== undefined) {
    const seen = new Set<string>();
    records(d[name], name, (item, p) => {
      required(item, ['hostChatbotId', 'conversationId', 'utteranceId', 'timestamp'], p);
      keys(item, ['hostChatbotId', 'conversationId', 'utteranceId', 'timestamp'], p);
      stringFields(item, ['hostChatbotId', 'conversationId', 'utteranceId'], p); timeFields(item, ['timestamp'], p);
      const key = JSON.stringify([item.hostChatbotId, item.conversationId, item.utteranceId]);
      if (seen.has(key)) issue(p.slice(0, -1), '같은 실제 처리 이력이 중복되었습니다.');
      seen.add(key);
    });
  }
  if (d.recallHistory !== undefined && d.lastRecalled === undefined) issue('lastRecalled', '실제 회상 이력의 최근 시각이 필요합니다.', 'missing');
  if (d.lastRecalled !== undefined && d.recallHistory === undefined) issue('recallHistory', '최근 회상 시각의 근거 이력이 필요합니다.', 'missing');
  if (d.editHistory !== undefined) records(d.editHistory, 'editHistory', (item, p) => {
    required(item, ['date', 'action', 'by'], p);
    keys(item, ['date', 'action', 'by', 'field', 'memo', 'evidence', 'reviewRequested', 'introductionRevision'], p);
    timeFields(item, ['date'], p); stringFields(item, ['action', 'field'], p);
    if (!['user', 'ai', 'batch'].includes(item.by as string)) issue(`${p}by`, '수정 주체가 필요합니다.');
    if (item.memo !== undefined && !isLayaReviewText(item.memo)) issue(`${p}memo`, '수정 메모는 1~500자입니다.');
    if (item.reviewRequested !== undefined && typeof item.reviewRequested !== 'boolean') issue(`${p}reviewRequested`, 'boolean이 필요합니다.');
    if (item.introductionRevision !== undefined && (!Number.isSafeInteger(item.introductionRevision) || (item.introductionRevision as number) < 1)) issue(`${p}introductionRevision`, '양의 소개 revision이 필요합니다.');
    if (item.evidence !== undefined) {
      if (!object(item.evidence)) issue(`${p}evidence`, '수정 근거 객체가 필요합니다.');
      else {
        required(item.evidence, ['conversationId', 'utteranceIds'], `${p}evidence.`);
        keys(item.evidence, ['conversationId', 'utteranceIds'], `${p}evidence.`);
        stringFields(item.evidence, ['conversationId'], `${p}evidence.`);
        stringArray(item.evidence.utteranceIds, `${p}evidence.utteranceIds`);
      }
    }
  });
  if (d.responseFeedback !== undefined) records(d.responseFeedback, 'responseFeedback', (item, p) => {
    required(item, ['timestamp', 'result', 'cues'], p); keys(item, ['timestamp', 'result', 'cues', 'responseId'], p);
    timeFields(item, ['timestamp'], p); stringFields(item, ['result', 'responseId'], p); stringArray(item.cues, `${p}cues`, false);
  });

  const components = (value: unknown, p: string) => {
    if (!object(value)) { issue(p.slice(0, -1), '네 항의 기여값 객체가 필요합니다.'); return; }
    required(value, ['mention', 'duration', 'emotion', 'seon'], p); keys(value, ['mention', 'duration', 'emotion', 'seon'], p);
    for (const name of ['mention', 'duration', 'emotion', 'seon']) if (!finite(value[name]) || (value[name] as number) < 0) issue(`${p}${name}`, '유한한 음이 아닌 원값이 필요합니다.');
  };
  const calculation = (value: unknown, p: string, storedPower?: unknown) => {
    if (!object(value)) { issue(p.slice(0, -1), '계산 출처 객체가 필요합니다.'); return; }
    required(value, ['profileId', 'profileVersion', 'formula', 'coefficientDigest', 'policyVersion', 'evidence', 'contributions', 'calculatedAt'], p);
    keys(value, ['profileId', 'profileVersion', 'formula', 'coefficientDigest', 'policyVersion', 'evidence', 'rawScores', 'contributions', 'calculatedAt'], p);
    stringFields(value, ['profileId', 'profileVersion', 'coefficientDigest', 'policyVersion'], p); timeFields(value, ['calculatedAt'], p);
    if (!['root', 'logarithm'].includes(value.formula as string)) issue(`${p}formula`, '명시적으로 선택한 언급 수식이 필요합니다.');
    components(value.contributions, `${p}contributions.`);
    const contributions = value.contributions;
    if (object(contributions) && ['mention', 'duration', 'emotion', 'seon']
      .every(key => finite(contributions[key]) && (contributions[key] as number) >= 0)) {
      try {
        const expected = calculateJJumPower(contributions as unknown as PowerComponentsV5).power;
        if (finite(storedPower) && storedPower !== expected) issue(`${p}contributions`, '네 항의 하한을 적용한 원값 합과 저장 파워가 일치해야 합니다.');
      } catch {
        issue(`${p}contributions`, '계산 결과를 유한한 파워 원값으로 저장할 수 없습니다.');
      }
    }
    if (value.rawScores !== undefined) components(value.rawScores, `${p}rawScores.`);
    const seen = new Set<unknown>(), replaced = new Set<unknown>();
    records(value.evidence, `${p}evidence`, (item, ep) => {
      required(item, ['evidenceId', 'kind', 'data'], ep); keys(item, ['evidenceId', 'kind', 'data', 'occurredAt', 'replacesEvidenceId'], ep);
      stringFields(item, ['evidenceId', 'replacesEvidenceId'], ep); timeFields(item, ['occurredAt'], ep);
      if (!['mention', 'duration', 'emotion', 'seon'].includes(item.kind as string)) issue(`${ep}kind`, '근거 항이 필요합니다.');
      if (!object(item.data) || Object.keys(item.data).length === 0) issue(`${ep}data`, '실제 근거 자료가 필요합니다.');
      if (seen.has(item.evidenceId)) issue(`${ep}evidenceId`, '근거 ID가 중복되었습니다.');
      if (item.replacesEvidenceId !== undefined && (!seen.has(item.replacesEvidenceId) || replaced.has(item.replacesEvidenceId))) issue(`${ep}replacesEvidenceId`, '아직 대체되지 않은 앞선 근거를 정정해야 합니다.');
      if (item.replacesEvidenceId !== undefined) replaced.add(item.replacesEvidenceId);
      seen.add(item.evidenceId);
    });
  };
  if (d.powerCalculation !== undefined) calculation(d.powerCalculation, 'powerCalculation.', d.jjumPower);
  if (d.powerHistory !== undefined) {
    const seen = new Set<unknown>();
    records(d.powerHistory, 'powerHistory', (item, p) => {
      required(item, ['operationId', 'timestamp', 'previousPower', 'power', 'calculation'], p);
      keys(item, ['operationId', 'timestamp', 'previousPower', 'power', 'previousCalculation', 'calculation'], p);
      stringFields(item, ['operationId'], p); timeFields(item, ['timestamp'], p);
      for (const key of ['previousPower', 'power']) if (!finite(item[key]) || (item[key] as number) < 1) issue(`${p}${key}`, '파워 원값은 1 이상이어야 합니다.');
      if (seen.has(item.operationId)) issue(`${p}operationId`, '재계산 작업 ID가 중복되었습니다.');
      seen.add(item.operationId);
      calculation(item.calculation, `${p}calculation.`, item.power);
      if (item.previousCalculation !== undefined) calculation(item.previousCalculation, `${p}previousCalculation.`, item.previousPower);
    });
  }
  if (d.mannerHistory !== undefined) {
    const seen = new Set<unknown>();
    records(d.mannerHistory, 'mannerHistory', (item, p) => {
      required(item, ['evidenceId', 'timestamp', 'previousValue', 'value', 'policyVersion', 'reason'], p);
      keys(item, ['evidenceId', 'timestamp', 'previousValue', 'value', 'policyVersion', 'reason'], p);
      stringFields(item, ['evidenceId', 'policyVersion', 'reason'], p); timeFields(item, ['timestamp'], p);
      for (const key of ['previousValue', 'value']) if (!Number.isInteger(item[key]) || (item[key] as number) < -10 || (item[key] as number) > 10) issue(`${p}${key}`, '평가된 -10~10 정수가 필요합니다.');
      if (seen.has(item.evidenceId)) issue(`${p}evidenceId`, '동일 매너 근거가 중복되었습니다.');
      seen.add(item.evidenceId);
    });
  }

  if (d.seons !== undefined) {
    if (!object(d.seons)) issue('seons', '종류별 쩜선 객체가 필요합니다.');
    else {
      keys(d.seons, ['general', 'parentChild', 'upperLower'], 'seons.');
      const seenSeons = new Set<unknown>();
      const seenProfileDigests = new Map<string, string>();
      for (const kind of ['general', 'parentChild', 'upperLower']) if (d.seons[kind] !== undefined) {
        records(d.seons[kind], `seons.${kind}`, (item, p) => {
          const valueKey = kind === 'upperLower' ? 'receivedWeight' : 'weight';
          required(item, ['seonId', 'targetId', 'label', 'history', valueKey, ...(kind === 'general' ? [] : ['role'])], p);
          keys(item, ['seonId', 'targetId', 'label', 'history', 'lastActivated', valueKey, ...(kind === 'general' ? [] : ['role'])], p);
          stringFields(item, ['seonId', 'targetId', 'label'], p); timeFields(item, ['lastActivated'], p);
          if (item.targetId === d.jjumId) issue(`${p}targetId`, '같은 쩜으로 자가선을 만들 수 없습니다.');
          if (seenSeons.has(item.seonId)) issue(`${p}seonId`, '관계 ID가 중복되었습니다.');
          seenSeons.add(item.seonId);
          if (!finite(item[valueKey]) || (item[valueKey] as number) < 0) issue(`${p}${valueKey}`, '유한한 음이 아닌 누적 원값이 필요합니다.');
          if (kind === 'parentChild' && !['parent', 'child'].includes(item.role as string)
            || kind === 'upperLower' && !['upper', 'lower'].includes(item.role as string)) issue(`${p}role`, '관계 종류에 맞는 역할이 필요합니다.');
          const seen = new Map<unknown, number>(), replaced = new Set<unknown>();
          records(item.history, `${p}history`, (entry, ep) => {
            required(entry, ['evidenceId', 'conversationId', 'utteranceId', 'hostChatbotId', 'timestamp', 'delta'], ep);
            keys(entry, ['evidenceId', 'conversationId', 'utteranceId', 'hostChatbotId', 'timestamp', 'delta', 'occurredAt', 'replacesEvidenceId', 'calculationRef'], ep);
            stringFields(entry, ['evidenceId', 'conversationId', 'utteranceId', 'hostChatbotId', 'replacesEvidenceId'], ep);
            timeFields(entry, ['timestamp', 'occurredAt'], ep);
            if (!finite(entry.delta)) issue(`${ep}delta`, '유한한 가산 원값이 필요합니다.');
            if (seen.has(entry.evidenceId)) issue(`${ep}evidenceId`, '같은 근거의 중복 가산은 허용하지 않습니다.');
            if (entry.replacesEvidenceId !== undefined && (!seen.has(entry.replacesEvidenceId) || replaced.has(entry.replacesEvidenceId))) issue(`${ep}replacesEvidenceId`, '아직 대체되지 않은 앞선 근거를 정정해야 합니다.');
            if (entry.replacesEvidenceId !== undefined) replaced.add(entry.replacesEvidenceId);
            seen.set(entry.evidenceId, entry.delta as number);
            if (entry.calculationRef !== undefined) {
              if (!object(entry.calculationRef)) issue(`${ep}calculationRef`, '계산 출처 객체가 필요합니다.');
              else {
                const fields = ['profileId', 'profileVersion', 'rule', 'coefficientDigest', 'ruleVersion'];
                required(entry.calculationRef, fields, `${ep}calculationRef.`);
                keys(entry.calculationRef, [...fields, 'packageVersion'], `${ep}calculationRef.`);
                stringFields(entry.calculationRef, [...fields, 'packageVersion'], `${ep}calculationRef.`);
                const reference = entry.calculationRef;
                if (string(reference.profileId) && string(reference.profileVersion) && string(reference.coefficientDigest)) {
                  const profileKey = JSON.stringify([reference.profileId, reference.profileVersion]);
                  const digest = seenProfileDigests.get(profileKey);
                  if (digest !== undefined && digest !== reference.coefficientDigest) issue(`${ep}calculationRef.coefficientDigest`, '같은 프로필 버전에 서로 다른 계수가 기록되었습니다.');
                  seenProfileDigests.set(profileKey, reference.coefficientDigest);
                }
              }
            }
          });
          const sum = [...seen].filter(([id]) => !replaced.has(id)).reduce((total, [, delta]) => total + delta, 0);
          if (finite(item[valueKey]) && (!Number.isFinite(sum) || Math.abs(sum - item[valueKey]) > Number.EPSILON * Math.max(1, Math.abs(sum), Math.abs(item[valueKey])) * Math.max(4, seen.size * 4))) issue(`${p}${valueKey}`, '누적값은 정정 후 유효 근거의 합이어야 합니다.');
        });
      }
    }
  }

  if (options.requireTypePolicies !== false && Array.isArray(d.type)) {
    const getPath = (path: string): unknown => {
      const parts = path.split('.');
      if (parts.some(part => !part || ['__proto__', 'constructor', 'prototype'].includes(part)) || parts[0] === 'meta') return undefined;
      let value: unknown = d;
      for (const part of parts) {
        if (!object(value) && !Array.isArray(value)) return undefined;
        if (!Object.hasOwn(value, part)) return undefined;
        value = (value as Obj)[part];
      }
      return value;
    };
    const allowedPath = (path: unknown): path is string => typeof path === 'string' && path.length > 0
      && !path.split('.').some(part => !part || ['meta', '__proto__', 'constructor', 'prototype'].includes(part))
      && [...REQUIRED, ...OPTIONAL].includes(path.split('.')[0] as typeof REQUIRED[number]);
    for (const type of d.type.filter(string)) {
      const rule = options.typeRequirements && Object.hasOwn(options.typeRequirements, type) ? options.typeRequirements[type] : undefined;
      if (!rule || !object(rule) || Object.keys(rule).some(key => !['required', 'conditional'].includes(key))
        || !Array.isArray(rule.required) || !rule.required.every(allowedPath)) {
        policyPending.push(type); issue(`type.${type}`, '타입별 필수 정보 정책이 준비되지 않았습니다.', 'policy_pending'); continue;
      }
      const checkRequired = (paths: string[]) => {
        for (const path of paths) if (!present(getPath(path))) issue(path, `${type} 타입에 필요한 정보가 없습니다.`, 'missing');
      };
      checkRequired(rule.required);
      if (rule.conditional !== undefined && !Array.isArray(rule.conditional)) {
        issue(`type.${type}`, '조건부 필수 정책이 유효하지 않습니다.', 'policy_pending'); policyPending.push(type); continue;
      }
      for (const condition of rule.conditional ?? []) {
        if (!object(condition) || !object(condition.when) || !allowedPath(condition.when.path)
          || Object.keys(condition).some(key => !['when', 'required'].includes(key))
          || Object.keys(condition.when).some(key => !['path', 'equals', 'exists'].includes(key))
          || Object.hasOwn(condition.when, 'exists') === Object.hasOwn(condition.when, 'equals')
          || !Array.isArray(condition.required) || !condition.required.every(allowedPath)
          || (Object.hasOwn(condition.when, 'exists') ? typeof (condition.when as unknown as Obj).exists !== 'boolean'
            : !Object.hasOwn(condition.when, 'equals') || !jsonValue((condition.when as unknown as Obj).equals))) {
          issue(`type.${type}`, '조건부 필수 정책이 유효하지 않습니다.', 'policy_pending'); policyPending.push(type); continue;
        }
        const actual = getPath(condition.when.path);
        if (!Object.hasOwn(condition.when, 'exists') && !present(actual)) {
          issue(condition.when.path, `${type} 타입의 조건을 판단할 정보가 없습니다.`, 'missing');
          continue;
        }
        const matches = Object.hasOwn(condition.when, 'exists') ? present(actual) === (condition.when as unknown as Obj).exists
          : isDeepStrictEqual(actual, (condition.when as unknown as Obj).equals);
        if (matches) checkRequired(condition.required);
      }
    }
  }
  return result();
}

/** 단건 형식 검증 뒤 같은 소유자의 실제 양쪽 저장 자료를 함께 검사한다. */
export function validateSeonCounterpartsV5(jjum: JJumV5, related: readonly JJumV5[]): JJumV5Issue[] {
  const issues: JJumV5Issue[] = [];
  const opposite: Record<string, string> = { parent: 'child', child: 'parent', upper: 'lower', lower: 'upper' };
  for (const kind of ['general', 'parentChild', 'upperLower'] as const) {
    for (const seon of jjum.seons?.[kind] ?? []) {
      const path = `seons.${kind}.${seon.seonId}`;
      const target = related.find(item => item.ownerId === jjum.ownerId && item.jjumId === seon.targetId);
      const peer = target?.seons?.[kind]?.find(item => item.seonId === seon.seonId && item.targetId === jjum.jjumId);
      if (!peer) {
        issues.push({ code: 'missing', path, message: '같은 소유자의 상대 쩜에 대응 관계가 필요합니다.' }); continue;
      }
      if ('role' in seon && (!('role' in peer) || opposite[seon.role] !== peer.role)) {
        issues.push({ code: 'invalid', path: `${path}.role`, message: '대응 관계의 역할은 서로 반대여야 합니다.' });
      }
      if ('weight' in seon && (!('weight' in peer) || seon.weight !== peer.weight)) {
        issues.push({ code: 'invalid', path: `${path}.weight`, message: '일반·부모자식의 공유 누적값은 양쪽에서 같아야 합니다.' });
      }
      const peerEvidence = new Map(peer.history.map(item => [item.evidenceId, item]));
      if (peerEvidence.size !== seon.history.length) issues.push({ code: 'invalid', path: `${path}.history`, message: '양쪽 관계의 근거 목록이 다릅니다.' });
      for (const item of seon.history) {
        const other = peerEvidence.get(item.evidenceId);
        if (!other || !isDeepStrictEqual({ ...item, delta: undefined }, { ...other, delta: undefined })
          || kind !== 'upperLower' && item.delta !== other.delta) {
          issues.push({ code: 'invalid', path: `${path}.history.${item.evidenceId}`, message: '동일 관계 근거의 출처 또는 공유 가산값이 일치하지 않습니다.' });
        }
      }
    }
  }
  return issues;
}
