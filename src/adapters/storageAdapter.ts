// @editedBy SherrySherry 2026-09-05
/**
 * Haema 저장 어댑터 인터페이스 — 백엔드 교체 구조의 경계면.
 *
 * 코어 로직(회상·통합·정리 — 다음 단계)은 이 인터페이스만 바라본다.
 * 레퍼런스 구현 예정: FirestoreAdapter / LocalStorageAdapter (아직 구현하지 않음).
 *
 * 원칙:
 * - Haema는 인증을 다루지 않는다. 모든 메서드는 서비스가 넘겨주는 `ownerId` 문자열을
 *   신뢰해 스코프로 쓸 뿐, 그 검증·발급은 호출 서비스의 책임이다.
 * - 어댑터는 쩜 내용(meta 포함)을 해석하지 않는다 — 저장하고 돌려줄 뿐 (도메인 무지).
 * - 타임스탬프는 `HaemaTimestamp`(epoch ms)로 주고받으며, 백엔드 네이티브 타입과의
 *   상호 변환은 어댑터 내부에서 처리한다.
 */

import type { JJum, JJumId, JjumStatus } from '../types/jjum.ts';

/** 목록 조회 정렬 키 — 스키마 v3의 통계 필드 */
export type JjumSortKey = 'mentionCount' | 'lastMentioned' | 'firstSeen' | 'recallCount';

/** 목록 조회 조건 (선별·정리·관리 화면의 공통 재료) */
export interface JjumQuery {
  /** 미지정 시 전체. 배열이면 OR 매칭 */
  status?: JjumStatus | JjumStatus[];
  /** type 필드 완전 일치 (값 해석 없음 — 단순 문자열 비교) */
  type?: string;
  /** tags 배열에 포함 여부 */
  tag?: string;
  /** pinned 여부 필터 */
  pinned?: boolean;
  sortBy?: JjumSortKey;
  direction?: 'asc' | 'desc';
  limit?: number;
}

/**
 * 저장 어댑터 — 모든 메서드는 ownerId 스코프 안에서만 동작한다.
 * (한 ownerId의 호출이 다른 ownerId의 점에 닿아서는 안 된다)
 */
export interface StorageAdapter {
  /** 단건 조회. 없으면 null */
  getJJum(ownerId: string, jjumId: JJumId): Promise<JJum | null>;

  /** 전체 문서 upsert (jjumId 기준) */
  putJJum(ownerId: string, jjum: JJum): Promise<void>;

  /**
   * 여러 점을 한 번에 upsert.
   * 통합(merge)처럼 쩜 여러 개가 함께 바뀌는 작업의 원자성 확보용 —
   * 어댑터는 가능한 범위에서 원자적으로 처리한다 (Firestore batch 등).
   */
  putJjums(ownerId: string, jjums: JJum[]): Promise<void>;

  /** 부분 갱신 (얕은 병합). 존재하지 않는 점이면 에러 */
  patchJJum(ownerId: string, jjumId: JJumId, partial: Partial<JJum>): Promise<void>;

  /**
   * 영구 삭제.
   * 자동 정리는 삭제가 아니라 status='archived'를 쓴다 —
   * 이 메서드는 유저의 명시적 삭제 요청 전용.
   */
  deleteJJum(ownerId: string, jjumId: JJumId): Promise<void>;

  /** 조건 목록 조회 */
  listJJums(ownerId: string, query?: JjumQuery): Promise<JJum[]>;

  /**
   * 이름 조회 — jjumName 또는 aliases 중 어느 것에 히트해도 반환.
   * (별칭 통합의 검색 전제: "어느 이름으로 언급돼도 같은 점 히트")
   */
  findByName(ownerId: string, name: string): Promise<JJum[]>;

  /** ownerId의 활성(active) 쩜 수 — 상한·자동 정리 판단 재료 */
  countJJums(ownerId: string, status?: JjumStatus): Promise<number>;
}
