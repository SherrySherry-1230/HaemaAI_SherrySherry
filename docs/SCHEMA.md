<!-- @editedBy SherrySherry 2026-10-30 -->
<!-- @editedBy 사람사람 작성자 힘듦...  2026-09-22 -->
# 쩜(JJum) 스키마 v5 — 구조 명세

> v5 저장 계약이다. 구체적인 평가·계산 정책이 없는 항목은 준비 상태로 구분한다. 기존 v4의 읽기·저장 계약과 원본 데이터는 보존하며, 문서 수정이나 버전 숫자 변경만으로 이행 완료로 처리하지 않는다.
> 필드·중첩 형식·범위는 이 파일, 생성 판단·계산 의미·사례·변경 이력은 `AI/SCHEMA_GUIDE.md`에서 관리한다.
> 설명서는 로컬 별도 자료다. 작업에 필요한 규칙은 호출 입력으로 제공하며, 파일 경로만 전달해서 모델이 읽었다고 간주하지 않는다.

## 1. 공통 형식

- **필수**: 모든 v5 저장 쩜에 존재. **선택**: 정보가 있을 때만 존재. **조건부 필수**: 지정 조건이 발생하면 존재.
- 저장 결과는 JSON 객체다. 설명문·주석·마크다운을 섞지 않는다. 미완성 후보를 완성된 저장 쩜으로 취급하지 않는다.
- `string`은 공백뿐인 값을 금지한다. `timestamp`는 Unix epoch 밀리초 정수다. `layaTag.timestamp`만 시간대가 있는 ISO 문자열이다.
- 정보 없는 선택 키는 생략한다. `null`·빈 문자열·빈 배열·빈 객체로 채우지 않는다. 의미 있는 `0`·`false`는 허용한다.
- 선택 객체·목록을 만들면 그 내부 필수 항목도 채운다. 갱신 요청에서 키 생략은 기존 값 유지이며 삭제는 명시된 작업이다.
- 아래 없는 최상위 키를 추가하지 않는다. 서비스 확장은 `meta`를 쓴다. `tags`·`recallScore`·`R`은 저장 키가 아니다.
- ID·시각·횟수·계산 결과는 시스템 제공값을 사용한다. 필수 입력·판단 결과가 없으면 저장 완료 JSON을 만들지 않는다.
- 저장 전에 공통 필수 정보와 해당 쩜 타입의 필수·조건부 정보를 함께 검사한다. 누락 정보·판정할 수 없는 조건·미제공 정책을 구분하여 Laya 검토에 전달하며, 없는 정보를 만들어 통과시키지 않는다.

## 2. 필수 필드

| 필드 | 형식 | 작성 주체·규칙 |
| --- | --- | --- |
| `jjumId` | string | 시스템이 발급한 고유 ID. 이름·파일명과 독립적이며 갱신해도 유지한다. |
| `jjumName` | string | AI가 사용자의 호칭과 맥락으로 정한 대표 이름. 내부 이름에는 파일명 마스킹을 적용하지 않는다. |
| `type` | string[] | 제공된 타입 목록에서 선택. **1개 지향, 2개 허용, 3개 이상 검토 대상.** 중복 금지. v4의 단일 문자열과 구분한다. |
| `summary` | string | 이 대상이 사용자에게 누구·무엇이며 어떤 의미인지 짧게 요약한다. 확인된 이름·관계 정보를 함께 보존한다. |
| `ownerId` | string | 호출 시스템이 제공하는 기억 소유자 ID. 기존 필드이며 사용자 본인 쩜의 ID와 다르다. |
| `hostChatbotId` | string | **이 쩜의 최초 생성 근거가 된 직접 대화의 호스트 ID.** 대화 전 자아쩜 초기화에서는 최초 대화 상대로 선택·확정된 호스트 ID를 사용한다. 표시 이름·모델명·서비스 ID가 아니다. |
| `sourceService` | string | 최초 생성 출처 서비스 ID. 호스트 캐릭터 ID와 구분한다. |
| `visibility` | object | `{scope:'private'}` 또는 `{scope:'restricted', hostIds:string[]}` 또는 `{scope:'public'}`. public은 전체 공개, restricted는 명시한 호스트 범위이며 비어 있지 않은 hostIds가 필수다. 누락 때 공개 범위를 추정하지 않는다. |
| `jjumPower` | finite number ≥ 1 | 소수를 포함한 계산 원값을 저장한다. 영향의 크기이며 상한을 두지 않는다. 프론트의 소수점 한 자리 표시값으로 원값을 덮어쓰지 않는다. |
| `mentionSuitability` | integer −10..10 | 최초 생성 이후에도 갱신하는 언급 매너 값. 지정된 평가 결과·가감 정책을 적용하며, 미평가를 `0`으로 대체하지 않는다. |
| `mentionCount` | integer ≥ 1 | 생성 기본값 1. 이후 사용자 선행 언급 기준으로 시스템이 갱신한다. |
| `firstSeen` | timestamp | 최초 생성 시각. 사건 발생일이나 사용자 노출 기간이 아니다. |
| `lastMentioned` | timestamp | 시스템이 관리하는 최근 언급 시각. 새 쩜은 생성 시각으로 시작한다. |
| `recallCount` | integer ≥ 0 | 시스템이 관리하는 회상 횟수. 새 쩜은 0. 실제 말한 횟수와 구분한다. |
| `status` | enum | `active \| resting \| archived \| merged`. 새 쩜은 `active`. 휴면·보관은 삭제가 아니다. |
| `layaTag` | object | 새 v5 쩜은 검토 대기 `pending`. 생성 AI가 스스로 `reviewed/정상`을 채우지 않는다. 세부 계약은 아래 참조. |
| `schemaVersion` | integer | 이 명세로 새로 작성한 자료는 `5`. 기존 v4 파일의 숫자만 바꾸지 않는다. |

