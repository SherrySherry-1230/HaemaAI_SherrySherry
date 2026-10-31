<!-- @editedBy SherrySherry 2026-10-31 -->
# 해마.ai 내장 Laya 관찰 실행 환경

이 구현은 기존 쩜 저장 직후 검토를 유지하고, 호스트 초안·전송 보고·피드백·독립 복기를 별도 관찰 기록으로 연결한다. 새 관계 판단은 `mode: observe`, `actionable: false`다. 이 판단만으로 기억 본문, 쩜 회상 점수, 파워, 언급 매너 또는 모델 가중치를 변경하지 않는다. 한국어 사례 대조와 질문별 보정이 끝난 뒤 행동 반영 정책을 별도로 적용해야 한다.

## 로컬 작업자

`LayaDecisionEngine.awake()`가 Python 작업자 하나를 준비한다. 같은 작업자에서 순서대로 실행하며 같은 문맥의 독립 질문은 한 요청으로 묶는다. JSONL 표준 출력과 SDK 진단용 표준 오류를 분리한다. 프로세스가 종료되거나 시간 제한을 넘으면 진행 중 결과를 무효화하며 다음 요청의 재시작 횟수에 상한을 둔다. 종료 시 `close()`를 호출한다.

기존 설치된 SDK와 체크포인트 경로가 필요하다. 자동 다운로드, 모델 설치, 유료 API 대체를 하지 않는다. 실행은 Hugging Face/Transformers 오프라인 모드다. 실제 토크나이저가 계산한 입력 길이가 모델 한도를 넘으면 `input_too_long`으로 거절한다. 자동 잘림을 정상 판정으로 처리하지 않는다.

`predictBinary()`의 `pTrue`는 noul의 P(true) 원값이다. 기본 관찰 경계는 0.2/0.8이며 그 사이, 근거 부족, 길이 초과는 보류한다. 적용 대상 아님은 `skipped`, 실행 실패는 `failed`다. 모두 NO와 구별한다. 모델·토크나이저·정책·질문 버전, 허용 범위, 문맥과 근거 지문이 일치해야 캐시를 재사용한다. 대기열과 발화별 질문 작업 수도 제한한다.

실제 이진 추론의 입력 토큰은 `usageSource: laya.tokenizer`, `scope: haema`로 기존 사용량 장부에 남긴다. 출력·전체 토큰이 확인되지 않으면 `null`을 유지하므로 입력만 확인된 하한으로 표시된다. 캐시 재수신은 새 모델 호출이 아니다. 호스트의 답변 생성 토큰은 포함하지 않는다. 중단된 호출은 미확인 상태를 보존한다. 기존 3단계 검토·회상 경로의 사용량 미제공 기록은 별도이며 정확한 토큰을 확인한 것처럼 합산하지 않는다.

현재 콘솔 수신부는 새 사용량 출처 문자열을 허용하지 않는다. 기존 콘솔 API에는 `tokenUsageForLegacyConsole`로 출처 식별자만 `null`로 전달하고 토큰 수치·호출 ID를 그대로 보존한다. 장부 원본과 새 Laya API는 정확한 `laya.tokenizer`를 유지한다. 프론트 인계 항목은 새 출처 문자열 허용이며, 이 작업에서 UI 파일은 변경하지 않는다.

## 독립 PC 서비스

기존 SDK와 체크포인트가 준비된 환경에서 아래 변수들을 서비스 실행 환경에 설정한 뒤 `npm run laya:service`를 실행한다. 실제 토큰과 개인 경로를 Git에 저장하지 않는다.

| 설정 | 의미 |
| --- | --- |
| `HAEMA_DATA_DIR` | 기존 저장소의 실제 디렉터리. 자동 데이터 이행 없음 |
| `HAEMA_LAYA_OWNER_ID` | 인증 구성에 고정된 사용자 ID |
| `HAEMA_LAYA_HOST_ID` | 인증 구성에 고정된 호스트 ID |
| `HAEMA_LAYA_ACCESS_TOKEN` | 호스트 연결용 Bearer 토큰. 로그·응답에 노출하지 않음 |
| `HAEMA_LAYA_ENGINE_PATH` | 설치되어 있는 Laya SDK 폴더 |
| `HAEMA_LAYA_CHECKPOINT` | 설치되어 있는 체크포인트 폴더 |
| `HAEMA_LAYA_PYTHON_COMMAND` | 선택적 Python 실행 파일. 기본 SDK `.venv/bin/python` |
| `HAEMA_LAYA_DEVICE` | `cpu`(기본), `mps`, `cuda`; 실제 지원은 환경별 검증 필요 |
| `HAEMA_LAYA_RETAIN_TEXT` | `1`일 때만 인증된 대화 원문 보관. 기본은 지문만 보관 |
| `HAEMA_LAYA_PORT` | 기본 7881, 127.0.0.1에만 바인딩 |
| `HAEMA_LAYA_REFLECTION_INTERVAL_MS` | 기본 30000. 0은 주기 실행 없음; 10000~3600000 허용 |

