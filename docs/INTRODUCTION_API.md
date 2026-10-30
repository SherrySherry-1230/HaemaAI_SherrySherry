<!-- @editedBy SherrySherry 2026-10-30 -->
# 자기소개·호칭 저장 API

[프론트 자기소개 제안](INTRODUCTION_FRONTEND_PROPOSAL.md)에 맞춘 백엔드 계약이다. 자기소개 원문과 공통 닉네임 한 가지를 실제 연결 저장소의 `storageId`와 `ownerId`별로 보존한다. 소개 원문은 일반 쩜으로 자동 변환하지 않는다. 로컬 서버의 PUT은 확정된 공통 닉네임을 해당 사용자의 자아쩜 이름에도 반영한다.

## 조회·저장

먼저 `GET /api/storage/status` 또는 실제 연결을 완료한 `POST /api/storage/init`에서 `storageId`를 받는다.

```text
GET /api/owners/:ownerId/introduction?storageId=...
PUT /api/owners/:ownerId/introduction
```

`ownerId`는 URL 경로에 넣기 전에 인코딩한다. 기존 로컬 서버의 사용자 범위를 사용하므로 호스트는 인증된 사용자의 `ownerId`를 제공해야 한다. 이 API가 별도의 로그인·인증 체계를 만드는 것은 아니다.

PUT 예시:

```json
{
  "storageId": "file:선택된_실제_저장소_ID",
  "text": "저는 합성 예시 사용자입니다.\n두 번째 문단입니다.",
  "revision": 0,
  "displayName": "합성호칭"
}
```

`displayName`은 선택 필드다. 현재 textarea만 보내는 프론트는 이 필드를 생략할 수 있다. 지정하면 유효성을 확인한 뒤 그대로 우선하며 AI를 호출하지 않는다. 본문 전체가 명확한 단독 호칭 요청인 경우에도 그 요청을 우선 보존한다. 나머지 소개에서는 연결된 해마.ai 모델이 명시 선호를 먼저 고려해 호칭 한 가지를 정한다. 정보·모델 설정이 없거나 응답 해석·선정이 실패하면 `사용자`를 저장한다. 같은 원문을 명시 호칭 없이 다시 저장할 때는 기존 호칭을 재사용한다.

성공 응답은 GET과 PUT 모두 다음 형식이다.

```json
{
  "success": true,
  "ownerId": "synthetic-owner",
  "storageId": "file:선택된_실제_저장소_ID",
  "introduction": {
    "text": "저는 합성 예시 사용자입니다.\n두 번째 문단입니다.",
    "displayName": "합성호칭",
    "revision": 1,
    "updatedAt": "2026-10-20T06:00:00.000Z"
  }
}
```

미등록 GET은 HTTP200에 `text:""`, `displayName:"사용자"`, `revision:0`, `updatedAt:null`이다. 조회는 파일을 만들거나 AI를 호출하지 않는다. PUT에는 마지막 조회의 revision을 보내며, 성공하면 1 증가한다. 줄바꿈·CRLF·앞뒤 공백을 포함한 `text`는 보낸 값과 정확히 같게 저장된다.

## 공통 닉네임과 사용자 자아쩜

현재 프론트 `haema-introduction.js`는 `{storageId, text, revision}`을 보내고 서버가 반환한 `introduction.displayName`을 표시한다. 닉네임 변경도 같은 경로를 사용한다. 로컬 서버는 저장소·사용자별 소개 파일에 `userSelfJJum: {jjumId, syncedRevision}` 연결을 보존하고, 이 ID를 닉네임·모델·호스트 변경과 무관하게 재사용한다.

