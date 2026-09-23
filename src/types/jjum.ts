// @editedBy SherrySherry 2026-09-22
/**
 * 쩜(JJum) 스키마 v4 — 단일 기준: docs/SCHEMA.md (2026-09-22 확정)
 * 쩜 = AI와 유저가 공유하는 생각·기억의 최소 단위. 쩜 사이 연관 = 쩜선(Seon),
 * 쩜의 표식 = JJ-tag(jjtags).
 *
 * 원칙(도메인 무지): `type`·`jjtags`·`meta`의 값은 서비스/AI가 자유롭게 채우며,
 * Haema 코어는 그 내용을 해석하거나 분기하지 않는다.
 *
 * 발표용 메시지: "생각과 기억의 최소단위, 생각점·기억점, 그래서 점이다!"
 */

/** 쩜 고유 ID (자동 생성) */
export type JJumId = string;

/**
 * 타임스탬프 — Unix epoch 밀리초.
 * 백엔드 네이티브 타입(Firestore Timestamp 등)과의 상호 변환은 저장 어댑터의 책임이다.
 */
export type JJumTimestamp = number;

/** 기억 조각의 출처 */
export type FactSource = 'conversation' | 'user_edit' | 'batch';

/** 편집 이력의 주체 */
export type EditActor = 'user' | 'ai' | 'batch';

/**
 * 쩜 상태.
 * - `active`   : 살아있는 기억
 * - `archived` : 상한 초과로 잠든 기억 (삭제 아님 — 재언급 시 부활)
 * - `merged`   : 다른 점에 흡수됨 (껍데기만 남김)
 */
export type JJumStatus = 'active' | 'resting' | 'archived' | 'merged';

/** 사실 조각 — 어디서 온 기억인지 출처를 함께 보관 */
export interface JJumFact {
  text: string;
  addedAt: JJumTimestamp;
  source: FactSource;
}

/** 시간축 사건 — 함께 등장한 점을 refJJumIds로 연결 */
export interface JJumEvent {
  date: JJumTimestamp;
  summary: string;
  refJJumIds: JJumId[];
}

/**
 * 연상 네트워크 쩜선 (핵심).
 * - `weight`: 함께 언급될수록 증가, 미사용 시 서서히 감쇠
 * - `label`: 관계 설명(선택) — "창작자", "동일 사건"
 * - 회상 규칙: 기본 1홉 · 최대 2홉 / weight 상위 N개 / 총 토큰 상한 (로직은 다음 단계)
 */
export interface Seon {
  targetId: JJumId;
  weight: number;
  label?: string;
  lastActivated: JJumTimestamp;
}

/** 편집 이력 항목 */
export interface JJumEditEntry {
  date: JJumTimestamp;
  action: string;
  field?: string;
  by: EditActor;
}

/** 호스트 AI 답변에 대한 사용자 반응의 결과 */
export interface ResponseFeedback {
  timestamp: JJumTimestamp;
  result: string;
  cues: string[];
  responseId?: string;
}

/** 현재 스키마 버전 */
export const SCHEMA_VERSION = 4;

/**
 * 쩜 — 논리 경로 jjums/{JJumId} (물리 경로는 어댑터가 정한다).
 * 파일 어댑터 실제 경로: local-server/haema/{ownerId}/{jjumName}.jj
 */
export interface JJum {
  // ═══ 신원 ═══
  /** 자동 생성 고유 ID */
  jjumId: JJumId;
  /** 대표 이름 — "홍길동", "성수 카페" */
  jjumName: string;
  /** 별칭 — ["동서번쩍이", "길동이"]. 어느 이름으로 언급돼도 같은 쩜 히트 */
  aliases: string[];
  /** 개방형 — AI가 자유 생성 (인물·장소·사물·사건·개념·작품·조직·표현·시기 …) */
  type: string;
  /** 다중 분류 — "댕춍코인" = [코인, 밈] */
  jjtags: string[];
  /**
   * v3 파일을 읽고 마이그레이션하는 동안만 허용하는 구 필드.
   * 새로 저장하는 쩜은 jjtags를 기준으로 작성한다.
   */
  tags?: string[];

  // ═══ 내용 ═══
  /** 쩜 한 줄 요약 — "월 1~2회 만나는 친한 친구" (배치가 생성·갱신) */
  summary: string;
  /** 사실 조각들 */
  facts: JJumFact[];
  /** 시간축 사건 */
  events: JJumEvent[];
  /** 기억이 형성된 대화·환경 맥락 */
  context?: Record<string, unknown>;

  // ═══ 연상 네트워크 (핵심) ═══
  seons: Seon[];

  // ═══ 통계 (정렬·선별·회상 우선순위의 재료) ═══
  /** 언급 횟수 — 인기순 정렬 키 */
  mentionCount: number;
  firstSeen: JJumTimestamp;
  /** 날짜순 정렬 키, 자동 정리 기준 */
  lastMentioned: JJumTimestamp;
  /** AI가 회상에 실제 사용한 횟수 — "자주 떠올리는 기억" 지표 */
  recallCount: number;
  /** 마지막으로 회상된 시각 */
  lastRecalled?: JJumTimestamp;

  // ═══ 관리 ═══
  /** 핀 = 자동 정리 영구 면제 ("절대 잊지 마") */
  pinned: boolean;
  status: JJumStatus;
  /** 흡수한 구 쩜 ID들 — 오병합 분리 복원용 */
  mergedFrom: JJumId[];
  /** (status=merged일 때) 어디로 흡수됐는지 역참조 */
  mergedInto?: JJumId;
  editHistory: JJumEditEntry[];
  /** 호스트 AI 답변에 대한 사용자 반응의 간략 기록 */
  responseFeedback: ResponseFeedback[];

  // ═══ 확장 소켓 ═══
  /** 서비스별 자유 확장 — Haema는 내용을 해석하지 않는다 (도메인 무지) */
  meta: Record<string, unknown>;

  // ═══ 소속 ═══
  /** 이 기억의 주인. 인증 방식은 Haema 소관 아님 — 문자열로 받을 뿐 */
  ownerId: string;
  /** 호스트 서비스 식별자 (개방형 문자열) — Haema는 값을 해석하지 않는다 */
  sourceService: string;
  /** 마이그레이션 대비 */
  schemaVersion: number;
}
