// @editedBy SherrySherry 2026-09-05
/**
 * Haema AI 어댑터 인터페이스 — Haema가 AI를 직접 호출하는 경계면.
 * (1단계: 인터페이스 정의만. 레퍼런스 구현 3종 + 커스텀 주입은 2단계)
 *
 * 역할은 "쩜(JJum)를 만드는 것"까지다.
 * - 하는 일: 대화에서 쩜(JJum) 추출 / summary·관계 요약 생성 / 병합 후보 판정 / 회상 후보 점수화
 * - 안 하는 일: 유저에게 말하기(말투·연출·꺼낼지 침묵할지는 호스트 챗봇 몫) / 기억 지어내기
 *
 * 키 정책: apiKey는 호출 시 메모리에서만 쓴다. **Haema는 키를 저장하거나 로깅하지 않는다.**
 * 프롬프트 정책: Haema의 프롬프트는 범용이다. 서비스 특화 지시는 호스트가 `hint` 문자열로
 * 넘기며, Haema는 hint를 해석하지 않는다 — 프롬프트에 그대로 전달할 뿐 (도메인 무지).
 */

import type { JJum, JJumTimestamp, JJumId } from '../types/jjum.ts';

export type AIProvider = 'anthropic' | 'openai' | 'google' | 'upstage' | 'groq' | 'custom';

/** 작업 종류 — 작업별로 모델을 분리 지정할 수 있다 (예: 추출은 경량, 판정은 상위) */
export type AITask = 'extract' | 'summarize' | 'judgeMerge' | 'scoreRecall';

/** provider='custom'일 때 개발자가 주입하는 호출 함수. 응답은 텍스트(파싱은 Haema 몫). */
export type CustomAICall = (req: {
  task: AITask;
  model: string;
  system: string;
  user: string;
}) => Promise<string>;

export interface AIAdapterConfig {
  provider: AIProvider;
  /** 기본 모델 (작업별 지정이 없을 때 사용) */
  model: string;
  /** 메모리에서만 사용 — 저장·로깅 금지. provider='custom'이면 생략 가능 */
  apiKey?: string;
  /** OpenAI 호환/Anthropic 엔드포인트를 덮어쓸 때 사용 */
  baseUrl?: string;
  /** 작업별 모델 분리 — 예: { extract: 경량 모델, judgeMerge: 상위 모델 } */
  taskModels?: Partial<Record<AITask, string>>;
  /** provider='custom'일 때 필수 */
  customCall?: CustomAICall;
}

/** 호스트가 넘기는 대화 조각 — Haema는 내용을 해석하지 않고 AI에 전달만 한다 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  at?: JJumTimestamp;
}

/** 대화에서 추출된 쩜(JJum) 초안 — 저장 전 단계 (병합·저장은 코어/호스트가 결정) */
export interface ExtractedDraft {
  jjumName: string;
  type: string;
  aliases: string[];
  tags: string[];
  /** 대화에서 건진 사실 조각 텍스트 */
  factTexts: string[];
  /** 이번 대화가 하나의 사건이면 그 요약 */
  eventSummary?: string;
  /** 함께 등장한 다른 이름들 — 꼬리 후보 */
  relatedNames?: string[];
}

export interface ExtractRequest {
  ownerId: string;
  turns: ConversationTurn[];
  /** 이미 아는 이름들(canonical+별칭) — 중복 생성 억제용 참고 정보 */
  knownNames?: string[];
  /** 호스트의 서비스 특화 지시 — 해석 없이 프롬프트에 그대로 전달 */
  hint?: string;
  now?: JJumTimestamp;
}

/** 병합 후보 판정 결과 — 자동 병합/되묻기의 연출은 호스트 몫 */
export interface MergeJudgement {
  /** 0(다른 대상)~1(같은 대상) */
  confidence: number;
  reason?: string;
}

/** 회상 후보 점수 — 꺼낼지·침묵할지의 최종 결정은 호스트 몫 */
export interface RecallScore {
  jjumId: JJumId;
  /** 0(무관)~1(지금 꺼낼 가치 높음) */
  score: number;
  reason?: string;
}

export interface AIAdapter {
  readonly config: AIAdapterConfig;

  /** 대화에서 쩜(JJum) 초안을 추출한다. 근거 없는 내용은 만들지 않는다(기억 지어내기 금지). */
  extractJJums(req: ExtractRequest): Promise<ExtractedDraft[]>;

  /** 쩜(JJum)의 summary(관계 요약 포함)를 생성·갱신한다. */
  summarizeJJum(jjum: JJum, hint?: string): Promise<{ summary: string }>;

  /** 두 쩜(JJum)가 같은 대상인지 판정한다(점수화까지 — 병합 실행은 코어, 연출은 호스트). */
  judgeMergeCandidate(a: JJum, b: JJum, hint?: string): Promise<MergeJudgement>;

  /** 현재 맥락에서 회상 후보들을 점수화한다(점수까지 — 꺼낼지/침묵할지는 호스트). */
  scoreRecallCandidates(
    context: ConversationTurn[],
    candidates: JJum[],
    hint?: string,
  ): Promise<RecallScore[]>;
}