## 3. 선택·조건부 필수 필드

| 필드 | 구분 | 형식·만드는 조건 |
| --- | --- | --- |
| `aliases` | 선택 | string[]. 실제 확인된 다른 이름·실명·관계 호칭이 있을 때. 대표 이름과 같은 값·중복 값은 제외한다. |
| `jjtags` | 선택 | string[]. 의미가 확인된 표식만. 타입과 같은 정보를 습관적으로 복사하지 않는다. |
| `facts` | 선택 | 사실·진술 조각이 있을 때. 각 항목은 `text, addedAt, source` 필수. `source=conversation \| user_edit \| batch`. |
| `events` | 선택 | 시점이 확인된 사건이 있을 때. 각 항목은 `date, summary` 필수, 관련 쩜이 있으면 `refJJumIds` 추가. 모르는 날짜를 생성 시각으로 채우지 않는다. |
| `context` | 선택 | 제공된 대화·환경·감정 맥락이 있을 때. 관찰하지 않은 타이핑 속도·감정을 만들지 않는다. |
| `seons` | 조건부 필수 | 실제 연결 근거가 생겼을 때. 세 종류의 비어 있지 않은 목록만 포함하는 객체. 아래 참조. |
| `mentionHistory` | 조건부 필수 | 실제 확정 발화를 처리했을 때. 발화별 근거를 기록한다. 대화 전 자아쩜 생성에는 가짜 발화를 넣지 않는다. |
| `mentionHistoryChunks` | 조건부 필수 | 첫 언급 이력 묶음이 10,000건으로 가득 찬 상태에서 다음 기록이 생길 때. `{sequence, entries}` 목록, sequence는 2부터 연속. |
| `recallHistory` | 조건부 필수 | 회상에 실제 사용한 기록이 생겼을 때. 각 항목 `hostChatbotId, conversationId, utteranceId, timestamp` 필수. 당시 회상 사건의 기록이며 현재 R의 저장 자리가 아니다. |
| `hostProactiveMentionHistory` | 조건부 필수 | 회상 결과를 참고한 호스트가 사용자보다 먼저 실제로 언급했을 때. 각 항목 `hostChatbotId, conversationId, utteranceId, timestamp` 필수. 단순 전달·조회는 기록하지 않는다. |
| `lastRecalled` | 조건부 필수 | 실제 회상 이력이 생겼을 때의 최근 시각. 미회상이면 생략한다. |
| `pinned` | 선택 | boolean. 고정 의사가 명시된 경우. 생략은 고정 요청 없음이며 기억 자동 삭제의 근거가 아니다. |
| `mergedFrom` | 조건부 필수 | 실제 흡수한 구 쩜이 있을 때 그 ID 목록. 병합이 없으면 키 자체가 없다. 복원 근거를 임의 삭제하지 않는다. |
| `mergedInto` | 조건부 필수 | `status=merged`일 때 흡수한 대상의 ID. 자기 ID 금지. |
| `editHistory` | 조건부 필수 | 실제 수정·정정·병합·상태 변경 시. 항목 `date, action, by` 필수; `by=user \| ai \| batch`. `field, memo, evidence, reviewRequested`는 해당 정보가 있을 때만. |
| `responseFeedback` | 선택 | 반응 근거가 있을 때. `timestamp, result, cues` 필수, 실제 응답 ID가 있으면 `responseId` 추가. 침묵만으로 만족·거부를 단정하지 않는다. |
| `meta` | 선택 | 서비스가 제공한 확장 정보가 있을 때만 객체로 기록한다. |
| `sensitivity` | 선택 | string. 제공된 기준으로 판정된 민감도. 공개 범위·매너·실제 인지 여부를 대신하지 않으며 미정인 분류 척도를 코어가 만들지 않는다. |
| `hostKnowledge` | 선택 | 실제 인지 근거가 있는 호스트 기록 목록. 각 항목 `hostChatbotId:string, evidenceIds:string[], learnedAt:timestamp` 필수. 근거 ID 목록은 비어 있을 수 없다. |
| `typeDetails` | 조건부 필수 | 해당 타입별 정책이 요구하는 상세 정보가 있을 때 JSON 객체. 서비스 확장인 meta와 구분한다. |
| `powerCalculation` | 조건부 필수 | 계산 프로필을 적용한 파워의 현재 계산 출처·근거·기여값. 아래 중첩 계약을 따른다. |
| `powerHistory` | 조건부 필수 | 실제 재계산으로 저장값·계산 출처를 갱신한 기록. 이전·새 계산 스냅샷을 보존한다. |
| `mannerHistory` | 조건부 필수 | 외부 평가 정책과 새 근거로 매너를 갱신한 기록. 구체적인 가감 기준을 이 필드가 정의하지 않는다. |

