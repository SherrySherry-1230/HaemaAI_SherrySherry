<!-- @editedBy SherrySherry 2026-10-08 -->
# 발화 식별과 언급 이력 API

2026-10-08 구현. `schemaVersion=4` 파일에 선택 필드 `mentionHistory`를 추가한다. 과거 기억이나 언급 횟수를 이행·삭제하지 않는다. 발화 ID는 내용의 압축값이 아니라 개별 발화의 식별자다.

## 저장 전에 발화 ID를 준비한다

호스트가 가진 안정적인 대화 ID와 메시지 ID를 각각 `conversationId`, `utteranceId`에 넣는 방법을 우선한다. 같은 사용자 안에서 서로 다른 호스트 서비스의 대화 ID가 겹치면 호스트가 서비스 식별자를 포함한 고유한 대화 ID를 제공해야 한다. 사용자 간에는 저장 어댑터의 `ownerId`로 격리한다.

ID가 없으면 `prepareConversationRequest()`가 UUID를 발급한다. **반환한 요청을 첫 처리 전에 호스트가 보관하고, 실패·재전송에도 같은 ID를 재사용한다.** 식별 정보가 없는 원본을 매번 새로 준비하면 별개 발화가 된다. 같은 내용인지 비교하여 재시도를 추측하지 않는다.

```ts
import {
  prepareConversationRequest,
  processConversationToStorage,
  ConversationProcessingError,
} from '../src/index.ts';

const prepared = prepareConversationRequest({
  ownerId: 'synthetic-owner',
  conversationId: 'host-service:conversation-1', // 없으면 한 번 발급하여 계속 재사용
  turns: [
    {
      utteranceId: 'host-message-1', // 없으면 준비 단계에서 발급
      role: 'user',
      text: '합성 기억에 관해 이야기했어요.',
      at: 1_800_000_000_000, // 원발화 시각을 아는 경우만 제공
      final: true,
    },
  ],
});

// 이 시점에 호스트가 prepared의 식별자·발화 대응 관계를 먼저 보관한다.
try {
  const result = await processConversationToStorage(ai, storage, prepared.ownerId, prepared);
  // result: { storedCount, failedSummaries, receipt }
} catch (error) {
  if (error instanceof ConversationProcessingError) {
    // error.receipt는 ID·시각만 담으며 원문을 담지 않는다.
    // 원인은 error.cause로 확인하고, 같은 prepared로 재시도한다.
  }
}
```

`prepareConversationRequest`는 입력을 바꾸지 않는다. 같은 ID의 동일한 입력은 하나로 모으고, 같은 ID에 다른 역할·내용·원발화 시각·확정 여부가 섞인 요청은 AI 호출 전에 거부한다. ID는 공백만 있는 문자열을 허용하지 않으며 최대 512자다. 시각은 0 이상의 유한한 Unix epoch 밀리초 숫자다.

## 입력·추출·결과 계약

| 위치 | 필드 | 의미 |
| --- | --- | --- |
| `ExtractRequest` | `ownerId` | 저장 대상 사용자. 앞뒤 공백 없이 제공하며 처리 함수의 `ownerId` 인자와 일치해야 한다. |
| `ExtractRequest` | `conversationId?` | 같은 대화와 재시도에서 재사용할 ID. 생략하면 준비 단계가 발급한다. |
| `ExtractRequest` | `now?` | 이번 처리 시각. 생략하면 처리 때 현재 시각을 사용한다. 테스트에서 고정할 수 있다. |
| `ConversationTurn` | `utteranceId?` | 호스트 메시지 ID를 우선한다. 생략하면 준비 단계가 발급한다. |
| `ConversationTurn` | `role`, `text` | 실제 발화 역할과 내용. `user` 또는 `assistant`. |
| `ConversationTurn` | `at?` | 호스트가 아는 원발화 시각. 없으면 과거 시각을 만들어 채우지 않는다. |
| `ConversationTurn` | `receivedAt?` | 최초 준비·수신 시각. 준비 단계가 한 번 채우며 재시도 때 보존한다. |
| `ConversationTurn` | `final?` | 기본 `true`. `false`는 대화 맥락으로만 전달하며 저장·집계 근거에서 제외한다. |
| `ExtractedDraft` | `mentions[]` | `{utteranceId, kind}` 근거 목록. 통합 저장을 사용하려면 필요하다. |
| 결과 | `storedCount` | 이번 호출에서 실제 저장한 서로 다른 쩜 수. 내용과 관계를 두 번 저장해도 하나로 센다. 완전한 재전송으로 변경이 없으면 0이다. |
| 결과 | `failedSummaries` | 이번에 실행한 요약 보강의 실패 수. 기존 실패 보존 정책을 유지한다. |
| 결과·처리 오류 | `receipt` | `{conversationId, turns:[{utteranceId, receivedAt, final, at?}]}`. 정규화된 입력 순서이며 발화 원문은 포함하지 않는다. |