UI가 닫혀도 이 프로세스가 실행 중이면 복기 기회를 처리한다. OS 서비스 설치나 자동 시작 등록은 하지 않는다. 모든 실행기가 꺼지면 큐는 대기한다. HTTP 수신은 모델 초기화와 분리되며 모델 미설치 상태를 준비 완료로 표시하지 않는다. SIGINT/SIGTERM은 큐 작업에 취소를 전달하고 Python과 HTTP를 닫는다. 기존 수동 시험 서버 7877과 독립적으로 실행할 수 있다.

기존 ignored 로컬 서버에도 동일 선택적 연결을 적용한다. 해당 서버는 별도 로컬 파일이므로 Git checkout만으로 배포되었다고 간주하지 않는다. 일반 `/api/conversation`의 기존 assistant 발화 처리 계약은 유지한다. 인증 없는 기존 요청을 새 호스트의 검증된 전송 보고로 승격하지 않는다.

## 인증된 HTTP 계약

모든 `/api/laya/*` 요청에 `Authorization: Bearer …`가 필요하다. 저장소는 서버가 선택한 실제 경로로 정하고 사용자·호스트는 서버 구성으로 고정한다. 본문의 다른 사용자/호스트는 403, 다른 저장소는 409, 구성 부재는 503이다. JSON 본문 상한은 256KiB이며 응답은 `no-store`다. 직접 외부 인터넷에 노출하는 인증·TLS 배포 설정은 이 로컬 실행기의 범위가 아니다.

| 메서드·경로 | 입력과 역할 |
| --- | --- |
| GET `/api/laya/status` | 모델 상태, 관찰 모드, 원문 보관 여부 |
| POST `/api/laya/turns` | `conversationId`, `turns: [{role, utteranceId, text, receivedAt?, replyToResponseId?}]`; 실제 발화 수신 기록 |
| GET `/api/laya/conversation?conversationId=…` | 같은 인증 범위의 발화·초안·피드백·확인된 선제 언급 근거·사용량 복원 |
| POST `/api/laya/host-draft` | `conversationId`, `requestId`, `userTurnId`, `draftId`, `draftText`, 선택적 `questionIds`, `revision`, `previousDraftId` |
| POST `/api/laya/host-response` | `conversationId`, `requestId`, `userTurnId`, `responseId`, `utteranceId`, `deliveredAt`(epoch ms), `finalText`, `draftId?` |
| POST `/api/laya/feedback` | `conversationId`, `feedbackId`, `userTurnId`, `text`, `replyToResponseId?`, `scopeKind` |
| GET/POST `/api/laya/reflections` | 작업 조회 / `jobId`, `conversationId`, `kind`, `sourceEventIds`로 생성 |
| POST `/api/laya/reflections/opportunity` | 선택적 `budgetMs`(최대 30000), 한 작업 실행 기회 |
| POST `/api/laya/reflections/cancel` | `jobId`, 취소 및 늦은 결과 차단 |
| POST `/api/laya/reflections/resume` | `jobId`, 자료·정책 준비 후 대기 작업 재개 |
| POST `/api/laya/reflections/enabled` | `enabled: boolean`, 해당 범위의 복기 허용/중지 |

`scopeKind`는 `expression`, `address`, `topic`, `situation`, `continuing`, `unspecified` 중 하나다. 특정 응답 연결이 없으면 피드백 대상을 추정하지 않는다. 사과·웃음·침묵만으로 R13의 긍정 경험을 확정하지 않는다. 초안 수정은 0→1 한 번만 허용하며 두 번째 대안이나 역방향 연결은 충돌이다. 새 사용자 입력이나 새 초안이 도착하면 이전 초안의 늦은 판정을 현재 결과로 적용하지 않는다.

기본 HTTP 실행기는 실제 사용자 원문이 있는 초안/전송 응답의 R01, 원문과 명시적인 실제 응답 연결이 있는 피드백의 R11만 필수 근거 조건을 통과시킨다. 다른 질문 ID를 요청해도 조건이 준비되지 않으면 `abstained`다. J01~J04/R02~R14의 개별 주장·대상·개인 맥락 검사는 SDK의 `eligibility`와 직접 근거를 명시적으로 제공하는 연결부에서 사용한다. 질문표가 존재한다는 이유만으로 모든 질문을 실행하거나 실제 행동에 적용하지 않는다.

수신 기록과 기존 추출 처리 완료는 구별한다. `/turns`와 `/host-response`는 추출·요약 AI를 자동 호출하지 않으며 `needsConversationProcessing`을 반환한다. 호스트 연결부는 같은 ID로 기존 대화 처리 경로를 호출한 뒤 `claimProcessing`/`markConversationProcessed` 계약으로 완료를 남긴다. 전송 보고와 assistant 수신의 순서가 바뀌어도 같은 발화는 한 기록으로 대응한다. ID가 같은데 내용이 다르면 충돌이며 기존 기록을 덮어쓰지 않는다.

## 기억 검토와 별도 기록

