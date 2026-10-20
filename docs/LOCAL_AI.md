<!-- @editedBy SherrySherry 2026-10-14 -->
# 해마.ai 로컬 AI 연결

해마.ai는 Ollama 또는 LM Studio의 OpenAI 호환 서버를 통해 대화에서 기억을 추출하고 요약할 수 있다.
서버 주소와 모델을 지정하며, 인증을 켠 서버에서만 API 키가 필요하다.
사용자에게 전달할 최종 응답은 호스트 챗봇이 만든다.

## 연결 설정

| 실행 도구 | `provider` | 기본 `baseUrl` | `apiKey` |
| --- | --- | --- | --- |
| Ollama | `ollama` | `http://127.0.0.1:11434/v1` | 기본 생략 |
| LM Studio | `lmstudio` | `http://127.0.0.1:1234/v1` | 기본 생략, 서버 인증을 켰으면 토큰 입력 |

실행 도구에서 모델을 내려받고 API 서버를 먼저 실행한다. `model`에는 서버의 `/v1/models`가 반환하는 모델 ID를 넣는다.
해마.ai는 모델을 설치하거나 내려받지 않는다. 설치된 모델이 없으면 모델 목록은 빈 배열이며 임의의 클라우드 모델로 대체하지 않는다.
주소를 변경할 때는 `/v1`까지 지정한다. 경로 없는 서버 주소는 자동으로 `/v1`을 붙이며 끝의 `/`는 제거한다.
별도 경로를 지정하면 그대로 사용한다. LAN 서버도 명시적인 `baseUrl`로 연결할 수 있다.

## 코어에서 사용

```ts
import { OpenAIAdapter } from './src/index.ts';

const ai = new OpenAIAdapter({
  provider: 'ollama',
  model: 'SERVER_MODEL_ID', // /v1/models에서 확인한 모델 ID
});

// LM Studio로 바꿀 때는 provider: 'lmstudio'와 해당 서버의 모델 ID를 사용한다.
// 포트나 서버가 다르면 baseUrl을 지정한다. 인증을 켠 서버는 apiKey도 지정한다.
```

이 어댑터를 기존 `processConversationToStorage()` 등 AI 어댑터를 받는 함수에 전달한다.
키가 없으면 실제 요청의 `Authorization` 헤더도 생략한다. 키가 있으면 `Bearer` 인증으로 전달한다.
로컬 제공자는 `SOLAR_BASE_URL`이나 클라우드 환경변수를 기본 주소로 사용하지 않는다.
기존 OpenAI·Anthropic 등 클라우드 제공자의 API 키 요구는 유지한다.

## 로컬 서버 API에서 사용

현재 작업 환경의 로컬 서버는 `npm run server`로 실행한다. 아래 예시는 기본 포트 7877을 사용한다.
로컬 서버와 테스트 파일은 기존 저장소 정책에 따라 Git에서 제외되어 있다. 코어 연결부는 Git에 포함된다.

모델 목록 확인:

```sh
curl -X POST http://127.0.0.1:7877/api/provider/models \
  -H 'Content-Type: application/json' \
  -d '{"provider":"ollama"}'
```

반환된 `models[].id`로 설정 저장:

```sh
curl -X POST http://127.0.0.1:7877/api/config/save \
  -H 'Content-Type: application/json' \
  -d '{"provider":"ollama","model":"SERVER_MODEL_ID"}'
```

LM Studio는 두 요청의 `provider`를 `lmstudio`로 바꾼다. 필요하면 `baseUrl`과 `apiKey`를 함께 전달한다.
`GET /api/config/status`는 키 없는 로컬 설정도 `configured: true`로 반환한다.
이후 기존 저장소 연결과 `POST /api/conversation`을 사용하면 추출·저장·회상 결과가 `hostPreview`로 반환된다.
코어는 키를 저장하지 않는다. 로컬 서버 API에서 선택적으로 입력한 키는 기존 설정 저장 방식에 따라 비공개 `.env` 파일에 저장한다.

이 변경은 백엔드 연결과 API를 제공한다. 웹 콘솔의 제공자 선택 화면 추가는 별도 프론트엔드 작업이다.

## 응답 형식과 연결 실패

- 추출·병합 판정·회상 점수화는 `response_format: json_schema`를 보내 기존 기억 처리 형식에 맞춘다. 요약은 일반 텍스트다.
- JSON Schema 구조화 출력을 지원하는 서버·모델 조합이 필요하다. 형식 지원과 기억 내용의 정확도는 별도로 검증한다.
- 모델 목록 조회 제한 시간은 5초, 로컬 모델 호출은 120초다. 로컬 모델 호출은 자동 재시도하지 않는다.
- 서버 중단·인증 거부·형식 오류는 실패로 반환한다. 다른 제공자나 클라우드 모델로 자동 전환하지 않는다.
- `npm run server`는 지정한 로컬/LAN 주소로 직접 연결한다. Firebase 프록시 모드는 기존 전송 규칙상 `127.0.0.1`·`localhost` 연결을 직접 처리하며 LAN 주소는 지원하지 않는다.

## 구현·검증 기록 — 2026-10-14

작성·구현: SherrySherry. 기획팀이 합의한 로컬 AI 연결 범위에 따라 코어 어댑터와 로컬 서버 API를 확장했다.
로컬 모의 서버로 API 키 생략, 선택 인증, 모델 목록, 제공자 전환, 기억 저장 및 새 대화의 단서 기반 회상을 확인했다.
기존 핵심·제공자 검사 89건, 기존 HTTP 검사 9건, 신규 로컬 AI HTTP 검사 9건 등 runner 기준 107건이 통과했다.
HTTP 검사에는 부모 검사 2건이 포함된다. TypeScript 검사도 통과했다.
실제 Ollama·LM Studio 모델의 한국어 추출 품질과 실행 속도는 아직 검증하지 않았다.

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/local-ai-http.test.ts
npm run typecheck
```

공식 문서: [Ollama OpenAI 호환 API](https://docs.ollama.com/api/openai-compatibility),
[Ollama 구조화 출력](https://docs.ollama.com/capabilities/structured-outputs),
[LM Studio OpenAI 호환 API](https://lmstudio.ai/docs/developer/openai-compat),
[LM Studio 구조화 출력](https://lmstudio.ai/docs/developer/openai-compat/structured-output),
[LM Studio 인증](https://lmstudio.ai/docs/developer/core/authentication).