- 최초 연결에서는 시스템이 ID를 예약하고 v4 사용자 자아쩜을 만든다. 이름만 같은 일반 쩜을 본인으로 자동 채택하지 않는다. 과거 수동·AI 생성 자아쩜과의 명시적 연결·통합은 별도 작업이다.
- 이름이 바뀌면 같은 쩜의 이름·이전 이름 별칭·편집 이력과 Laya 대기 상태만 갱신한다. 기억·사건·쩜선·기존 이력·통계·최초 시각·확장 데이터는 보존한다. 닉네임 저장은 실제 발화가 아니므로 언급 횟수를 늘리지 않는다.
- 동일 이름 재저장·부분 저장 재시도는 쩜이나 이름 변경 이력을 중복 생성하지 않는다. 완료된 연결 대상이 삭제되었거나 병합·미지원 스키마 상태이면 자동 재생성·변환하지 않고 확인을 요청한다.
- 공통 닉네임과 호스트별 호칭은 별개다. 이 API는 호스트 쩜이나 호스트별 호칭 정보를 덮어쓰지 않는다. 호스트 전달 지시에서도 별도로 확인된 해당 호스트의 호칭을 구분한다. 호스트별 호칭 저장 API를 새로 제공하는 변경은 아니다.

GET/PUT 응답에는 추가로 아래 상태가 있다. 미연결 GET은 `userSelfJJum: null`이고, GET만으로 연결을 만들거나 동기화하지 않는다. `syncedRevision`은 마지막으로 반영 완료한 소개 revision을 뜻한다.

```ts
userSelfJJum: { jjumId: string, status: 'synced' | 'pending', syncedRevision: number } | null
```

소개와 쩜은 서로 다른 파일이다. 소개 저장 후 쩜 반영에 실패하면 HTTP503 `INTRODUCTION_USER_JJUM_PENDING`, `introductionSaved: true`, 저장된 `introduction`, `userSelfJJum: {jjumId, status:'pending'}`을 반환한다. 전체 성공이나 전체 미저장으로 표시하지 않는다. 같은 본문·닉네임·이전 revision의 재시도는 예약한 ID로 미완료 작업을 이어가며 소개 revision을 다시 늘리지 않는다. 이미 동기화가 끝난 오래된 요청은 기존처럼409다.

참여하는 작업은 소유자별 대화 잠금과 소개별 파일 잠금으로 조정한다. 프로세스 종료 뒤 남은 잠금은 자동 삭제하지 않는다. 다른 프로세스의 직접 쩜 파일 수정까지 묶는 전체 트랜잭션은 제공하지 않는다. 코어 직접 사용자는 `saveIntroductionWithUserSelfJJum()`을 사용하며, `FileIntroductionStore.save()`만 호출하면 소개 저장만 수행한다.

본문은 UTF-8 1MiB까지 지원하고 초과하면 명시적으로 거부한다. HTTP JSON 요청 본문 상한은 8MiB다. 잘라내거나 공백을 정리하지 않는다. 빈 문자열·공백뿐인 본문 저장은400이며 삭제 기능을 뜻하지 않는다. 호칭은 앞뒤 공백·줄바꿈·제어문자·고립 서로게이트가 없는 단일 문자열이고 Unicode 코드포인트512개 이하다.

## 충돌·실패·보존

| 상황 | HTTP/동작 |
| --- | --- |
| 요청 storageId와 실제 연결이 다름·저장 중 선택 변경 | 409 `INTRODUCTION_CONFLICT` |
| 같은 사용자 소개의 revision이 변경됨·다른 작성자 잠금 | 409, 기존 소개 유지 |
| 저장소 미연결 | 409 |
| 잘못된 ID·본문·호칭·revision·JSON/UTF-8 | 400 `INTRODUCTION_INVALID` |
| HTTP 요청 본문 상한 초과 | 413 `INTRODUCTION_TOO_LARGE` |
| 손상 원본·권한·저장 실패 | 503 `INTRODUCTION_STORAGE`, 원본 보존 |
| 소개 저장 후 자아쩜 반영 실패 | 503 `INTRODUCTION_USER_JJUM_PENDING`, 저장된 소개·고정 쩜 ID와 미완료 상태 반환 |
| 지원하지 않는 메서드 | 405 |