v4는 기존 저장→대기 태그→판정/이유/근거 선택 흐름을 유지한다. 수동 편집의 실제 원문은 `manualEdits`로 전달하며 사용자 발화를 만들어 넣지 않는다. v5의 `LayaV5Reviewer`에는 쩜 본문 투영과 원문 발화·근거 참조·수동 편집을 전달한다. 필수 필드가 부족한 후보는 `.jj` 확정 저장으로 통과시키지 않고 `retainCandidate` 접점으로 보존한다.

본문이 바뀌면 이전 정상 태그의 유효성을 끝낸다. 파워·매너의 수치 재계산만으로 본문 검토를 반복하지 않는다. 검토 태그와 짧은 이유·날짜/시각/시간대가 있는 단일 시각을 호스트 전달에 포함한다. `.jj`에 영구 검토 버전을 추가하지 않는다. File v5 저장소의 별도 작업 상태는 쓰기 잠금·세대·임대·완료 조건 검증으로 다른 프로세스의 수정과 A→B→A 변경을 구별한다. custom 저장소는 같은 계약을 구현해야 동일한 보호를 제공한다.

관찰과 발화 대응은 별도 `.laya-journal`, 복기 큐는 `reflection-*.json`, v5 검토 작업 상태는 별도 sidecar에 저장된다. 같은 파일 저장소를 공유하는 프로세스 간 잠금만 제공한다. 서로 다른 기기의 파일을 자동으로 분산 동기화하지 않는다. 손상·잠금·권한 오류는 빈 기록으로 초기화하지 않는다. 원문 보관을 끄거나 길이를 초과한 경우 원문이 없다는 상태를 유지하며 조용히 잘라서 쓰지 않는다.

실제 선제 언급 근거는 전송 보고·실제 문자 구간·전달된 쩜·사용자 선행 언급 부재를 대응해 기록한다. 탐색·초안·콘솔 미리보기를 실제 발언으로 세지 않는다. 기존 이력 저장과 수치 감쇠식 적용은 구별하며, 미정 감쇠식이나 쩜 회상 점수 식은 추가하지 않는다.

v5 연결부는 `recordV5HostProactiveMention`을 명시적으로 호출해 검증된 journal 사건을 기존 `hostProactiveMentionHistory`에 연결할 수 있다. 같은 호스트·대화·발화는 한 번 기록하고 실제 저장소 권한과 최신 쩜을 다시 확인한다. 이 SDK 접점은 기본 관찰 서비스가 자동으로 실행하지 않는다.

## 독립 복기와 모바일 연결 범위

작업 종류는 `episode`, `aliases`, `relationship`, `correction`, `positive_response`, `memory_connections`, `policy_recalculation`, `response_practice`, `training_candidates`다. 등록 ID·원문 지문·프로필/모델 출처와 예산을 보존하고, 실행 전에 원문과 권한을 다시 확인한다. 임대 만료·중단·중복 요청에는 세대 표식으로 늦은 완료를 거절한다. 커서와 예산을 저장하고 명시적인 재개 기회에 이어 처리한다. 복기 자체는 새 사용자 언급이나 회상으로 집계되지 않는다.

기본 서비스는 실제 전송 응답의 `episode`/`training_candidates` 관찰을 수행한다. 생성기가 필요한 다른 작업은 `waiting`으로 남는다. SDK `ReflectionRunner`에 생성기를 연결할 때도 제안 수정은 최대 한 번이다. 외부 생성은 작업별 전체/회당 토큰 상한과 영속적인 일일 비용 예약 콜백을 모두 요구한다. 예약된 호출의 결과가 불명확하면 자동 재시도하지 않는다. 기본 서비스는 외부 생성 호출이나 모델 훈련을 하지 않는다.

iOS BGProcessing/Android WorkManager 연결부는 동일 ID로 큐를 동기화하고 OS가 허용한 짧은 시간에 `/opportunity`를 호출하며 종료/취소를 전달하는 방식이다. 이 저장소에는 네이티브 앱 프로젝트가 없어 실제 OS 등록·기기 실행·모바일 모델 포팅은 포함하지 않는다. 모바일에서 로컬호스트가 PC를 뜻하지 않으므로 별도 인증된 전송 연결도 필요하다. 시각·주기를 보장하지 않는다. 검수된 학습 사례와 모델 가중치 훈련은 별도 승인·검증 단계다.

## 검증 범위

2026-10-31에는 합성 원문과 임시 저장소로 프로세스 재사용·길이 초과·중단·재시작·중복·범위 분리·원자 저장·재로드·v5 동시 수정·HTTP 인증을 검사했다. 기존 설치된 multilingual Laya 체크포인트를 CPU로 실제 읽어 같은 PID에서 이진 질문 묶음도 실행했다. 한국어 관계 판단의 품질, 임계값 보정, MPS/CUDA, 실호스트 제품 통합, 모바일 OS 실행, 모델 훈련은 검증 완료로 보고하지 않는다. 프로젝트의 테스트 파일은 현재 ignored 로컬 자산이므로 깨끗한 checkout의 테스트 재현성과 구별한다.
