// @editedBy SherrySherry 2026-09-13
/**
 * 회상 엔진 (2-a) — AI 없이 결정론적으로 동작한다.
 *
 * recall(ownerId, cues) 는 매 턴 3종을 돌려준다:
 *   ① 회상 후보  — 단서(이름·별칭·H-tag)에 걸린 쩜 + 쩜선 확산(기본 1홉·최대 2홉·weight 상위 N·토큰 상한)
 *   ② 답변 가이드 — 규칙 기반 뼈대 { mode, allowed, comfortCues, forbidden, followUpQuestions }
 *   ③ 이야깃거리  — 대화가 끊길 때 던질 화제 (긍정·중립만)
 *
 * Haema는 말을 만들지 않는다. 가이드는 방향과 재료이고, 최종 발화·꺼낼지·침묵할지는 호스트 몫.
 * 후보가 없으면 빈 결과 — 지어낼 재료를 주지 않는다.
 * 점수는 규칙 기반이며 AI 점수화(2-b)가 이를 정교화한다.
 */

import type { JJumId, JJum, JJumTimestamp, Seon } from './types/jjum.ts';
import type { StorageAdapter } from './adapters/storageAdapter.ts';
import { canBringUpFirst, valenceOf, type Valence } from './valence.ts';
import { earliestUpcomingEvent, num } from './proactive.ts';
import { GUIDE_MODES, type GuideMode } from './guideModes.ts';
import { strongestSeons } from './seons.ts';

export { GUIDE_MODES, type GuideMode };

export interface RecallOptions {
  /** 쩜선 확산 홉 수. 기본 1, 최대 2 (초과 지정 시 2로 잘린다) */
  hops?: number;
  /** 홉마다 살릴 상위 N개 (weight·점수순). 기본 10 */
  topN?: number;
  /** ① 회상 후보의 총 토큰 상한. 기본 1200 */
  tokenBudget?: number;
  /** ③ 이야깃거리 개수. 기본 3 */
  topicLimit?: number;
  /** 이야깃거리 '다가오는 사건' 창(일). 기본 14 */
  topicUpcomingDays?: number;
  /** 이야깃거리 '오래 언급 없음' 기준(일). 기본 14 */
  topicStaleDays?: number;
  now?: JJumTimestamp;
  /** recallCount · 쩜선 lastActivated 갱신 여부. 기본 true */
  touch?: boolean;
}

export type MatchedBy = 'name' | 'tag' | 'seon';

export interface RecallCandidate {
  jjum: JJum;
  /** 0~1 규칙 기반 점수 */
  score: number;
  /** 0 = 단서 직접 매칭, 1·2 = 쩜선 확산 */
  hop: 0 | 1 | 2;
  matchedBy: MatchedBy;
  /** 선으로 왔다면 어느 점에서 */
  via?: JJumId;
  valence: Valence;
  /** 부정 점 flag — 호스트는 "유저가 먼저 꺼냈을 때 알아봐 주는" 용도로만 쓴다 */
  negative: boolean;
  reasons: string[];
  tokens: number;
}

export interface FollowUpQuestion {
  /** 관련 점. 단서 자체가 미지일 때는 없음 */
  jjumId?: JJumId;
  /** 비어 있는 필드 또는 'unmatched-cue'(처음 듣는 단서) */
  field: 'type' | 'summary' | 'tags' | 'facts' | 'unmatched-cue';
  /** 호스트가 말투를 입힐 질문 재료 (문장이 아니라 방향) */
  prompt: string;
}

/** forbidden 기본값 */
export const DEFAULT_FORBIDDEN = ['상대 옹호', '훈계', '부정 기억 먼저 꺼내기'] as const;

export interface AnswerGuide {
  mode: GuideMode;
  allowed: string[];
  /** 선에서 찾은 긍정 기록·긍정 인물·좋은 시절 */
  comfortCues: string[];
  forbidden: string[];
  followUpQuestions: FollowUpQuestion[];
}

export type TopicKind = 'upcoming' | 'stale' | 'followup';

export interface Topic {
  jjum: JJum;
  kind: TopicKind;
  score: number;
  reason: string;
}