OpenAI·Anthropic·Google·Groq 어댑터는 위 발화 필드를 JSON으로 전달하고 근거 발화 ID를 요청한다. AI가 새 ID나 횟수를 만들도록 맡기지 않는다. 사용자 본인을 암시하는 표현, 같은 대상의 별칭, 일반 질문에 답하며 새로 꺼낸 대상도 제공된 문맥으로 판단하도록 요청한다.

`kind`는 다음 세 값이다.

| kind | 허용되는 실제 역할 | 이력의 counted | 기존 쩜의 횟수 증분 |
| --- | --- | --- | --- |
| `initiated` | `user` | `true` | 새 확정 발화이면 +1 |
| `prompted` | `user` | `false` | +0 — 호스트가 먼저 꺼낸 같은 대상을 따라 답한 경우 |
| `host` | `assistant` | `false` | +0 — 호스트 발언도 쩜·관계 생성 근거가 될 수 있다. |

코어가 입력에 없는 ID·역할과 맞지 않는 kind·잠정 발화 근거를 제외한다. 유효한 최종 근거가 하나도 없는 초안은 저장하지 않는다. **기존 custom AIAdapter도 통합 저장을 사용하려면 `mentions`를 반환해야 한다.** `mentions`가 없는 예전 추출 응답의 원시 `extractJJums()` 반환 자체는 유지하지만, 이를 통합 저장에서 사용자 언급이라고 추측하지 않는다. 같은 새 발화·같은 쩜에 상충하는 kind가 있으면 저장 전에 오류로 거부한다.

AI는 제공된 `turns` 안에서 선행 언급을 판단한다. 호출자가 직전 호스트 발언을 보내지 않으면 그 밖의 대화까지 판별할 수 없다. ID·역할·중복은 코드로 검증하지만 의미 판별 정확도는 모델과 제공된 문맥에 의존한다. 기존 이름·별칭 매칭으로 동일 `jjumId`가 확인된 범위에서 중복을 막으며, 아직 구현되지 않은 모든 의미상 동일 대상 병합을 보장하지 않는다.

## 쩜에 남는 기록과 횟수

`mentionHistory`는 쩜의 `.jj` JSON 안에 다음 항목을 저장한다. `editHistory`, `facts`, `events`, `responseFeedback`를 대체하지 않는다.

```ts
interface JJumMention {
  conversationId: string;
  utteranceId: string;
  role: 'user' | 'assistant';
  kind: 'initiated' | 'prompted' | 'host';
  occurredAt?: number; // 원발화 시각을 받은 경우만
  receivedAt: number;  // 최초 수신·준비 시각
  recordedAt: number;  // 이 기록을 저장하려 한 처리 시각
  fingerprint: string;
  counted: boolean;
}
```

`fingerprint`는 `[role, text]`의 JSON에 대한 SHA-256이다. **같은 ID를 다른 내용으로 재사용하는지 확인하는 용도이며 ID 생성·내용 압축·서로 다른 발화의 병합에 사용하지 않는다.** 언급 이력에는 발화 원문을 복제하지 않는다. 원발화 시각을 모르면 `occurredAt`을 비워 두고 `receivedAt`과 `recordedAt`만 남긴다.