서버는 요청 당시 저장소 객체를 고정하고 비동기 호칭 선정 후와 실제 파일 교체 직전에 연결 신원을 다시 확인한다. 사용자 파일별 잠금과 revision 비교 후 임시 파일을 fsync하고 원자 교체한다. 이전 중단 작업의 임시 파일·손상 원본·기존 잠금은 임의 정리하지 않으며, 이번 실패에서 새로 만든 임시 파일은 정리한다. 성공 후 응답이 유실되면 자동 PUT 재시도 대신 GET으로 원문·revision을 확인한다.

파일은 선택된 저장소의 `☺️♥️🤖엔드유저와의 관계를 위하여🤖♥️☺️/introductions/{sha256(ownerId)}.json`에 보존한다. 같은 실제 경로의 별칭은 같은 storageId이고 다른 실제 저장소·사용자는 별도 파일이다. 재접속·서버 재시작·모델 변경 후에도 같은 저장소·사용자의 원문과 호칭이 복원된다. 저장소 경로 이동은 기존 storageId를 바꾸므로 자동 데이터 이행으로 처리하지 않는다. 프로세스 중단 뒤 남은 잠금이나 외부 파일 편집과의 경쟁은 오류를 확인한 뒤 별도 복구해야 한다.

## 호스트 챗봇 전달

```text
GET /api/owners/:ownerId/introduction/context?storageId=...
```

이 읽기 전용 경로는 일반 조회 응답에 `userContext`를 추가한다. `POST /api/conversation`의 `hostPreview.userContext`와 연속 입력 처리 결과의 `hostPreview.userContext`에도 같은 구조가 있다.

```ts
{
  ownerId, storageId,
  introduction: { text, displayName, revision, updatedAt },
  instructions: '호칭 사용과 소개 데이터 처리에 관한 고정 지시',
  data: JSON.stringify({ text, displayName })
}
```

호스트는 `instructions`를 자기 지시 체계에 적용하고 `data`를 사용자 제공 프로필 자료로 전달한다. 소개 원문이나 호칭 자체를 시스템 지시로 승격하지 않는다. 미등록 소개는 기본 호칭 `사용자`와 빈 본문을 제공한다. 코어를 직접 사용하는 호스트는 `FileIntroductionStore.read(ownerId)`와 `buildIntroductionHostContext(scope, introduction)`를 사용할 수 있다.

현재 로컬 서버는 호스트에게 전달할 재료를 반환한다. 호스트 답변 생성과 외부 챗봇에 적용하는 실행은 호스트 연동부가 담당한다. 이 변경은 호스트 답변을 자동 생성하거나 미정인 연속 입력 응답 시작·회상 전달 정책을 확정하지 않는다.

## 호칭 선택 호출의 사용량

새 AI 작업은 `selectDisplayName`이며 OpenAI 호환·Anthropic·Google·Groq 및 연결된 Ollama/LM Studio의 기존 호출 경로를 사용한다. SDK 응답의 실제 사용량을 같은 `scope:haema` 규칙으로 기록하고 조회·명시 호칭·저장된 호칭 재사용에는 새 호출을 만들지 않는다.

호칭 선택은 대화 발화와 별개의 설정 작업이다. PUT 성공·실패 응답에 선택적으로 다음 정보를 제공한다.

```ts
introductionUsage: {
  operationId: 'introduction:고유UUID',
  tokenUsage,
  conversationUsage,
  usagePersistence: { status: 'saved' | 'failed' }
}
```

사용량 장부는 이 operationId 아래에 보존한다. 해당 설정 호출을 현재 채팅의 발화·누적에 다시 더하지 않는다. AI 응답 파싱이나 소개 저장이 실패해도 관측된 소비는 보존한다. 사용량을 받지 못하면 미제공으로 남긴다. 최초 사용량 기록을 만들 수 없으면 AI 실행을 생략하고 기본 호칭으로 소개를 저장할 수 있다. 호칭 선택 성공 여부와 소개 저장·사용량 보존 결과는 각각 확인한다. 프론트 소개 클라이언트는 기존 필수 응답 필드로 연결할 수 있고 추가 계량 표시가 필요하면 이 별도 설정 작업 응답을 수신해야 한다.

서버 전달과 실행 방법은 [SERVER_DELIVERY.md](SERVER_DELIVERY.md)를 따른다.