export interface RecallStats {
  cues: string[];
  /** 단서에 직접 걸린 쩜 수 */
  direct: number;
  /** 선으로 확산된 쩜 수 (토큰 상한 적용 전) */
  expanded: number;
  tokensUsed: number;
  /** 토큰 상한으로 잘려 나간 후보 수 */
  truncated: number;
}

export interface RecallResult {
  candidates: RecallCandidate[];
  guide: AnswerGuide;
  topics: Topic[];
  stats: RecallStats;
}

const DAY = 24 * 60 * 60 * 1000;
const norm = (s: string): string => s.trim().toLowerCase();

/** 토큰 근사 — 보수적으로 2글자 ≈ 1토큰 (한글 기준). 정확도보다 일관성이 목적 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/** 호스트 프롬프트에 실릴 한 줄 표현 — 토큰 계산의 기준 */
export function renderJJum(jjum: JJum): string {
  const alias = jjum.aliases.length > 0 ? `(${jjum.aliases.join('/')})` : '';
  const facts = jjum.facts.slice(-3).map((f) => f.text).join('; ');
  const tags = jjum.tags.length > 0 ? `#${jjum.tags.join(' #')}` : '';
  return [`[${jjum.jjumName}${alias}]`, jjum.type, jjum.summary, facts, tags].filter(Boolean).join(' · ');
}

function tailWeightMax(jjum: JJum): number {
  return jjum.seons.reduce((m, t) => Math.max(m, t.weight), 0) || 1;
}
// 같은 상대로 가는 선이 여럿(라벨 다름)이면 가장 굵은 것 기준 — 쩜선 중복 규칙

/** 규칙 기반 답변 가이드 뼈대 */
function buildGuide(
  candidates: RecallCandidate[],
  unmatchedCues: string[],
  directCount: number,
): AnswerGuide {
  const direct = candidates.filter((c) => c.hop === 0);
  const directNegative = direct.some((c) => c.negative);
  const directPositive = direct.some((c) => c.valence === 'positive');

  let mode: GuideMode;
  let allowed: string[];
  if (directNegative) {
    mode = '공감 우선';
    allowed = ['공감', '편들기(같이 화내기·과장 응원) — 상대가 제3자일 때', '위로 단서 활용'];
  } else if (directPositive) {
    mode = '가볍게';
    allowed = ['가벼운 리액션', '좋은 기억 언급'];
  } else if (directCount === 0) {
    mode = '안부';
    allowed = ['근황 묻기', '이야깃거리 활용'];
  } else {
    mode = '가볍게';
    allowed = ['가벼운 리액션', '관련 기억 한 줄 언급'];
  }

  const comfortCues = candidates
    .filter((c) => c.valence === 'positive')
    .map((c) => `${c.jjum.jjumName} — ${c.jjum.summary || c.jjum.facts.at(-1)?.text || c.jjum.type}`);

  const followUpQuestions: FollowUpQuestion[] = [];
  for (const c of direct) {
    const name = c.jjum.jjumName;
    if (!c.jjum.type || c.jjum.type === 'unknown') {
      followUpQuestions.push({ jjumId: c.jjum.jjumId, field: 'type', prompt: `${name}: 누구/무엇인지 아직 모름 — 물어볼 것` });
    }
    if (!c.jjum.summary) {
      followUpQuestions.push({ jjumId: c.jjum.jjumId, field: 'summary', prompt: `${name}: 어떤 사이·어떤 맥락인지 요약 없음 — 관계/배경을 물어볼 것` });
    }
    if (c.jjum.tags.length === 0) {
      followUpQuestions.push({ jjumId: c.jjum.jjumId, field: 'tags', prompt: `${name}: 표식(H-tag) 없음 — 어떤 종류의 이야기인지 물어볼 것` });
    }
    if (c.jjum.facts.length === 0) {
      followUpQuestions.push({ jjumId: c.jjum.jjumId, field: 'facts', prompt: `${name}: 알려진 사실 없음 — 구체적인 이야기를 물어볼 것` });
    }
  }
  for (const cue of unmatchedCues) {
    followUpQuestions.push({
      field: 'unmatched-cue',
      prompt: `"${cue}": 처음 듣는 이름/단서 — 누구/무엇인지 물어볼 것 (이미 아는 점과 같은 대상이면 통합 후보)`,
    });
  }

  return { mode, allowed, comfortCues, forbidden: [...DEFAULT_FORBIDDEN], followUpQuestions };
}