중복 기준은 `(ownerId, conversationId, utteranceId, jjumId)`다. 저장된 같은 발화는 최초 시각·집계 판단을 보존하며 AI 재분류 때문에 다시 세지 않는다. 한 발화에서 별칭 초안이 여러 개 나와 같은 쩜으로 연결되어도 한 번만 기록한다. 같은 발화가 서로 다른 쩜을 가리키면 각 쩜에 기록한다. 같은 텍스트라도 발화 ID가 다르면 별개다.

**기존 생성 기본값 1을 유지한다.** 새 쩜에 사용자 선행 발화가 한 개이면 최종 횟수는 1이며 생성 직후 다시 1을 더하지 않는다. 여러 선행 발화가 있으면 각각 반영한다. 호스트·따라 답한 사용자 근거만으로 생성해도 기존 생성 기본값은 1이고, 그 발화에 의한 사용자 횟수 증분은 0이다(`counted:false`). 이후 별도의 사용자 선행 발화는 +1이다. `counted:true`는 그 발화가 집계 대상이라는 뜻이며 초기 생성 시 이미 반영한 1을 다시 더하라는 뜻이 아니다.

기존 쩜은 저장된 `mentionCount`를 보존한 채 새 확정 사용자 선행 발화만 가산한다. 기존 숫자가 과거부터 정확한 사용자 선행 N이었다고 인증하거나, 새 이력 길이로 과거 횟수를 재계산하지 않는다. 자아쩜의 계정·호스트 식별 및 자동 생성 경로는 이번 구현 범위가 아니다.

기존 쩜의 `lastMentioned`는 새 사용자 언급의 `at` 또는 없을 때 `receivedAt`으로 갱신하되 이전 값보다 과거로 돌리지 않는다. 호스트 근거는 이 값을 올리지 않는다. 새 쩜의 생성 시각 기본값은 기존 생성기의 동작을 유지하며, 실제 원발화 시각은 이력의 `occurredAt`으로 구분한다.

## 편집·재전송·저장 실패

- 확정 전 `final:false` 발화는 기록하지 않으므로 최종 확정 전에 편집할 수 있다. 이미 저장된 ID에 다른 내용·역할·원발화 시각을 보내면 오류로 거부한다. 이 API는 저장된 발화의 편집·철회·횟수 역산 기능을 제공하지 않는다. 정정 내용을 새 발화로 처리하려면 새 ID를 명시적으로 발급하며, 이는 별개의 최종 발화다.
- 초안의 유효 근거가 전부 이미 저장된 완전 재전송이면 횟수뿐 아니라 해당 초안의 사실·사건·편집 이력도 반복 추가하지 않는다. 기존 근거와 새 근거가 섞인 초안은 내용을 갱신하므로 사건·편집 이력이 추가될 수 있다. 같은 요청 안의 별칭 초안에 있는 서로 다른 사실·태그·별칭은 합치면서 발화별 횟수만 한 번 반영한다. 이력과 횟수는 같은 쩜 저장 payload에 들어가며 첫 기록 시각은 덮어쓰지 않는다.
- 이미 처리한 쩜이 `archived/resting/merged`로 바뀌었어도 동일 이름·별칭과 기존 발화 근거가 모두 확인되는 완전 재전송은 새 쩜을 만들거나 상태를 되살리지 않는다. 새로운 발화에 대한 비활성 쩜 부활·병합 정책을 구현한 것은 아니다.
- 여러 쩜은 한 번에 원자적으로 저장되는 것이 아니다. 내용·이력을 먼저 저장한 뒤 모든 대상이 존재하는 상태에서 관계를 저장한다. 일부 저장이나 인덱스 저장이 실패하면 오류를 반환하고, 같은 준비 요청으로 재시도할 때 저장소를 다시 읽어 이미 반영한 쩜을 건너뛴다. 관계 저장만 일부 실패한 경우에는 빠진 방향을 다시 연결한다. 관계 증가량의 새 공식을 추가하지 않는다.
- 같은 프로세스에서 FileAdapter의 같은 실제 저장 경로·사용자에 대한 통합 호출은 순서대로 처리한다. 다른 StorageAdapter는 선택 메서드 `withOwnerLock`을 제공하거나 같은 어댑터 객체의 기본 대기열을 사용한다. 다른 프로세스·다른 어댑터의 직접 쓰기·`patchJJum`·`recall` 등 별도 경로까지 트랜잭션으로 보호하지 않는다. 호스트는 그런 쓰기를 별도로 직렬화해야 한다.
- 발급 ID를 처음 처리 전에 보관하지 않았고 응답까지 유실됐다면, 식별 정보 없는 새 요청이 재시도인지 확실히 알 수 없다. 쩜으로 저장된 근거가 없는 발화에 대한 전역 메시지 보관함도 만들지 않는다. 따라서 기억 이력이 없는 발화의 편집 충돌까지 영구 추적한다고 주장하지 않는다.

