// @editedBy SherrySherry 2026-09-13
/** 점(JJum) 생성 헬퍼 — 스키마 v3 기본값을 채워 새 점을 만든다. */

import { randomUUID } from 'node:crypto';
import type { JJum, JJumFact, JjumEvent, Seon, JjumEditEntry, HaemaTimestamp } from './types/jjum.ts';
import { SCHEMA_VERSION } from './types/jjum.ts';

export interface CreateJJumInput {
  ownerId: string;
  canonicalName: string;
  type?: string;
  aliases?: string[];
  tags?: string[];
  summary?: string;
  sourceService?: string;
  /** 서비스별 자유 확장 — Haema는 내용을 해석하지 않는다 */
  meta?: Record<string, unknown>;
  now?: HaemaTimestamp;
}

export function createJJum(input: CreateJJumInput): JJum {
  const now = input.now ?? Date.now();
  return {
    jjumId: randomUUID(),
    canonicalName: input.canonicalName.trim(),
    aliases: input.aliases ?? [],
    type: input.type ?? 'unknown',
    tags: input.tags ?? [],
    summary: input.summary ?? '',
    facts: [] as JJumFact[],
    events: [] as JjumEvent[],
    seons: [] as Seon[],
    mentionCount: 1,
    firstSeen: now,
    lastMentioned: now,
    recallCount: 0,
    pinned: false,
    status: 'active',
    mergedFrom: [] as string[],
    editHistory: [] as JjumEditEntry[],
    meta: input.meta ?? {},
    ownerId: input.ownerId,
    sourceService: input.sourceService ?? 'unknown',
    schemaVersion: SCHEMA_VERSION,
  };
}
