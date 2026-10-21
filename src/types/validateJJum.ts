// @editedBy SherrySherry 2026-10-21
/**
 * 쩜(JJum) 스키마 v4 검증기 — 손으로 고친 JSON 파일도 안전하게 로드하기 위한 관용적 검증.
 *
 * 정책:
 * - 하드 필수(jjumId · jjumName · ownerId)가 없으면 로드 실패(ok=false).
 * - 그 외 필드는 기본값을 채워서 살린다 — 사람이 파일을 고치다 필드를 지워도 깨지지 않는다.
 * - 고친 흔적이 스키마와 어긋나면 errors에 리포트하되, 살릴 수 있으면 살린다.
 */

import type {
  EditActor,
  FactSource,
  JJum,
  JJumTimestamp,
  JJumEditEntry,
  JJumEvent,
  JJumFact,
  JJumMention,
  JJumMentionChunk,
  Seon,
  JJumStatus,
} from './jjum.ts';
import { SCHEMA_VERSION } from './jjum.ts';
import { isLayaTag, isLayaReviewText } from '../layaReview.ts';
import { isMentionRelationTargets } from '../conversationRelationPlan.ts';

export interface ValidationResult {
  ok: boolean;
  /** 하드 실패 사유 + 살리면서 고친 항목 리포트 */
  errors: string[];
  /** ok=true일 때 정규화된 쩜 */
  jjum?: JJum;
  /** 중복 방지 이력이 손상되면 저장 어댑터가 해당 소유자의 처리를 중단해야 한다. */
  invalidMentionHistory?: boolean;
  /** 손상된 검토·수정 근거를 조용히 버리지 않고 해당 소유자의 처리를 중단한다. */
  invalidLayaReview?: boolean;
}

const STATUSES: JJumStatus[] = ['active', 'resting', 'archived', 'merged'];
const FACT_SOURCES: FactSource[] = ['conversation', 'user_edit', 'batch'];
const EDIT_ACTORS: EditActor[] = ['user', 'ai', 'batch'];

function str(v: unknown): v is string {
  return typeof v === 'string';
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(str);
}