/** ③ 이야깃거리 — 긍정·중립만, 이번 턴 후보에 이미 들어간 점은 제외 */
export function buildTopics(
  jjums: JJum[],
  exclude: Set<JJumId>,
  now: JJumTimestamp,
  limit: number,
  opts: { upcomingDays?: number; staleDays?: number } = {},
): Topic[] {
  const upcomingDays = num(opts.upcomingDays, 14);
  const staleLimit = num(opts.staleDays, 14);
  const topics: Topic[] = [];
  for (const jjum of jjums) {
    if (exclude.has(jjum.jjumId) || !canBringUpFirst(jjum)) continue;
    const upcoming = earliestUpcomingEvent(jjum, now, upcomingDays);
    if (upcoming) {
      const days = Math.ceil((upcoming.date - now) / DAY);
      topics.push({ jjum, kind: 'upcoming', score: 0.9, reason: `${days}일 뒤: ${upcoming.summary}` });
      continue;
    }
    const staleDays = Math.floor((now - jjum.lastMentioned) / DAY);
    if (!jjum.summary || jjum.facts.length === 0) {
      topics.push({ jjum, kind: 'followup', score: 0.5 + Math.min(0.2, staleDays / 100), reason: '답이 비어 있는 점 — 팔로업 거리' });
      continue;
    }
    if (staleDays >= staleLimit) {
      topics.push({ jjum, kind: 'stale', score: Math.min(0.8, staleDays / 60), reason: `${staleDays}일째 언급 없음` });
    }
  }
  return topics.sort((a, b) => b.score - a.score || b.jjum.mentionCount - a.jjum.mentionCount).slice(0, limit);
}

