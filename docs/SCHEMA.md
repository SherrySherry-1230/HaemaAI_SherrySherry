<!-- @editedBy 사람사람 작성자 힘듦...  2026-09-22 -->
# 쩜(JJum) 스키마 (v4)
> 버전 4
  > 해마태그 H-tag -> 쩜태그 JJ-tag로 교체
> 버전 3
> 확정: 2026-09-13 (사람야옹이) · 용어 전면 교체: 2026-09-13. 원문 출처: 마이풉 기획서 §2-1-1 "해마.AI". 스키마 파일 AI 폴더로 옮김.
> '해마세포' 구용어 -> '쩜' 으로 교체 'HCell'도 'JJum'으로 일단 교체
> 이 문서가 쩜 구조의 단일 기준이다. TypeScript 타입: `src/types/jjum.ts`.
> 원칙: `meta`는 서비스별 자유 확장 소켓이며 **Haema는 그 내용을 해석하지 않는다** (도메인 무지).

> **생각과 기억의 최소단위, 생각점·기억점, 그래서 점이다!**
> — 쩜(jjum)은 해마(Haema)의 기본 단위. 쩜이 이어지면 쩜선(Seon)이 된다.
> - 쩜은 보존하지만, 쩜선의 활성도/가중치는 감쇠할 수 있다.

## 용어
| 개념 | 문서 용어 | 코드 및 경로 |
| :--- | :--- | :--- |
| **기억의 최소 단위**<br>• AI와 유저가 공유하는 기억 하나<br>• '기억점'의 '점' ➔ 일상 단어와 구분하기 위해 '**쩜**'으로 명명 | **쩜**<br>*(구: 해마세포, 해마쎌)* | • 타입: `JJum` (`jjum`)<br>• 논리 경로: `jjums/{jjumId}`<br>• 파일 어댑터 실제 경로:<br>`{storageRoot}/🧠장기기억저장소_feat.해마🧠/🪣쩜통🪣/{jjumName}.jj` |
| **연상 네트워크**<br>• "점이 연결되면 선" | **쩜선** | • 타입: `Seon`<br>• 필드명: `seons` |
| **쩜에 달린 표식**<br>• 정서가(Valence: 긍정/중립/부정) 등 포함 | **JJ-tag** *(쩜태그)* | • 필드명: `jjtags` |

- "노드"·"엔티티"·"마디"는 쓰지 않는다.
- 'Jj'표기는 해마.ai 세계관에서 불법이다. 쩜의 영문 JJum에 들어가는 표기는 반드시 'jj','JJ'로 표기한다.
- 문서상 용어는 JJum, 코드 식별자는 기존 camelCase 규칙에 따라 jjumId, jjumName을 사용한다.

