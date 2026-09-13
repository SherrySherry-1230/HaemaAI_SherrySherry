// @editedBy SherrySherry 2026-09-13
/**
 * 선(Seon) 중복 규칙 — 블루프린트의 "핀 여러 개" (2026-09-06 확정, 2026-09-13 용어 교체)
 *
 * - 같은 두 점 사이에 라벨이 다르면 선 여러 개 허용 (예: "이전 동거" + "이사 원인").
 * - 라벨이 같은 선이 또 들어오면 새로 만들지 않고 기존 weight를 올린다.
 * - 회상 점수는 같은 상대로 가는 선 중 가장 굵은 것 기준 (2-a "강한 경로 우선"과 같은 원칙).
 */

import type { JJumId, JJum, HaemaTimestamp, Seon } from './types/jjum.ts';

const sameLabel = (a: string | undefined, b: string | undefined): boolean => (a ?? '') === (b ?? '');

/** 같은 상대로 가는 선 전부 */
export function tailsTo(cell: Pick<JJum, 'seons'>, targetId: JJumId): Seon[] {
  return cell.seons.filter((t) => t.targetId === targetId);
}

/** 같은 상대로 가는 선 중 가장 굵은 것 — 회상 점수의 기준 */
export function strongestTail(cell: Pick<JJum, 'seons'>, targetId: JJumId): Seon | undefined {
  return tailsTo(cell, targetId).reduce<Seon | undefined>((best, t) => (!best || t.weight > best.weight ? t : best), undefined);
}

/** 상대별로 가장 굵은 선만 남긴 목록 — 확산 시 상대 하나당 한 번만 따라간다 */
export function strongestTails(cell: Pick<JJum, 'seons'>): Seon[] {
  const best = new Map<JJumId, Seon>();
  for (const t of cell.seons) {
    const prev = best.get(t.targetId);
    if (!prev || t.weight > prev.weight) best.set(t.targetId, t);
  }
  return [...best.values()];
}

/**
 * 선 추가/강화 — 같은 상대·같은 라벨이면 weight를 올리고, 라벨이 다르면 새 선을 단다.
 * 점을 제자리에서 고치고 해당 선을 돌려준다 (저장은 호출자가).
 */
export function upsertTail(
  cell: JJum,
  targetId: JJumId,
  weight: number,
  label: string | undefined,
  now: HaemaTimestamp,
): Seon {
  const existing = cell.seons.find((t) => t.targetId === targetId && sameLabel(t.label, label));
  if (existing) {
    existing.weight += weight;
    existing.lastActivated = now;
    return existing;
  }
  const tail: Seon = { targetId, weight, ...(label ? { label } : {}), lastActivated: now };
  cell.seons.push(tail);
  return tail;
}
