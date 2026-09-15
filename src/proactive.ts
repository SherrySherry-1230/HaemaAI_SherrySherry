// @editedBy SherrySherry 2026-09-13
/**
 * 먼저 말 걸 거리 · 선제 안부 재료 (2-a, 집계만)
 *
 * getProactiveCues(ownerId, now)   — 회상과 같은 쩜선 탐색인데 단서가 "현재 발화"가 아니라 "현재 시각".
 *   종류: 팔로업(답 비어 있는 쩜) / 다가오는 것(날짜 임박) / 오래된 긍정 쩜 / 패턴(반복 주기 도래).
 *   점수 + 이유. 긍정·중립만 — 단 미해결 고민(부정)은 careful 표시로 팔로업 허용, 상처는 여전히 안 꺼낸다.
 *   후보 없으면 빈 결과 (억지로 말 걸지 않게).
 *   언제 깨울지·말 걸어도 되는지·푸시 발송은 전부 호스트 몫.
 *
 * getOpenConcerns(ownerId)         — 열린 고민 조회 뷰: type=고민 & 미해결 점을 최근순으로. (저장은 고민 하나 = 쩜 하나 그대로,
 *   보기만 묶는다 — 선이 어느 고민의 것인지 구분되고 부분 해결이 가능해야 하므로 한 파일에 여러 고민을 넣지 않는다)
 *
 * getRecentMoodSignals(ownerId)    — 최근 점의 valence 분포 · 대화 빈도 변화 집계.
 *   판단·발동·쿨다운은 호스트. Haema는 숫자만 낸다.
 */

import type { JJumEvent, JJumId, JJum, JJumTimestamp } from './types/jjum.ts';
import type { StorageAdapter } from './adapters/storageAdapter';
import { canBringUpFirst, valenceOf, type Valence } from './valence.ts';
import { CAREFUL_INSTRUCTION, isUnresolvedConcern } from './concern.ts';
import type { GuideMode } from './guideModes';

const DAY = 24 * 60 * 60 * 1000;