`context`와 `responseFeedback.result/cues`의 상세 하위 형식은 기존 초안에 열거되지 않았다. 이번 분리에서 새 형식을 확정하지 않는다.

### 공개 범위와 독립된 판단

- 공개 범위에는 **전체 공개**를 포함한다. 공개 허용 범위, 내용의 민감도, 언급 매너, 호스트가 실제로 알게 된 사실은 각각 독립된 정보다.
- 전체 공개로 설정해도 모든 호스트의 실제 인지 기록을 만들거나 이미 아는 기억으로 취급하지 않는다. 공개 설정만으로 외부에 자동 발행하는 것도 아니다.
- 민감도나 매너 점수로 공개 범위를 추정하지 않는다. 높은 파워·매너·회상 점수도 공유 또는 직접 언급의 자동 허가가 아니다.

### 파워·매너와 계산 변경 보존

- 파워의 언급·기간·감정·쩜선 최종 기여 하한은 각각 `0.23 / 0.17 / 0.29 / 0.31`이다. 하한 보정 후 합산하며 **1점은 정상, 1점 미만은 오류**다. 표시용 반올림으로 오류를 숨기지 않는다.
- 원점수에서 최종 기여값으로 환산하는 정책과 매너 가감 기준은 별도로 제공한다. 없는 정책을 임의의 수식이나 0점으로 채우지 않는다.
- 계산 프로필이 새 버전으로 변경되면 해당 프로필을 사용하는 기존 쩜도 재계산 대상으로 삼는다. 새 근거부터만 적용하는 방식으로 한정하지 않는다.
- 기존 근거, 이전·새 적용 프로필과 계산 결과, 계산 변경 이력을 보존한다. 아직 정책·근거가 부족하거나 저장이 실패한 대상은 기존 확정값을 유지하고 재계산 미완료로 구분한다.

### 계산·매너 이력의 중첩 형식

| 객체 | 필수 항목 | 선택 항목·의미 |
| --- | --- | --- |
| `powerCalculation` | `profileId, profileVersion, coefficientDigest, policyVersion: string`, `formula: root \| logarithm`, `evidence: 비어 있지 않은 근거[]`, `contributions: 네 항 객체`, `calculatedAt: timestamp` | 원점수를 산출한 경우 `rawScores: 네 항 객체`를 추가한다. contributions는 하한 적용 전 기여값이다. |
| 네 항 객체 | `mention, duration, emotion, seon: finite number ≥ 0` | 원점수와 기여값을 같은 대상으로 해석하지 않는다. |
| `powerCalculation.evidence[]` | `evidenceId: string`, `kind: mention \| duration \| emotion \| seon`, `data: JSON 객체` | `occurredAt: timestamp`, 정정이면 `replacesEvidenceId: string`. 실제 확인된 근거·정정 전 내용을 보존한다. |
| `powerHistory[]` | `operationId: string`, `timestamp: timestamp`, `previousPower, power: finite number ≥ 1`, `calculation: powerCalculation 객체` | 이전 계산 출처가 있었을 때 `previousCalculation`을 추가한다. 모르는 옛 출처를 만들지 않는다. |
| `mannerHistory[]` | `evidenceId: string`, `timestamp: timestamp`, `previousValue, value: integer −10..10`, `policyVersion, reason: string` | 동일 근거 재처리로 다시 가감하지 않는다. |

