// @editedBy SherrySherry 2026-09-06
/**
 * 고민 세포 정책 (2단계 확정 2026-09-06)
 *
 * - type "고민" 은 정식 종류. 상태는 meta 가 아니라 H-tag 로 — "미해결" / "해결".
 * - 해결되면 "미해결" 태그를 떼고(→ "해결") 사건으로 남긴다.
 * - 부정 valence 여도 미해결 고민이면 먼저 말 걸 거리 후보에 오를 수 있다 — 단 careful 표시.
 *   답변 가이드 mode 는 "조심 안부": 내용을 먼저 말하지 말고 "고민 있어?" 수준으로만 연다.
 * - 상처(부정인 사건·인물 등)는 기존대로 먼저 꺼내지 않는다.
 */

import type { JJum, HaemaTimestamp } from './types/jjum.ts';

export const CONCERN_TYPE = '고민';
export const TAG_UNRESOLVED = '미해결';
export const TAG_RESOLVED = '해결';

/** "조심 안부" 모드가 호스트에게 주는 지시 — 말은 호스트가 만든다 */
export const CAREFUL_INSTRUCTION = '내용을 먼저 말하지 말 것. "고민 있어?" 수준으로만 문을 연다. 유저가 꺼내면 그때 알아봐 준다.';

const norm = (s: string): string => s.trim().toLowerCase();

export function isConcern(cell: Pick<JJum, 'type'>): boolean {
  return norm(cell.type) === CONCERN_TYPE;
}

export function isUnresolvedConcern(cell: Pick<JJum, 'type' | 'tags'>): boolean {
  return isConcern(cell) && cell.tags.some((t) => norm(t) === TAG_UNRESOLVED);
}

/**
 * 고민을 해결 상태로 바꾼다 — 미해결 태그를 떼고 해결 태그를 달며, 해결 시점을 사건으로 남긴다.
 * 세포를 제자리에서 고치고 같은 객체를 돌려준다 (저장은 호출자가).
 */
export function resolveConcern(cell: JJum, now: HaemaTimestamp, note?: string): JJum {
  cell.tags = cell.tags.filter((t) => norm(t) !== TAG_UNRESOLVED);
  if (!cell.tags.some((t) => norm(t) === TAG_RESOLVED)) cell.tags.push(TAG_RESOLVED);
  cell.events.push({ date: now, summary: note ? `해결: ${note}` : '해결됨', refJJumIds: [] });
  cell.editHistory.push({ date: now, action: 'resolve', field: 'tags', by: 'user' });
  return cell;
}
