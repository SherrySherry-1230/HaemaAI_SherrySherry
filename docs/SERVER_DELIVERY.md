<!-- @editedBy SherrySherry 2026-10-20 -->
# 로컬 백엔드 서버 전달

`local-server/`와 `tests/`는 Git 무시를 유지한다. 전용 브랜치의 코어·계약 문서를 push해도 해당 서버 파일은 전달되지 않는다. 프론트 `767b9d1`을 사용하려면 검증한 서버 패키지를 같은 저장소에 별도로 전달한다.

## 패키지 내용과 적용

이번 작업의 `AI/introduction-2026-10-20/delivery/haema-backend-introduction.zip`은 아래 허용 목록으로 만든다.

- `src/**/*.ts`: 검증한 백엔드 코어와 어댑터
- `local-server/server.ts`, `local-server/providerModels.ts`: 실행 서버와 모델 목록 지원
- `package.json`, `package-lock.json`, `tsconfig.json`: 기존 의존성과 실행·타입 설정
- 자기소개 API·전달 문서와 합성 자기소개 검사
- `tests/fixtures/haema-introduction-767b9d1.js`: 프론트 수신 호환 확인용 고정 원본
- 각 파일 SHA-256과 백엔드 커밋을 기록한 `backend-delivery-manifest.json`

개인 기억·소개 원본·API 키·.env·저장소 설정·AI/HISTORY·node_modules·프론트 파일은 포함하지 않는다. 패키지는 로컬 검토·전달용이며 다른 컴퓨터를 자동 변경하거나 공개 배포하지 않는다.

1. 받는 저장소의 미커밋 변경과 기존 `src/`, 서버·의존성 설정을 백업한다. 해당 경로에 별도 변경이 있으면 일괄 덮어쓰지 말고 manifest와 대조해 병합한다.
2. 프론트 저장소에 패키지의 디렉터리 구조를 유지해 풀어 넣는다. `index.html`, `web-console/`, 기존 개인 기억·설정은 패키지에서 교체하지 않는다.
3. Node23.6.0 또는 같은 TypeScript 직접 실행 옵션을 지원하는 Node 환경을 사용한다. 의존성이 없으면 받는 환경에서 `npm ci`를 실행한다. 이 작업에서 새 모델이나 의존성을 대신 설치하지는 않는다.
4. 저장소 루트에서 아래처럼 별도의 설정 경로·포트로 서버를 실행한다. Mac/Linux 예시이며 Windows PowerShell에서는 환경 변수를 `$env:변수명`으로 설정한다.

```sh
HAEMA_CONFIG_DIR=/절대경로/별도서버설정 PORT=3333 npm run server
```

```powershell
$env:HAEMA_CONFIG_DIR = 'C:\absolute\haema-server-config'
$env:PORT = '3333'
npm run server
```

기존 서버 설정을 계속 사용하는 경우에는 같은 설정 폴더를 지정한다. 개인 기억을 테스트용 폴더로 대체하거나 초기화하지 않는다. 별도 실행 서버에 연결하는 프론트는 자기소개 API와 같은 서버 주소로 status/init·POST/GET을 보내도록 구성해야 한다. 서버 바인딩·공개망·접근 권한 설정을 이 패키지가 변경하지 않는다.

## 적용 후 확인

`npm run typecheck` 후 같은 환경에서 합성 검사만 실행할 수 있다.

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test tests/introduction-store.test.ts tests/introduction-name.test.ts tests/introduction-host.test.ts tests/introduction-http.test.ts
```

패키지의 합성 검사는 임시 폴더와 모의 제공자를 사용한다. 실제 API나 개인 기억을 대상으로 실행하지 않는다. 그 뒤 프론트의 실제 연결을 확인한다.

1. status/init에서 현재 storageId를 받고, 소개 GET의 사용자·저장소 신원을 대조한다.
2. 합성 소개를 저장해 원문·줄바꿈·호칭·revision을 확인한다.
3. 재조회·서버 재시작·같은 저장소 재연결에서 복원되는지 확인한다.
4. 다른 사용자·저장소에서 섞이지 않고, 오래된 revision의 수정이409로 거부되는지 확인한다.
5. 호스트가 `hostPreview.userContext` 또는 소개 context API의 고정 지시와 데이터를 수신하는지 확인한다.

이번 맥북 검증과 패키지 검사 결과는 작업 증거에 기록한다. 다른 Windows 환경의 실제 프론트·모델 연결은 해당 환경에서 별도로 검증해야 한다.