`coefficientDigest`는 실제 조회한 계산 자료의 지문이다. `profileVersion`은 계수 프로필, `policyVersion`은 적용한 계산 정책의 버전이며 Laya 검토 버전과 다르다. 표시용 반올림 값·계산 대기 상태를 `jjumPower`의 원값 자리에 저장하지 않는다.
계산 근거는 실제 발화 기록에 한정되지 않는다. 대화 전 생성 기본 N=1처럼 시스템이 확정한 계산 입력도 출처를 보존할 수 있지만, 이를 위해 가짜 발화 ID나 사용자 발화를 만들지 않는다.

### 타입별 저장 전 검사 입력

타입별 정책은 저장 쩜 밖의 명시적인 목록으로 공급한다. 각 타입은 `required: string[]`과 선택적인 `conditional: {when, required:string[]}[]`을 갖는다. 경로는 공통 스키마 필드와 `typeDetails` 하위 필드를 참조하며 `meta`는 제외한다. 조건은 경로의 제공 여부 또는 제공된 값과의 일치를 검사한다. 값 비교에 필요한 정보가 없으면 누락으로 보고하며, 존재·부재를 명시한 조건은 그 제공 여부로 판단한다. 코어가 타입 이름을 보고 새로운 필수 사실을 추정하거나 `meta`를 해석해 조건을 만들지 않는다.
정책이 등록되지 않은 타입, 판정 근거가 부족한 조건, 실제 필수 정보 누락을 구분하여 보고한다. 추가 필수 정보가 없는 타입도 빈 규칙을 명시하며 정책 누락을 자동 통과시키지 않는다. 이 정책 목록을 매 쩜의 새 최상위 키로 복제하지 않는다.

## 4. 쩜선 객체

`seons = { general?: GeneralSeon[], parentChild?: ParentChildSeon[], upperLower?: UpperLowerSeon[] }`.
존재하는 종류의 비어 있지 않은 목록만 만든다. 세 종류가 모두 없으면 `seons`도 생략한다.

| 공통 필드 | 필수 여부·의미 |
| --- | --- |
| `seonId` | 필수. 하나의 관계를 식별하는 시스템 발급 ID. 양쪽 쩜에서 같은 ID를 사용한다. |
| `targetId` | 필수. 연결된 상대 쩜 ID. 자기 ID와 같을 수 없다. |
| `label` | 필수. 근거로 확인된 관계 의미. 같은 두 쩜도 서로 다른 관계를 가질 수 있다. |
| `history` | 필수. 실제 연결·가산의 근거가 1건 이상 있어야 한다. |
| `lastActivated` | 선택. 실제 활성 이력이 있을 때 시스템이 기록한 시각. |

| 목록 | 추가 필수 필드 | 값의 의미 |
| --- | --- | --- |
| `general` | `weight: number ≥ 0` | 두 쩜이 공유하는 누적값. 양쪽에 같은 값이 귀속된다. |
| `parentChild` | `role: parent \| child`, `weight: number ≥ 0` | 이 쩜의 포함 역할과 공유 누적값 하나. 부모용·자식용으로 나누지 않는다. |
| `upperLower` | `role: upper \| lower`, `receivedWeight: number ≥ 0` | 이 관계에서 이 쩜이 받는 누적값. 상대가 받는 값은 다를 수 있다. |

`seonId/targetId/label`은 string, `lastActivated`는 timestamp, `history`는 아래 근거 객체의 비어 있지 않은 배열이다.
역방향 참조는 같은 seonId를 쓴다. 부모자식·상위하위의 양쪽 role은 서로 반대다.
일반·부모자식은 양쪽 weight가 같고, 같은 근거의 양쪽 delta도 같다. 누적 weight와 개별 delta가 같아야 한다는 뜻은 아니다.
상위하위의 receivedWeight·delta는 각 쩜이 받은 값이다. 누적 원값은 소수 허용·상한 없음이며 화면 굵기 단계와 다르다.

