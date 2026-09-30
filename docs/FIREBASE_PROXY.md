# Firebase 프록시로 M2 로컬 시뮬레이션

작성: SherrySherry · 2026-10-01

Firebase 프로젝트: `haema-ai-sherrysherry` · 표시 이름: `haema ai`.
[프로젝트 콘솔](https://console.firebase.google.com/project/haema-ai-sherrysherry/overview)

## 동작

로컬 웹 콘솔 → 로컬 서버·AI SDK → Firebase `haemaProxy` → 선택한 AI 제공자.
웹콘솔에서 제공자·모델·API 키를 저장하거나 다른 저장 키를 활성화하면 다음 요청부터 바뀐다.
모델 조회와 프롬프트 전송 모두 프록시를 사용한다.
AI 키는 기존 로컬 콘솔 설정에서 관리하며, Firebase에는 요청 중에만 전달한다.
Firebase 코드에서는 AI 키·프롬프트를 저장하거나 로그에 남기지 않는다.
쩜 파일 생성·수정·저장·회상 및 가상 호스트 전달은 기존 로컬 서버에서 실행한다.

지원: OpenAI, Anthropic, Google Gemini, Upstage Solar, Groq, Grok, DeepSeek, OpenRouter.
Upstage와 Groq는 콘솔의 `OpenAI Compatible`을 선택하고 각각
`https://api.upstage.ai/v1/solar`, `https://api.groq.com/openai/v1`을 Base URL로 지정한다.
다른 제공자는 해당 제공자를 선택하고 기본 Base URL을 사용한다.
프록시 주소를 콘솔의 Base URL에 넣지 않는다. 전송 계층이 자동으로 Firebase를 거친다.
등록되지 않은 외부 제공자 주소·임의 URL·스트리밍은 거부한다.
로컬 주소는 Firebase를 거치지 않으며 기존 로컬 테스트에 사용할 수 있다.

## 실행

이 작업 폴더에 `.env.firebase-proxy`가 비공개 파일(권한 600)로 생성되어 있다.
프록시 URL과 접근 토큰만 들어 있으며 Git에서 제외된다. AI 키는 이 파일에 넣지 않는다.

```sh
npm run server:firebase
```

콘솔에서 저장소 선택 → API 설정에서 제공자·키 입력 → 모델 조회 → 모델 선택·저장 → 대화 입력.
다른 AI로 바꾸려면 기존 API 설정 화면에서 다른 키를 선택하거나 새 키를 저장한다.
기존 `npm run server`는 Firebase를 거치지 않는 직접 호출 모드다.

## Firebase 최초 배포

Node.js 22와 Firebase CLI가 필요하다. 실제 배포에는 Blaze 결제 연결이 필요하다.
프록시 인증 토큰 하나만 Firebase Secret Manager에 등록한다.

```sh
npm --prefix functions ci
npx firebase-tools functions:secrets:set HAEMA_PROXY_TOKEN --project haema-ai-sherrysherry
npx firebase-tools deploy --only functions:haemaProxy --project haema-ai-sherrysherry
```

Secret 값은 `.env.firebase-proxy`의 `HAEMA_PROXY_TOKEN`과 같아야 한다.
프록시 토큰은 32자 이상 무작위 문자열로 관리한다. 채팅이나 Git에 붙이지 않는다.
함수는 서울 리전, 최대 인스턴스 1개·동시 요청 4개로 실행한다.
입력 128 KiB·출력 최대 4096 토큰 제한은 총비용 상한을 의미하지 않는다.
API 제공자 키와 모델은 Firebase에 고정하지 않으므로 콘솔에서 바꾸기 위해 재배포할 필요가 없다.
브라우저 직접 호출용 CORS는 열지 않는다. Firebase 접근 토큰은 로컬 서버만 사용한다.

## 검증

```sh
npm run test:firebase
npm run test:firebase:m2
npm run typecheck
npm test
```

자동 테스트는 실제 로컬 서버와 SDK 전송을 사용하고 외부 AI 응답을 모의 처리한다.
로컬 전용 `local-server/`, 기존 `tests/`, `tools/`는 저장소 정책상 Git에서 제외되어 있으므로
M2 통합 테스트와 로컬 콘솔은 현재 개발 작업 폴더에서 실행한다.
Firebase 함수만의 테스트는 `npm --prefix functions test`로 새 clone에서도 실행할 수 있다.

실제 배포 후 콘솔에 “오늘 샘플카페에서 책을 읽었어”를 입력해 쩜 생성·요약을 확인한다.
같은 대상을 다시 언급하고 쩜 수정·회상 결과와 `hostPreview`를 확인한다.
제공자·키·모델을 바꿔 반복하고 잘못된 키에서 오류가 반환되는지도 확인한다.
배포와 실제 AI 응답을 확인하기 전에는 M2의 실제 연결 검증을 완료로 기록하지 않는다.

에뮬레이터: `functions/.secret.local`에 `HAEMA_PROXY_TOKEN`을 넣고
`npx firebase-tools emulators:start --only functions --project demo-haema`로 실행한다.
로컬 설정 URL을 `http://127.0.0.1:5001/demo-haema/asia-northeast3/haemaProxy`로 지정한다.
에뮬레이터도 실제 AI 키를 넣으면 외부 AI를 호출하므로 사용료가 발생할 수 있다.

근거: [HTTP 함수](https://firebase.google.com/docs/functions/http-events),
[Secret 관리](https://firebase.google.com/docs/functions/config-env).

## 2026-10-01 준비 결과

- 한 것: 프로젝트 생성, 다중 제공자 프록시·로컬 실행 모드·기본 프로젝트 연결.
- 검증: 기존 테스트 52개, 신규 프록시·전송·SDK 테스트 12개, M2 통합 테스트 1개 통과. 타입 검사 통과. 기존 시나리오 18/18 통과(선택·미검증 2개 제외).
- 안 한 것: 실제 AI 키로 클라우드 호출 검증, 실제 호스트 챗봇 연동.
- 막힌 것: 프로젝트 Blaze 결제 미연결로 Secret Manager 활성화·토큰 등록·함수 배포 대기.
- 다음: 결제 연결 후 Secret 등록 → 함수 배포 → 웹콘솔에서 실제 키 전환·쩜 생성·회상 확인.