export async function recall(
  adapter: StorageAdapter,
  ownerId: string,
  cues: string[],
  options: RecallOptions = {},
): Promise<RecallResult> {
  const now = num(options.now, Date.now());
  const hops = Math.max(0, Math.min(2, Math.floor(num(options.hops, 1))));
  const topN = Math.max(1, Math.floor(num(options.topN, 10)));
  const tokenBudget = Math.max(0, num(options.tokenBudget, 1200));
  const topicLimit = Math.max(0, Math.floor(num(options.topicLimit, 3)));
  const touch = options.touch ?? true;

  const cueList = [...new Set(cues.map(norm).filter(Boolean))];
  const active = await adapter.listJJums(ownerId, { status: 'active' });
  const byId = new Map(active.map((c) => [c.jjumId, c]));

  // ── 직접 매칭: 이름·별칭 / H-tag ──
  const found = new Map<JJumId, RecallCandidate>();
  const matchedCues = new Set<string>();
  for (const jjum of active) {
    const names = [jjum.jjumName, ...jjum.aliases].map(norm);
    const nameHits = cueList.filter((q) => names.includes(q));
    const tagSet = new Set(jjum.tags.map(norm));
    const tagHits = cueList.filter((q) => tagSet.has(q));
    if (nameHits.length === 0 && tagHits.length === 0) continue;
    for (const q of [...nameHits, ...tagHits]) matchedCues.add(q);
    const reasons: string[] = [];
    let score = 0;
    if (nameHits.length > 0) {
      score = 1;
      reasons.push(`이름/별칭 일치: ${nameHits.join(', ')}`);
    }
    if (tagHits.length > 0) {
      score = Math.max(score, Math.min(0.9, 0.7 + 0.1 * (tagHits.length - 1)));
      reasons.push(`H-tag 일치: ${tagHits.join(', ')}`);
    }
    const valence = valenceOf(jjum);
    found.set(jjum.jjumId, {
      jjum,
      score,
      hop: 0,
      matchedBy: nameHits.length > 0 ? 'name' : 'tag',
      valence,
      negative: valence === 'negative',
      reasons,
      tokens: estimateTokens(renderJJum(jjum)),
    });
  }
  const directCount = found.size;
  const unmatchedCues = cueList.filter((q) => !matchedCues.has(q));

  // ── 쩜선 확산: 홉마다 weight·점수 상위 N. 같은 점으로 가는 경로가 여럿이면 가장 강한 경로를 채택 ──
  const adoptedTails = new Map<JJumId, { source: JJum; tail: Seon }>();
  let frontier = [...found.values()];
  for (let hop = 1; hop <= hops && frontier.length > 0; hop++) {
    const discovered = new Map<JJumId, RecallCandidate>();
    for (const parent of [...frontier].sort((a, b) => b.score - a.score)) {
      const wMax = tailWeightMax(parent.jjum);
      for (const tail of strongestSeons(parent.jjum).sort((a, b) => b.weight - a.weight)) {
        if (found.has(tail.targetId)) continue; // 더 가까운 홉(또는 직접 매칭)에서 이미 발견
        const target = byId.get(tail.targetId);
        if (!target) continue; // archived·삭제된 점은 따라가지 않는다
        const wNorm = tail.weight / wMax;
        const score = parent.score * 0.7 * (0.5 + 0.5 * wNorm);
        const prev = discovered.get(tail.targetId);
        if (prev && prev.score >= score) continue; // 같은 홉에서 더 강한 경로가 이미 채택됨
        const valence = valenceOf(target);
        discovered.set(target.jjumId, {
          jjum: target,
          score,
          hop: hop as 1 | 2,
          matchedBy: 'seon',
          via: parent.jjum.jjumId,
          valence,
          negative: valence === 'negative',
          reasons: [`쩜선: ${parent.jjum.jjumName} → (w${tail.weight}${tail.label ? ` ${tail.label}` : ''})`],
          tokens: estimateTokens(renderJJum(target)),
        });
        adoptedTails.set(target.jjumId, { source: parent.jjum, tail });
      }
    }
    frontier = [...discovered.values()].sort((a, b) => b.score - a.score).slice(0, topN);
    for (const c of frontier) found.set(c.jjum.jjumId, c);
  }
  const expanded = found.size - directCount;

  // ── 정렬 + 토큰 상한 ──
  const ordered = [...found.values()].sort(
    (a, b) => b.score - a.score || a.hop - b.hop || b.jjum.mentionCount - a.jjum.mentionCount,
  );
  const candidates: RecallCandidate[] = [];
  let tokensUsed = 0;
  let truncated = 0;
  for (const c of ordered) {
    // 첫 후보는 상한을 넘어도 하나는 남긴다 (후보가 있는데 빈손이 되지 않게)
    if (candidates.length > 0 && tokensUsed + c.tokens > tokenBudget) {
      truncated++;
      continue;
    }
    candidates.push(c);
    tokensUsed += c.tokens;
  }

  // ── 가이드 · 이야깃거리 ──
  const guide = buildGuide(candidates, unmatchedCues, directCount);
  const topics = buildTopics(active, new Set(candidates.map((c) => c.jjum.jjumId)), now, topicLimit, {
    upcomingDays: options.topicUpcomingDays,
    staleDays: options.topicStaleDays,
  });

  // ── 자극 반영: recallCount · 쩜선 lastActivated ──
  if (touch && candidates.length > 0) {
    const dirty = new Map<JJumId, JJum>();
    const included = new Set(candidates.map((c) => c.jjum.jjumId));
    for (const c of candidates) {
      c.jjum.recallCount += 1;
      dirty.set(c.jjum.jjumId, c.jjum);
    }
    for (const { source, tail } of adoptedTails.values()) {
      if (!included.has(tail.targetId)) continue;
      tail.lastActivated = now; // 채택된 바로 그 쩜선(가장 굵은 것)만 갱신
      dirty.set(source.jjumId, source);
    }
    await adapter.putJJums(ownerId, [...dirty.values()]);
  }

  return {
    candidates,
    guide,
    topics,
    stats: { cues: cueList, direct: directCount, expanded, tokensUsed, truncated },
  };
}
