// @editedBy SherrySherry 2026-10-31
import { createHash } from 'node:crypto';
import type { ConversationTurn } from './adapters/aiAdapter.ts';
import type { JJumV5 } from './types/jjumV5.ts';

export interface V5ManualReviewEvidence {
  id: string;
  text: string;
  field?: string;
  at?: number;
}
export interface V5ReviewEvidence {
  turns: ConversationTurn[];
  /** 실제 확정 발화 ID 또는 인증된 수정 내역 ID. 모델이 선택한 인용이라는 뜻은 아니다. */
  evidenceRefs: string[];
  manualEdits: V5ManualReviewEvidence[];
}
export type V5ReviewEvidenceInput = Partial<V5ReviewEvidence>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export function v5ReviewDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** 본문·대상·관계 의미만 비교한다. 숫자 재계산과 통계는 본문 재검토 사유가 아니다. */
export function v5ReviewContent(jjum: JJumV5): Record<string, unknown> {
  return {
    jjumName: jjum.jjumName, type: jjum.type, summary: jjum.summary,
    aliases: jjum.aliases, jjtags: jjum.jjtags, facts: jjum.facts, events: jjum.events,
    context: jjum.context, typeDetails: jjum.typeDetails,
    visibility: jjum.visibility, sensitivity: jjum.sensitivity,
    seons: Object.fromEntries((['general', 'parentChild', 'upperLower'] as const)
      .filter(kind => jjum.seons?.[kind]?.length)
      .map(kind => [kind, jjum.seons![kind]!.map(seon => ({
        seonId: seon.seonId, targetId: seon.targetId, label: seon.label,
        ...('role' in seon ? { role: seon.role } : {}),
      }))])),
  };
}
export const v5ReviewContentDigest = (jjum: JJumV5): string => v5ReviewDigest(v5ReviewContent(jjum));

/** 근거 ID는 전달된 실제 원문에만 연결한다. 미확정 입력은 문맥으로만 남긴다. */
export function prepareV5ReviewEvidence(input: V5ReviewEvidenceInput = {}): V5ReviewEvidence {
  const turns = structuredClone(input.turns ?? []);
  const manualEdits = structuredClone(input.manualEdits ?? []);
  const ids = new Set<string>();
  const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const time = (value: unknown) => value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
  if (!Array.isArray(turns) || !Array.isArray(manualEdits)) throw new Error('Invalid v5 review evidence');
  for (const turn of turns) {
    if (!turn || !['user', 'assistant'].includes(turn.role) || !text(turn.text)
      || !time(turn.at) || !time(turn.receivedAt)
      || (turn.final !== undefined && typeof turn.final !== 'boolean')
      || (turn.utteranceId !== undefined && !text(turn.utteranceId))) throw new Error('Invalid v5 review turn');
    if (turn.utteranceId && turn.final !== false) {
      if (ids.has(turn.utteranceId)) throw new Error('Duplicate v5 review evidence identity');
      ids.add(turn.utteranceId);
    }
  }
  for (const edit of manualEdits) {
    if (!edit || !text(edit.id) || !text(edit.text) || !time(edit.at)
      || (edit.field !== undefined && !text(edit.field)) || ids.has(edit.id)) throw new Error('Invalid v5 manual review evidence');
    ids.add(edit.id);
  }
  const evidenceRefs = structuredClone(input.evidenceRefs ?? [...ids]);
  if (!Array.isArray(evidenceRefs) || new Set(evidenceRefs).size !== evidenceRefs.length
    || evidenceRefs.some(ref => !text(ref) || !ids.has(ref))) throw new Error('Unresolved v5 review evidence reference');
  return { turns, manualEdits, evidenceRefs };
}
