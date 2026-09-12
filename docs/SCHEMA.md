<!-- @editedBy SherrySherry 2026-09-06 -->
# 해마세포(HCell) 스키마 (확정)

> 확정: 2026-09-04 (운영자) · 용어 전면 교체: 2026-09-05. 원문 출처: 마이풉 기획서 §2-1-1 "해마.AI".
> 이 문서가 해마세포 구조의 단일 기준이다. TypeScript 타입: `src/types/cell.ts`.
> 원칙: `meta`는 서비스별 자유 확장 소켓이며 **Haema는 그 내용을 해석하지 않는다** (도메인 무지).

## 용어

| 개념 | 문서 용어 | 코드 |
| --- | --- | --- |
| 기억의 최소 단위 — AI와 유저가 공유하는 기억 하나 | **해마세포** (해마세포/해마/세포 병기) | `HCell` (h-cell), 논리 경로 `cells/{cellId}` — 파일 어댑터의 실제 경로는 `local-server/haema/{ownerId}/cell_*.json` |
| 세포 사이 연관 — "해마가 꼬리에 꼬리를 문다" | **꼬리** | `Tail`, 필드 `tails` |
| 세포에 달린 표식 (valence 긍정/중립/부정도 여기 속한다) | **H-tag (해마태그)** | 필드 `tags` |

"노드"·"엔티티"·"마디"는 쓰지 않는다.

```
해마세포 스키마 — 논리 경로 cells/{cellId} (물리 경로는 어댑터별: FileAdapter = local-server/haema/{ownerId}/cell_{canonicalName}.json)

// ═══ 신원 ═══
cellId          string      // 자동 생성 고유 ID
canonicalName   string      // 대표 이름 ("박**", "루*코인", "성수 카페")
aliases         string[]    // 별칭 (["핑크", "박**"]) — 어느 이름으로 언급돼도 같은 세포 히트
type            string      // 개방형. AI가 자유 생성 (인물·장소·사물·사건·개념·작품·조직·표현·시기·감정 …)
tags            string[]    // H-tag — 다중 분류 ("루*코인" = [코인, 사건, 밈]). valence(긍정/중립/부정)도 H-tag

// ═══ 내용 ═══
summary         string      // 세포 한 줄 요약 ("월 1~2회 만나는 친한 친구") — 배치가 생성·갱신
facts           array       // [{ text, addedAt, source }]  source: conversation | user_edit | batch
events          array       // [{ date, summary, refCellIds[] }] — 사건에 함께 등장한 세포 연결

// ═══ 꼬리 — 연상 네트워크 (핵심) ═══
tails           array       // [{ targetId, weight, label?, lastActivated }]
                            //   weight: 함께 언급될수록↑, 미사용 시 서서히 감쇠
                            //   label: 관계 설명(선택) — "창작자", "동일 사건"
                            //   회상 규칙: 기본 1홉·최대 2홉 / weight 상위 N개 / 총 토큰 상한
                            //   중복 규칙(2026-09-06, "핀 여러 개"): 같은 상대라도 라벨이 다르면 꼬리 여러 개 허용
                            //     (예: "이전 동거" + "이사 원인"). 라벨이 같은 꼬리가 또 오면 새로 만들지 않고 기존 weight↑.
                            //     회상 점수는 같은 상대로 가는 꼬리 중 가장 굵은 것 기준.

// ═══ 통계 ═══
mentionCount    number      // 언급 횟수 — 인기순 정렬 키
firstSeen       timestamp
lastMentioned   timestamp   // 날짜순 정렬 키, 자동 정리 기준
recallCount     number      // AI가 회상에 실제 사용한 횟수

// ═══ 관리 ═══
pinned          boolean     // 자동 정리 영구 면제
status          enum        // active | archived | merged
                            //   archived: 상한 초과로 잠든 기억 (삭제 아님, 재언급 시 부활)
                            //   merged:   다른 세포에 흡수됨
mergedFrom      string[]    // 흡수한 구 세포 ID들 — 오병합 분리 복원용
mergedInto      string?     // (status=merged일 때) 흡수된 대상 역참조
editHistory     array       // [{ date, action, field, by }]  by: user | ai | batch

// ═══ 확장 소켓 ═══
meta            map         // 서비스별 자유 확장. Haema는 내용을 해석하지 않는다 (도메인 무지)

// ═══ 소속 ═══
ownerId         string      // 기억의 주인. 인증 방식은 Haema 소관 아님 — 문자열로 받을 뿐
sourceService   string      // "mypoopai" | "daengchong" | …
schemaVersion   number      // 마이그레이션 대비
```

## 변경 이력

- 2026-09-05 용어 교체: `nodeId`→`cellId`, `links`→`tails`, `refNodeIds`→`refCellIds`, 파일 `node_*`→`cell_*`.
  구조·의미는 동일 (schemaVersion 유지). 구형 `node_*.json`은 필수 필드(`cellId`)가 없어 검증 실패로 건너뛰며
  `reindex` 리포트에 잡힌다 — 콘솔 `demo`로 재생성.

## 구현 단계 메모

- 1단계 완료: 타입(`src/types/cell.ts`) + 저장 어댑터(`src/adapters/`) + 파일 어댑터 + 테스트 콘솔
- 다음 단계: 회상(선별 주입) · 통합(별칭 통합) · 자동 정리(archived) 로직 — `docs/PLAN.md`