## 크기 제한과 기존 파일 호환

통합 옵션 `maxMentionHistoryEntries`의 기본값은 쩜당 **10,000개**이며 양의 정수다. 요청으로 추가할 이력이 상한을 넘으면 저장 전에 오류를 반환한다. 기존 이력을 몰래 잘라 중복 방지 근거를 잃거나 횟수만 올리지 않는다. 호스트가 상한을 조정할 수 있지만, 별도 보관·압축·삭제 정책은 구현하지 않는다.

과거 파일에 `mentionHistory`가 없으면 없는 상태 그대로 읽는다. 정상 이력의 추가 필드도 보존한다. 이력 형식이 손상된 해당 사용자의 저장소는 오류를 알려 처리 중단하며, 빈 이력으로 바꾸거나 같은 이름의 새 쩜을 만들어 중복 증가시키지 않는다. 다른 사용자의 손상 이력 때문에 현재 사용자의 기억을 섞거나 차단하지 않는다.

이 호환성은 **새 코어가 기존 파일을 읽는 방향**이다. 새 필드를 모르는 옛 검증기는 저장할 때 이력을 버릴 수 있으므로 이력 쓰기에 참여하는 실행 환경은 함께 업데이트해야 한다. 실제 개인 파일을 일괄 변환하거나 과거 언급 기록을 만들어 넣지 않는다.

## 로컬 HTTP 경로

기존 `POST /api/conversation`과 별칭 경로는 `conversationId`와 `turns[].utteranceId/receivedAt/at/final`을 코어로 전달한다. 성공 응답은 `extraction.receipt`, 준비 이후 처리 실패 응답은 `receipt`를 포함한다. 입력 자체가 잘못되어 준비되지 않았거나 처리 전 설정·연결 검사가 실패한 경우에는 영수증이 없을 수 있다. 발화 식별·시각 형식 오류는 HTTP 400으로 반환한다.

현재 콘솔 화면은 ID를 지속 보관하도록 수정하지 않았다. 안정적인 재시도가 필요한 호스트는 자체 ID를 제공하거나 위 준비 함수를 사용해야 한다. 이 경로는 저장 뒤 회상도 실행하므로, 언급 횟수의 중복 방지가 회상 횟수의 중복 방지까지 뜻하지 않는다. 재시도 시 회상 상태 갱신을 원하지 않으면 기존 `touch:false` 옵션을 사용한다.

## 로컬 검증

기존 `npm test`와 `npm run typecheck`에 더해 아래 검사를 실행한다. 테스트 파일은 저장소의 기존 방침대로 Git에서 제외되므로 현재 로컬 환경에만 있다. `package.json`에 무시되는 새 경로를 추가하지 않았다.

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/conversation-identity.test.ts tests/provider-extraction.test.ts tests/mention-storage.test.ts tests/mention-history.test.ts
```

가짜 SDK·합성 발화·임시 저장소로 검증하며, 실제 모델의 의미 판정 품질을 검증했다고 주장하지 않는다.
