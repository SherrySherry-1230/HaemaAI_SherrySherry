// @editedBy SherrySherry 2026-09-06
/**
 * valence — 세포의 긍정/중립/부정 표식. H-tag(tags)의 한 종류로 실린다.
 * (2-b에서 AI 어댑터가 추출 시 부여. 지금은 손으로 태그를 달거나 호스트가 넘긴다)
 *
 * 정책: "먼저 꺼내는" 후보(이야깃거리·먼저 말 걸 거리)는 긍정·중립만.
 * 부정 세포는 회상 후보에 항상 포함하되 flag로 표시한다.
 * 표식이 없는 세포(unknown)는 부정이 아니므로 중립으로 취급한다.
 */

import type { JJum } from './types/jjum.ts';

export type Valence = 'positive' | 'neutral' | 'negative' | 'unknown';

/** 문서에서 쓰는 표준 H-tag. 영문 표기도 함께 인식한다 */
export const VALENCE_TAGS: Record<Exclude<Valence, 'unknown'>, string> = {
  positive: '긍정',
  neutral: '중립',
  negative: '부정',
};

const POSITIVE = new Set(['긍정', 'positive']);
const NEUTRAL = new Set(['중립', 'neutral']);
const NEGATIVE = new Set(['부정', 'negative']);

const norm = (s: string): string => s.trim().toLowerCase();

export function valenceOf(jjum: Pick<JJum, 'tags'>): Valence {
  const tags = jjum.tags.map(norm);
  if (tags.some((t) => NEGATIVE.has(t))) return 'negative';
  if (tags.some((t) => POSITIVE.has(t))) return 'positive';
  if (tags.some((t) => NEUTRAL.has(t))) return 'neutral';
  return 'unknown';
}

export const isNegative = (jjum: Pick<JJum, 'tags'>): boolean => valenceOf(jjum) === 'negative';

/** 먼저 꺼내도 되는가 — 긍정·중립(표식 없음 포함)만 */
export const canBringUpFirst = (jjum: Pick<JJum, 'tags'>): boolean => !isNegative(jjum);