```
쩜 스키마 — 논리 경로 jjums/{jjumId} (물리 경로는 {storageRoot}/🧠장기기억저장소_feat.해마🧠/🪣쩜통🪣/{maskedJJumName}.jj)

**문서 하단에 파일명(쩜 파일) 규칙 필독**

// ═══ 신원 ═══
jjumId          string      // 자동 생성되는 쩜의 고유 ID.
                            // 쩜의 파일명이나 사용자 입력값을 ID로 사용하지 않는다.
jjumName        string      // 대표 이름 ("홍길동", "댕춍코인", "성수 카페")
                            // 파일명으로도 사용되므로 아래 "쩜 이름 및 파일명 보호 규칙"을 따른다.
aliases         string[]    // 별칭 (["핑크", "홍길동"]) — 어느 이름으로 언급돼도 같은 쩜 히트
type            string      // 개방형. AI가 자유 생성 (인물·장소·사물·사건·개념·작품·조직·표현·시기 …)
jjtags          string[]    // JJ-tag — 다중 분류 ("댕춍코인" = [코인, 사건, 밈]). valence(긍정/중립/부정)도 JJ-tag

// ═══ 내용 ═══
summary         string      // 쩜 한 줄 요약 ("월 1~2회 만나는 친한 친구") — 배치가 생성·갱신
facts           array       // [{ text, addedAt, source }]  source: conversation | user_edit | batch
events          array       // [{ date, summary, refJJumIds[] }] — 사건에 함께 등장한 쩜 연결
 // ═══ 맥락 ═══
context         object?     // 기억이 형성된 대화·환경 맥락. 급작스런 타이핑 속도 변화와 함께 꼼꼼히. 현단계에선 느껴지는 사용자의 감정도 여기에 간략기록 ('관계 데이터' 폴더에 따로 분리 자세히 기록. 마일스톤4 이후에 감정 따로 분리)

// ═══ 쩜선 — 연상 네트워크 (핵심) ═══
seons           array       // [{ targetId, weight, label?, lastActivated }]
                            //   weight: 함께 언급될수록↑, 미사용 시 서서히 감쇠
                            //   label: 관계 설명(선택) — "창작자", "동일 사건"
                            //   회상&연상 규칙: MCTS, weight 따라 탐색 / weight 상위 N개 / 총 토큰 상한
                            //   중복 규칙(2026-09-06, "핀 여러 개"): 같은 상대라도 라벨이 다르면 쩜선 여러 개 허용
                            //     (예: "이전 동거" + "이사 원인"). 라벨이 같은 쩜선이 또 오면 새로 만들지 않고 기존 weight↑.
                            //     회상 점수는 같은 상대로 가는 쩜선 중 가장 굵은 것 기준.

// ═══ 통계 ═══
mentionCount    number      // 언급 횟수 — 인기순 정렬 키
firstSeen       timestamp
lastMentioned   timestamp   // 날짜순 정렬 키, 최근 언급 시각 — 회상 및 관리 우선순위 계산에 활용
recallCount     number      // AI가 회상에 실제 사용한 횟수. recallCount === 0 이면 미회상쩜 -> 알고리즘에서 보너스 줄 예정.
lastRecalled    timestamp?  // 마지막으로 회상된 시각

// ═══ 관리 ═══
pinned          boolean     // 자동 정리 영구 면제
status          enum        // active | resting | merged
                            //   resting: 당장 회상하지 않는 기억. 데이터는 영구 보존
                            //   merged:   다른 쩜에 흡수됨
mergedFrom      string[]    // 흡수한 구 쩜 ID들 — 오병합 분리 복원용
mergedInto      string?     // (status=merged일 때) 흡수된 대상 역참조
editHistory     array       // [{ date, action, field, by }]  by: user | ai | batch

// ═══ 확장 소켓 ═══
meta            map         // 서비스별 자유 확장. Haema는 내용을 해석하지 않는다 (도메인 무지)

// ═══ 피드백 ═══
responseFeedback[] array      // 호스트 AI 답변에 대한 유저 반응 및 평가(쩜에선 간략 기록. 자세히는 별도 '관계 데이터'폴더 아래 파일로)
                            //[{ timestamp, result, cues, responseId? }]  

// ═══ 소속 ═══
ownerId         string      // 기억의 주인. 인증 방식은 Haema 소관 아님 — 문자열로 받을 뿐
sourceService   string      // "mypoopai" | "daengchong" | …
schemaVersion   number      // 마이그레이션 대비
```

## 호스트 AI 답변에 대한 유저 반응 및 평가
```json
"responseFeedback": [
  {
    "timestamp": "...",
    "result": "GOOD_CHAT",
    "cues": ["positive_empathy"]
  }
]

{
  "result": "BAD_CHAT",
  "cues": [
    "over_advising",
    "negative_memory_recalled_too_early"
  ]
}
```


## 쩜 이름 및 파일명 보호 규칙
  - 쩜들의 파일명은 사람과 AI가 알아보기 쉽도록 {{jjumName}}.jj(jj는 쩜만의 독특한 확장자 시스템)으로 하되, 다음 예외사항이 있다.
  - 쩜 내부의 jjumName은 상관없으나 사람 실명, 특정 상품이나, 브랜드가 파일명으로 노출 되면, 로컬에서 사람 혼자 보더라도 부담스러울 수 있다. 다음처럼 '파일명'일 경우만 마스킹한다.