function readMentionHistory(
  value: unknown,
  field: string,
  seen: Set<string>,
): { history?: JJumMention[]; errors: string[] } {
  if (!Array.isArray(value)) return { errors: [`${field}: 배열이어야 함`] };
  const history: JJumMention[] = [];
  const errors: string[] = [];
  const validId = (id: unknown): id is string => typeof id === 'string' && id.trim() !== '' && id.length <= 512;
  const validTime = (time: unknown): time is number => typeof time === 'number' && Number.isFinite(time) && time >= 0;
  for (let i = 0; i < value.length; i++) {
    const entry: unknown = value[i];
    const prefix = `${field}[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(`${prefix}: 객체여야 함`);
      continue;
    }
    const item = entry as Record<string, unknown>;
    if (!validId(item.conversationId) || !validId(item.utteranceId)) {
      errors.push(`${prefix}: 대화·발화 ID 오류`);
      continue;
    }
    const key = JSON.stringify([item.conversationId, item.utteranceId]);
    if (seen.has(key)) errors.push(`${prefix}: 동일 대화·발화 중복`);
    seen.add(key);
    const validRoleKind = (item.role === 'assistant' && item.kind === 'host')
      || (item.role === 'user' && (item.kind === 'initiated' || item.kind === 'prompted'));
    if (!validRoleKind) errors.push(`${prefix}: 역할·언급 종류 오류`);
    if (typeof item.counted !== 'boolean' || item.counted !== (item.kind === 'initiated')) {
      errors.push(`${prefix}: 집계 여부 오류`);
    }
    if (!validTime(item.receivedAt) || !validTime(item.recordedAt)
      || (item.occurredAt !== undefined && !validTime(item.occurredAt))) {
      errors.push(`${prefix}: 시각 오류`);
    }
    if (typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(item.fingerprint)) {
      errors.push(`${prefix}: 발화 변경 확인 해시 오류`);
    }
    if (item.relationTargets !== undefined && !isMentionRelationTargets(item.relationTargets)) {
      errors.push(`${prefix}: 저장된 관계 계획 오류`);
    }
    history.push({ ...item } as JJumMention);
  }
  return errors.length > 0 ? { errors } : { history, errors };
}

function readMentionHistoryChunks(
  value: unknown,
  seen: Set<string>,
): { chunks?: JJumMentionChunk[]; errors: string[] } {
  if (!Array.isArray(value)) return { errors: ['mentionHistoryChunks: 배열이어야 함'] };
  const chunks: JJumMentionChunk[] = [];
  const errors: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const chunk: unknown = value[i];
    const prefix = `mentionHistoryChunks[${i}]`;
    if (typeof chunk !== 'object' || chunk === null || Array.isArray(chunk)) {
      errors.push(`${prefix}: 객체여야 함`);
      continue;
    }
    const item = chunk as Record<string, unknown>;
    if (item.sequence !== i + 2) errors.push(`${prefix}: 묶음 번호는 2부터 연속이어야 함`);
    const mentions = readMentionHistory(item.entries, `${prefix}.entries`, seen);
    errors.push(...mentions.errors);
    if (mentions.history?.length === 0) errors.push(`${prefix}.entries: 빈 묶음은 저장할 수 없음`);
    if (mentions.history) chunks.push({ ...item, entries: mentions.history } as JJumMentionChunk);
  }
  return errors.length > 0 ? { errors } : { chunks, errors };
}

export function validateJJum(data: unknown, now: JJumTimestamp = Date.now()): ValidationResult {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['쩜이 JSON 객체가 아님'] };
  }
  const d = data as Record<string, unknown>;

  for (const key of ['jjumId', 'jjumName', 'ownerId'] as const) {
    if (!str(d[key]) || (d[key] as string).trim() === '') {
      errors.push(`하드 필수 필드 누락/오류: ${key}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const seenMentions = new Set<string>();
  const mentions = d.mentionHistory === undefined
    ? undefined : readMentionHistory(d.mentionHistory, 'mentionHistory', seenMentions);
  const mentionChunks = d.mentionHistoryChunks === undefined
    ? undefined : readMentionHistoryChunks(d.mentionHistoryChunks, seenMentions);
  const mentionErrors = [...(mentions?.errors ?? []), ...(mentionChunks?.errors ?? [])];
  if (mentionChunks?.chunks?.length && !mentions?.history?.length) {
    mentionErrors.push('mentionHistory: 후속 묶음이 있으면 비어 있지 않은 첫 묶음이 필요함');
  }
  if (mentionErrors.length > 0) {
    return { ok: false, errors: mentionErrors, invalidMentionHistory: true };
  }

  const reviewErrors: string[] = [];
  if (d.layaTag !== undefined && !isLayaTag(d.layaTag)) {
    reviewErrors.push('layaTag: 검토 상태·판정·이유·시간대 포함 시각 오류');
  }
  if (Array.isArray(d.editHistory)) {
    const validId = (value: unknown): value is string =>
      typeof value === 'string' && value.trim() !== '' && value.length <= 512;
    for (let i = 0; i < d.editHistory.length; i++) {
      const entry: unknown = d.editHistory[i];
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      const prefix = `editHistory[${i}]`;
      if (item.memo !== undefined && !isLayaReviewText(item.memo)) reviewErrors.push(`${prefix}.memo: 짧은 수정 이유 필요`);
      if (item.reviewRequested !== undefined && typeof item.reviewRequested !== 'boolean') {
        reviewErrors.push(`${prefix}.reviewRequested: boolean이어야 함`);
      }
      if (item.evidence !== undefined) {
        const evidence = item.evidence;
        if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) {
          reviewErrors.push(`${prefix}.evidence: 대화·발화 근거 객체 필요`);
        } else {
          const e = evidence as Record<string, unknown>;
          if (!validId(e.conversationId) || !Array.isArray(e.utteranceIds)
            || e.utteranceIds.length === 0 || !e.utteranceIds.every(validId)
            || new Set(e.utteranceIds).size !== e.utteranceIds.length) {
            reviewErrors.push(`${prefix}.evidence: 대화·발화 ID 오류`);
          }
        }
      }
      if ((item.memo !== undefined || item.evidence !== undefined || item.reviewRequested !== undefined)
        && (!str(item.action) || item.action.trim() === '')) {
        reviewErrors.push(`${prefix}.action: 수정 기록의 작업명 필요`);
      }
    }
  }
  if (reviewErrors.length > 0) return { ok: false, errors: reviewErrors, invalidLayaReview: true };

  const facts: JJumFact[] = [];
  if (Array.isArray(d.facts)) {
    for (const f of d.facts) {
      if (typeof f === 'object' && f !== null && str((f as Record<string, unknown>).text)) {
        const fr = f as Record<string, unknown>;
        facts.push({
          text: fr.text as string,
          addedAt: toNumber(fr.addedAt, now),
          source: FACT_SOURCES.includes(fr.source as FactSource) ? (fr.source as FactSource) : 'user_edit',
        });
      } else {
        errors.push('facts: text 없는 항목 제외');
      }
    }
  }

  const events: JJumEvent[] = [];
  if (Array.isArray(d.events)) {
    for (const e of d.events) {
      if (typeof e === 'object' && e !== null && str((e as Record<string, unknown>).summary)) {
        const er = e as Record<string, unknown>;
        events.push({
          date: toNumber(er.date, now),
          summary: er.summary as string,
          refJJumIds: toStringArray(er.refJJumIds),
        });
      } else {
        errors.push('events: summary 없는 항목 제외');
      }
    }
  }

  const seons: Seon[] = [];
  if (Array.isArray(d.seons)) {
    for (const s of d.seons) {
      if (typeof s === 'object' && s !== null && str((s as Record<string, unknown>).targetId)) {
        const sr = s as Record<string, unknown>;
        seons.push({
          targetId: sr.targetId as string,
          weight: toNumber(sr.weight, 1),
          ...(str(sr.label) ? { label: sr.label as string } : {}),
          lastActivated: toNumber(sr.lastActivated, now),
        });
      } else {
        errors.push('seons: targetId 없는 항목 제외');
      }
    }
  }

  const editHistory: JJumEditEntry[] = [];
  if (Array.isArray(d.editHistory)) {
    for (const h of d.editHistory) {
      if (typeof h === 'object' && h !== null && str((h as Record<string, unknown>).action)) {
        const hr = h as Record<string, unknown>;
        editHistory.push({
          ...hr,
          date: toNumber(hr.date, now),
          action: hr.action as string,
          ...(str(hr.field) ? { field: hr.field as string } : {}),
          by: EDIT_ACTORS.includes(hr.by as EditActor) ? (hr.by as EditActor) : 'user',
        });
      }
    }
  }

  let status: JJumStatus = 'active';
  if (STATUSES.includes(d.status as JJumStatus)) {
    status = d.status as JJumStatus;
  } else if (d.status !== undefined) {
    errors.push(`status 값 오류("${String(d.status)}") → active로 복구`);
  }

  const jjum: JJum = {
    jjumId: (d.jjumId as string).trim(),
    jjumName: (d.jjumName as string).trim(),
    aliases: toStringArray(d.aliases),
    type: str(d.type) && d.type.trim() !== '' ? d.type : 'unknown',
    jjtags: toStringArray(d.jjtags ?? d.tags),
    ...(Array.isArray(d.tags) ? { tags: toStringArray(d.tags) } : {}),
    summary: str(d.summary) ? d.summary : '',
    facts,
    events,
    ...(typeof d.context === 'object' && d.context !== null && !Array.isArray(d.context)
      ? { context: d.context as Record<string, unknown> }
      : {}),
    seons,
    mentionCount: toNumber(d.mentionCount, 0),
    ...(mentions ? { mentionHistory: mentions.history! } : {}),
    ...(mentionChunks ? { mentionHistoryChunks: mentionChunks.chunks! } : {}),
    firstSeen: toNumber(d.firstSeen, now),
    lastMentioned: toNumber(d.lastMentioned, now),
    recallCount: toNumber(d.recallCount, 0),
    ...(typeof d.lastRecalled === 'number' ? { lastRecalled: d.lastRecalled } : {}),
    pinned: typeof d.pinned === 'boolean' ? d.pinned : false,
    status,
    mergedFrom: toStringArray(d.mergedFrom),
    ...(str(d.mergedInto) ? { mergedInto: d.mergedInto as string } : {}),
    editHistory,
    ...(isLayaTag(d.layaTag) ? { layaTag: { ...d.layaTag } } : {}),
    responseFeedback: Array.isArray(d.responseFeedback)
      ? d.responseFeedback
          .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
          .map((entry) => ({
            timestamp: toNumber(entry.timestamp, now),
            result: str(entry.result) ? entry.result : '',
            cues: toStringArray(entry.cues),
            ...(str(entry.responseId) ? { responseId: entry.responseId } : {}),
          }))
      : [],
    meta:
      typeof d.meta === 'object' && d.meta !== null && !Array.isArray(d.meta)
        ? (d.meta as Record<string, unknown>)
        : {},
    ownerId: (d.ownerId as string).trim(),
    sourceService: str(d.sourceService) && d.sourceService.trim() !== '' ? d.sourceService : 'unknown',
    schemaVersion: toNumber(d.schemaVersion, SCHEMA_VERSION),
  };

  return { ok: true, errors, jjum };
}