/** 숫자 옵션 방어 — NaN·비유한값이면 기본값 */
export const num = (v: number | undefined, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;

/** 창 안에서 가장 이른 다가오는 사건 — 회상 이야깃거리와 먼저 말 걸 거리가 같은 판정을 쓴다 */
export function earliestUpcomingEvent(jjum: JJum, now: JJumTimestamp, withinDays: number): JJumEvent | undefined {
  return jjum.events
    .filter((e) => e.date > now && e.date <= now + withinDays * DAY)
    .sort((a, b) => a.date - b.date)[0];
}

/** 열린 고민 선별 — 순수 함수 (뷰와 먼저 말 걸 거리가 같은 기준을 쓴다). 최근순 */
export function selectOpenConcerns(jjums: JJum[]): JJum[] {
  return jjums
    .filter((c) => c.status === 'active' && isUnresolvedConcern(c))
    .sort((a, b) => b.lastMentioned - a.lastMentioned || b.mentionCount - a.mentionCount);
}

/** 열린 고민 조회 뷰 — type=고민 & 미해결, 최근순 */
export async function getOpenConcerns(adapter: StorageAdapter, ownerId: string): Promise<JJum[]> {
  return selectOpenConcerns(await adapter.listJJums(ownerId, { status: 'active' }));
}

export type ProactiveKind = 'followup' | 'upcoming' | 'stale-positive' | 'pattern';

export interface ProactiveCue {
  jjum: JJum;
  kind: ProactiveKind;
  /** 0~1 */
  score: number;
  reason: string;
  /** 부정 valence 인 미해결 고민 — 조심해서 열어야 한다 */
  careful: boolean;
  /** careful 일 때 권장 답변 방향("조심 안부")과 호스트 지시 */
  guideMode?: GuideMode;
  instruction?: string;
}

export interface ProactiveOptions {
  /** 반환 개수. 기본 5 */
  limit?: number;
  /** 긍정 점이 이 일수 이상 언급 없으면 '오래된 긍정'. 기본 30 */
  staleDays?: number;
  /** 이 일수 안의 사건을 '다가오는 것'으로. 기본 14 */
  upcomingDays?: number;
  /** 패턴 판정에 필요한 최소 사건 수. 기본 3 */
  patternMinEvents?: number;
}

export async function getProactiveCues(
  adapter: StorageAdapter,
  ownerId: string,
  now: JJumTimestamp,
  options: ProactiveOptions = {},
): Promise<ProactiveCue[]> {
  const limit = Math.max(0, Math.floor(num(options.limit, 5)));
  const staleDays = num(options.staleDays, 30);
  const upcomingDays = num(options.upcomingDays, 14);
  const minEvents = Math.max(2, Math.floor(num(options.patternMinEvents, 3)));

  const active = await adapter.listJJums(ownerId, { status: 'active' });
  const best = new Map<JJumId, ProactiveCue>();
  const offer = (cue: ProactiveCue) => {
    const prev = best.get(cue.jjum.jjumId);
    if (!prev || cue.score > prev.score) best.set(cue.jjum.jjumId, cue);
  };

  for (const jjum of active) {
    if (!canBringUpFirst(jjum)) continue; // 부정 점은 먼저 꺼내지 않는다 (미해결 고민은 아래 뷰로 따로)

    // 다가오는 것
    const upcoming = earliestUpcomingEvent(jjum, now, upcomingDays);
    if (upcoming) {
      const days = Math.max(1, Math.ceil((upcoming.date - now) / DAY));
      offer({ jjum, kind: 'upcoming', score: Math.min(1, 0.95 - days * 0.02), reason: `${days}일 뒤 예정: ${upcoming.summary}`, careful: false });
    }

    // 팔로업 — 답이 비어 있는 쩜
    if (!jjum.summary || jjum.facts.length === 0) {
      offer({ jjum, kind: 'followup', score: 0.5, reason: `답이 비어 있음 (${!jjum.summary ? 'summary' : 'facts'}) — 물어볼 거리`, careful: false });
    }

    // 오래된 긍정 쩜
    const silentDays = Math.floor((now - jjum.lastMentioned) / DAY);
    if (valenceOf(jjum) === 'positive' && silentDays >= staleDays) {
      offer({ jjum, kind: 'stale-positive', score: Math.min(0.8, 0.3 + silentDays / 90), reason: `좋은 기억인데 ${silentDays}일째 언급 없음`, careful: false });
    }

    // 패턴 — 반복 주기 도래
    const dates = jjum.events.map((e) => e.date).filter((d) => d <= now).sort((a, b) => a - b);
    if (dates.length >= minEvents) {
      const gaps = dates.slice(1).map((d, i) => d - dates[i]);
      const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const sinceLast = now - dates[dates.length - 1];
      if (avg > 0 && sinceLast >= avg) {
        offer({ jjum, kind: 'pattern', score: 0.7, reason: `평균 ${Math.round(avg / DAY)}일 주기인데 ${Math.floor(sinceLast / DAY)}일 지남 — 주기 도래`, careful: false });
      }
    }
  }

  // 열린 고민 뷰 — 부정이어도 careful 표시로 팔로업 허용 (상처는 여기 오지 않는다)
  for (const jjum of selectOpenConcerns(active)) {
    offer({
      jjum, kind: 'followup', score: 0.45, careful: true, guideMode: '조심 안부', instruction: CAREFUL_INSTRUCTION,
      reason: '아직 답이 없는 고민 — 내용은 먼저 말하지 말고 "고민 있어?" 수준으로만',
    });
  }

  return [...best.values()].sort((a, b) => b.score - a.score || b.jjum.mentionCount - a.jjum.mentionCount).slice(0, limit);
}

export interface MoodSignals {
  now: JJumTimestamp;
  windowDays: number;
  /** 최근 창에서 활동이 있었던 점의 valence 분포 */
  valence: Record<Valence, number>;
  /** 최근 창에서 활동이 있었던 쩜 수 (같은 점이 두 창에 모두 잡힐 수 있다) */
  touched: number;
  /** 직전 창에서 활동이 있었던 쩜 수 */
  touchedPrevious: number;
  /** 최근 창의 활동 횟수 — 점별 시각 기록(생성·언급·사실·사건·편집)의 합 */
  activity: number;
  /** 직전 창의 활동 횟수 */
  activityPrevious: number;
  /** (activity - activityPrevious) / max(1, activityPrevious) — 대화 빈도 변화. 같은 점을 꾸준히 이야기하면 0 근처 */
  activityChange: number;
  /** negative / touched (touched=0이면 0) */
  negativeShare: number;
}

/** 쩜 안의 시각 기록 전부 — 창별 활동 집계의 재료 (now 이후는 제외) */
function activityTimes(jjum: JJum, now: JJumTimestamp): number[] {
  const times = new Set<number>([jjum.firstSeen, jjum.lastMentioned]);
  for (const f of jjum.facts) times.add(f.addedAt);
  for (const e of jjum.events) times.add(e.date);
  for (const h of jjum.editHistory) times.add(h.date);
  return [...times].filter((t) => Number.isFinite(t) && t <= now);
}

export interface MoodOptions {
  now?: JJumTimestamp;
  /** 집계 창 일수. 기본 7 */
  windowDays?: number;
}

export async function getRecentMoodSignals(
  adapter: StorageAdapter,
  ownerId: string,
  options: MoodOptions = {},
): Promise<MoodSignals> {
  const now = num(options.now, Date.now());
  const windowDays = Math.max(1, num(options.windowDays, 7));
  const from = now - windowDays * DAY;
  const prevFrom = from - windowDays * DAY;

  const active = await adapter.listJJums(ownerId, { status: 'active' });
  const valence: Record<Valence, number> = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
  let touched = 0;
  let touchedPrevious = 0;
  let activity = 0;
  let activityPrevious = 0;
  for (const jjum of active) {
    const times = activityTimes(jjum, now);
    const cur = times.filter((t) => t > from).length;
    const prev = times.filter((t) => t > prevFrom && t <= from).length;
    activity += cur;
    activityPrevious += prev;
    if (cur > 0) {
      touched++;
      valence[valenceOf(jjum)]++;
    }
    if (prev > 0) touchedPrevious++;
  }
  return {
    now,
    windowDays,
    valence,
    touched,
    touchedPrevious,
    activity,
    activityPrevious,
    activityChange: (activity - activityPrevious) / Math.max(1, activityPrevious),
    negativeShare: touched === 0 ? 0 : valence.negative / touched,
  };
}