### 한글 고유명칭 마스킹
  - 한글 고유명칭은 **영문 대문자 O**를 마스킹 문자로 사용한다.
  - 짧은 이름은 1글자 정도를 남기고 나머지를 O로 치환한다.
  - 긴 이름은 앞·중간·뒤의 형태를 일부 남기고 식별 가능한 핵심 부분을 O로 치환한다.
  - 여러 단어로 이루어진 명칭은 각 단어의 형태를 가능한 한 유지한다.
  - 마스킹의 목적은 내용을 없애는 것이 아니라 파일명에서만 부담을 줄이는 것
  ```
    예시 :
    홍길동 → 홍O동, 김구 → 김O, 스타벅스 돌체라떼 → 스O벅O 돌O라떼, 볼더스콘 카페 → 볼O스O 카페
    파일명은 홍O동.jj 하지만 파일 내부는 jjumName = 홍길동
  ```
### 욕설·비속어 마스킹
- 욕설이나 비속어가 쩜 이름으로 생성되는 경우에도 마스킹한다.
- 욕설 자체를 파일명으로 그대로 노출하지 않는다.
    ```
    예:
    씨발롬
    → O빌O
      파일명은 O빌O.jj 하지만 파일 내부는 jjumName = 씨발롬
    ```

- 욕설의 경우 일반적인 고유명칭보다 강하게 마스킹할 수 있다.
- 단, 쩜의 세부 내용(facts, events, summary)까지 불필요하게 삭제하거나 변형하지 않는다.

### 영문 고유명칭 마스

- 영문 고유명칭은 **한글 ㅇ**을 마스킹 문자로 사용한다.


## 원칙
- 쩜 하나당 .jj 파일 하나를 사용한다.
- 파일명에는 마스킹된 jjumName을 사용한다.
- _index.jj는 이름·별칭과 jjumId를 연결하는 인덱스다.
- 인덱스가 유실되거나 불일치하면 파일 스캔으로 복구할 수 있어야 한다.
- 사용자가 손으로 수정한 .jj 파일도 반드시 v4 스키마 검증 후 로드한다.
- 깨진 파일 하나 때문에 전체 Haema가 중단되어서는 안 된다.
- 개인 쩜 데이터는 개발 저장소에 무단 커밋되지 않도록 별도로 보호한다.

## 변경 이력
- 2026-09-22 해마태그 이름 변경 -> 쩜태그
- 2026-09-21 회상규칙 -> 회상&연상규칙 : '홉' 용어 제거. 'MCTS, weight 따라 탐색'으로 변경

- 2026-09-12 용어·확장자 전면 교체: `HCell`→`JJum`, `Tail`→`Seon`, `cellId`→`JJumId`(타입명)/`jjumId`(필드명), `tails`→`seons`, `cells/{cellId}`→`jjums/{jjumId}`, 파일 `cell_*.json`→`{jjumName}.jj`, `_index.json`→`_index.jj`, 스키마 v2→v3.
  - 타입명 `JJumId`는 PascalCase(타입 표준), 필드명은 `jjumId`(camelCase)로 구분.
  - 기존 v2(`cell_*.json`)는 점진적 전환 — 읽을 때 v3로 변환 저장. 구 파일은 대표님 정책 따라 처리.
  - 개인 데이터(`local-server/haema/user/`) 전부 `.jj`로 일괄 변환.
- 2026-09-05 용어 교체: `nodeId`→`jjumId`, `links`→`seons`, `refNodeIds`→`refJJumIds`, 파일 `node_*`→`jjum_*`.
  구조·의미는 동일 (schemaVersion 유지). 구형 `node_*.json`은 필수 필드(`cellId`)가 없어 검증 실패로 건너뛰며
  `reindex` 리포트에 잡힌다 — 콘솔 `demo`로 재생성.
