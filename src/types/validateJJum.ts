// @editedBy SherrySherry 2026-09-12
/**
 * 점(JJum) 스키마 v3 검증기 — 손으로 고친 JSON 파일도 안전하게 로드하기 위한 관용적 검증.
 *
 * 정책:
 * - 하드 필수(jjumId · canonicalName · ownerId)가 없으면 로드 실패(ok=false).
 * - 그 외 필드는 기본값을 채워서 살린다 — 사람이 파일을 고치다 필드를 지워도 깨지지 않는다.
 * - 고친 흔적이 스키마와 어긋나면 errors에 리포트하되, 살릴 수 있으면 살린다.
 */

import type {
  EditActor,
  FactSource,
  JJum,
  HaemaTimestamp,
  JjumEditEntry,
  JjumEvent,
  JjumFact,
  Seon,
  JjumStatus,
} from './jjum.ts';
import { SCHEMA_VERSION } from './jjum.ts';

export interface ValidationResult {
  ok: boolean;
  /** 하드 실패 사유 + 살리면서 고친 항목 리포트 */
  errors: string[];
  /** ok=true일 때 정규화된 점 */
  cell?: JJum;
}

const STATUSES: JjumStatus[] = ['active', 'archived', 'merged'];
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

export function validateJJum(data: unknown, now: HaemaTimestamp = Date.now()): ValidationResult {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['점이 JSON 객체가 아님'] };
  }
  const d = data as Record<string, unknown>;

  for (const key of ['jjumId', 'canonicalName', 'ownerId'] as const) {
    if (!str(d[key]) || (d[key] as string).trim() === '') {
      errors.push(`하드 필수 필드 누락/오류: ${key}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const facts: JjumFact[] = [];
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

  const events: JjumEvent[] = [];
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

  const editHistory: JjumEditEntry[] = [];
  if (Array.isArray(d.editHistory)) {
    for (const h of d.editHistory) {
      if (typeof h === 'object' && h !== null && str((h as Record<string, unknown>).action)) {
        const hr = h as Record<string, unknown>;
        editHistory.push({
          date: toNumber(hr.date, now),
          action: hr.action as string,
          ...(str(hr.field) ? { field: hr.field as string } : {}),
          by: EDIT_ACTORS.includes(hr.by as EditActor) ? (hr.by as EditActor) : 'user',
        });
      }
    }
  }

  let status: JjumStatus = 'active';
  if (STATUSES.includes(d.status as JjumStatus)) {
    status = d.status as JjumStatus;
  } else if (d.status !== undefined) {
    errors.push(`status 값 오류("${String(d.status)}") → active로 복구`);
  }

  const cell: JJum = {
    jjumId: (d.jjumId as string).trim(),
    canonicalName: (d.canonicalName as string).trim(),
    aliases: toStringArray(d.aliases),
    type: str(d.type) && d.type.trim() !== '' ? d.type : 'unknown',
    tags: toStringArray(d.tags),
    summary: str(d.summary) ? d.summary : '',
    facts,
    events,
    seons,
    mentionCount: toNumber(d.mentionCount, 0),
    firstSeen: toNumber(d.firstSeen, now),
    lastMentioned: toNumber(d.lastMentioned, now),
    recallCount: toNumber(d.recallCount, 0),
    pinned: typeof d.pinned === 'boolean' ? d.pinned : false,
    status,
    mergedFrom: toStringArray(d.mergedFrom),
    ...(str(d.mergedInto) ? { mergedInto: d.mergedInto as string } : {}),
    editHistory,
    meta:
      typeof d.meta === 'object' && d.meta !== null && !Array.isArray(d.meta)
        ? (d.meta as Record<string, unknown>)
        : {},
    ownerId: (d.ownerId as string).trim(),
    sourceService: str(d.sourceService) && d.sourceService.trim() !== '' ? d.sourceService : 'unknown',
    schemaVersion: toNumber(d.schemaVersion, SCHEMA_VERSION),
  };

  return { ok: true, errors, cell };
}