### 연결 이력 `seons.*[].history[]`

| 필드 | 형식·규칙 |
| --- | --- |
| `evidenceId` | string, 필수. 시스템이 유지하는 독립 관계 근거 ID. 재처리 시 같은 ID를 재사용한다. |
| `conversationId` | string, 필수. 근거 발화가 속한 대화 ID. |
| `utteranceId` | string, 필수. **연결 근거가 된 실제 발화 ID.** |
| `hostChatbotId` | string, 필수. 해당 근거 대화의 직접 상대 호스트 ID. |
| `timestamp` | timestamp, 필수. 해당 연결 근거를 기록한 실제 시각. 사건 발생 시각으로 바꾸지 않는다. |
| `delta` | number, 필수. 이 근거로 가산한 값. 일반·부모자식은 공유값, 상위하위는 이 쩜이 받은 값. |
| `occurredAt` | timestamp, 선택. 근거 원발화 시각을 알고 있을 때만. |
| `replacesEvidenceId` | string, 조건부 필수. 과거 근거를 정정하는 경우 대상 근거 ID. 기존 기여를 대체하며 이중 가산하지 않는다. |
| `calculationRef` | object, 조건부 필수. 계산 프로필을 적용한 경우 `profileId, profileVersion, rule, coefficientDigest, ruleVersion` 기록. `packageVersion`은 제공된 경우에만 기록한다. 실제 조회한 값만 사용한다. |

`calculationRef`의 값은 공백이 아닌 string이다. 계수 지문과 규칙 버전을 함께 보존하여 같은 버전명의 다른 자료를 섞지 않는다. 실제 조회한 계산 자료의 출처만 사용한다.
재전송·역방향 조회로 같은 evidenceId를 중복 가산하지 않는다.
정정은 기존 근거 이력을 보존하면서 유효 기여를 대체한다. 조건부 기본값·감쇠·누적 계산은 제공된 계산 정책을 따른다.

## 5. 발화·회상·편집 이력

| 객체 | 필수 항목 | 선택·조건 |
| --- | --- | --- |
| `mentionHistory[]` 및 `mentionHistoryChunks[].entries[]` | `hostChatbotId/conversationId/utteranceId/fingerprint: string`, `role: user \| assistant`, `kind: initiated \| prompted \| host`, `counted: boolean`, `receivedAt/recordedAt: timestamp` | 원발화 시각이 제공된 경우에만 `occurredAt: timestamp` |
| `mentionHistoryChunks[]` | `sequence: integer ≥ 2`, `entries: 발화 이력[]` | 첫 묶음 10,000건 이후 sequence 2·3·4… 연속 보존 |
| `recallHistory[]` | `hostChatbotId/conversationId/utteranceId: string`, `timestamp: timestamp` | 실제 회상 기록만 |
| `hostProactiveMentionHistory[]` | `hostChatbotId/conversationId/utteranceId: string`, `timestamp: timestamp` | 회상 결과를 이용한 실제 호스트 선제 언급만 |
| `editHistory[]` | `date`, `action`, `by: user \| ai \| batch` | `field`, `memo?: string`, `evidence?: {conversationId: string, utteranceIds: string[]}`, `reviewRequested?: boolean` |

`memo`는 공백뿐인 값 금지·최대 500자다. evidence가 있으면 두 내부 키를 모두 기록한다.
사용자 선행 언급은 `user/initiated/true`, 호스트를 따른 답은 `user/prompted/false`, 호스트 발화는 `assistant/host/false`다.
최상위 hostChatbotId는 최초 출처로 보존하고 각 새 이력에는 해당 대화의 호스트 ID를 쓴다. 공유받은 호스트 목록을 이 값에 넣지 않는다.
ID는 재시도에도 유지한다. fingerprint는 ID의 대체물이 아니다. 실제 발화가 없는 초기화에는 가짜 이력을 만들지 않는다.

## 6. Laya 검토 상태

```ts
type LayaVerdict = '정상' | '이상함' | '정보 부족';
type LayaTag = {
  state: 'reviewed';
  verdict: LayaVerdict;
  reason: string;
  timestamp: string;
} | {
  state: 'pending' | 'failed';
  reason: string;
  timestamp: string;
};
```

