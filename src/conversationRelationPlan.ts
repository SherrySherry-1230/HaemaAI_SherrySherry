// @editedBy SherrySherry 2026-10-21
import type { JJumMentionRelationTarget } from './types/jjum.ts';

/** 저장된 발화의 관계 계획이 손상되면 새 AI 응답으로 대신하지 않는다. */
export function isMentionRelationTargets(value: unknown): value is JJumMentionRelationTarget[] {
  if (!Array.isArray(value)) return false;
  const validId = (id: unknown): id is string =>
    typeof id === 'string' && id.trim() !== '' && id.length <= 512;
  const ids = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    const target = entry as Record<string, unknown>;
    if (!validId(target.jjumId) || ids.has(target.jjumId)) return false;
    ids.add(target.jjumId);
    if (target.creation === undefined) continue;
    if (typeof target.creation !== 'object' || target.creation === null || Array.isArray(target.creation)) return false;
    const creation = target.creation as Record<string, unknown>;
    if (!Array.isArray(creation.names) || creation.names.length === 0
      || !creation.names.every((name) => typeof name === 'string' && name.trim() !== '')
      || new Set(creation.names).size !== creation.names.length
      || !Array.isArray(creation.utteranceIds) || creation.utteranceIds.length === 0
      || !creation.utteranceIds.every(validId)
      || new Set(creation.utteranceIds).size !== creation.utteranceIds.length) return false;
  }
  return true;
}