| 항목 | 저장·검증 계약 |
| --- | --- |
| `state` | `reviewed`는 검토 완료, `pending`은 검토 대기, `failed`는 검토 실패다. |
| `verdict` | `reviewed`에서만 필수다. 정상은 제공된 근거로 확인한 내용, 이상함은 오류·충돌 의심, 정보 부족은 판단 근거 부족이다. `pending/failed`에는 이 필드 자체가 없어야 한다. |
| `reason` | 모든 상태에서 공백뿐인 문자열을 금지하며 문자열 길이 기준 최대 500이다. 완료 시 판정 이유, 대기·실패 시 처리 상태의 이유를 담는다. |
| `timestamp` | 날짜·시각·시간대를 포함하는 유효한 ISO 문자열이다. 코어는 `2026-10-10T09:30:00.000+09:00`처럼 한국 시간으로 기록한다. 대기 전환 또는 검토 완료·실패 시각 하나를 저장한다. |

v5에서는 layaTag가 필수다. 기존 v4 파일의 필드 부재는 미검토로 읽는 호환 계약이며 v5의 필수 조건을 없애지 않는다.
새 쩜·실제 내용 수정은 pending, 횟수·발화 시각만 변경되면 내용 수정으로 취급하지 않는다. 별도 검토 버전 필드는 만들지 않는다.
공통·타입별 사전 검사에서 발견한 누락과 형식 오류를 Laya 검토의 근거로 연결한다. 사전 형식 검사 통과만으로 `reviewed/정상`을 만들지 않는다. 필수 정보가 부족한 후보는 완성된 저장 쩜과 구분한다.

## 7. 저장 쩜 밖의 회상 결과

- 현재 `conversationId/utteranceId/hostChatbotId/jjumId`(string)에 연결한다. 결과 API의 새 필드명을 이번 분리에서 추가하지 않는다.
- 계산 완료 때만 `R: number`(0..5)를 갖는다. 생성 중에는 R 키 없이 화면에 `-`로 표시한다.
- 정확히 5는 **사용자의 현재 직접 언급으로 대상이 확인된 쩜**이다. 그 직접 언급으로 현재 생성 완료된 새 쩜도 포함한다.
- R은 매 제출마다 초기화하는 임시 값이며 `.jj`에 자리값·기본값으로 저장하지 않는다. 맥락·생성 중 내용·누적 이력은 함께 지우지 않는다.
- 등급·표시·7일 감쇠·필수 회상과 언급 허가의 차이는 설명서의 회상 절을 따른다.

## 8. 파일·버전 경계

- 쩜 하나당 `{maskedJJumName}.jj` 하나. 내부 jjumName은 마스킹하지 않는다. `_index.jj`는 이름·별칭과 jjumId를 연결한다.
- 마스킹·이름·오탈자 규칙과 예시는 설명서에 보존한다. 구조만 보고 새 규칙을 만들지 않는다.
- v4의 type 문자열·seons 배열·빈 선택 배열 기본값을 v5에 그대로 복사하지 않는다. schemaVersion 숫자만 바꾸는 이행은 금지한다.
- 저장 전 공통 필수값·타입별 필수/조건부 값·이력 근거·병합 역참조·양쪽 쩜선·검토 상태를 확인한다. 타입별 기준이 없으면 없는 조건을 만들어 검사 완료로 처리하지 않는다. 기존 ID·과거 근거·최초 출처를 보존한다.
- v4 구현의 [발화 식별](CONVERSATION_API.md)·[Laya 검토](LAYA_REVIEW.md) 계약은 별도 문서다. v5는 구현·검증 경로를 함께 맞춘 뒤 적용한다.
- 별도 v5 SDK의 저장·계산 연결과 운영 적용 경계는 [런타임 연결 안내](SCHEMA_V5_RUNTIME.md)를 따른다.
- 기존 v4 `FileAdapter`의 소유자별 `_deleted-{ownerId의 SHA-256}.jj` 삭제 기록은 보존한다. 같은 ID의 재생성을 차단하는 내부 자료이며 쩜 목록·회상에서 제외한다. 인덱스 복구로 제거하거나 읽기 오류를 빈 기록으로 덮어쓰지 않는다. 백업·이동에 함께 보존한다.
- v4 처리 영수증의 `relationTargets`는 최초 관계 계획을 보존한다. 완전 재전송에서 새 AI 관계 목록으로 교체하지 않고 원래 ID의 빠진 방향만 복구한다. 필드 부재와 빈 계획을 구분하며 직접 수정한 기억을 옛 근거로 덮어쓰지 않는다. 세부 한계는 발화 식별 API를 따른다. 이 v4 호환 자료를 새 v5 쩜 필드로 복제하지 않는다.
