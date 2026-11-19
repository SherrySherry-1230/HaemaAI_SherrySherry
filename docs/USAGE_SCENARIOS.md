<!-- @editedBy SherrySherry 2026-11-19 -->
# 해마.ai 웹콘솔에서 쩜통 연결하기

1. [해마.ai 웹콘솔](https://sherrysherry-1230.github.io/HaemaAI_SherrySherry/)에서 **쩜통 연결**을 먼저 누르고 자신의 운영체제에 맞는 설치본을 내려받는다. 해당 설치본의 다운로드가 제공되는지 콘솔에서 확인한다.
2. Windows에서는 ZIP을 모두 풀고 `RegisterWebControls.cmd`를 한 번 실행한다. 기억을 보관할 폴더를 선택하고 표시된 쩜통을 확인해 등록한다. 기존 기억을 계속 쓰려면 기존 쩜통을 고른다.
3. 웹콘솔을 다시 열고 **Start**로 준비 모드를 시작한다. 브라우저와 Windows에서 실행을 확인하면 선택한 PC의 쩜통이 연결된다.
4. **API 연결**에서 AI 제공자와 모델을 선택하고 필요한 키를 직접 입력해 연결한다. **AIStart**를 누르고 Windows 확인창에서 등록된 폴더와 대화 모드 전환을 확인한다.
5. **자기소개**를 입력해 저장하고 같은 쩜통에서 다시 열어 확인한다. 이제 호스트와 대화할 수 있다. 사용을 마치면 **Stop**으로 해당 쩜통의 실행을 종료한다.

자기소개만 먼저 작성하고 싶다면 준비 모드에서도 로컬에 저장할 수 있다.

### 웹콘솔의 Windows 실행 동작

세 버튼을 연결할 주소는 다음과 같다. 버튼을 아직 제공하지 않는 화면에서는 설치 폴더의 실행 파일을 쓸 수 있다. 파일로 준비 모드에서 대화 모드로 바꿀 때는 먼저 `Stop.cmd`를 실행한다.

| 버튼 | 웹콘솔에서 열 주소 | 같은 용도의 Windows 파일 |
| --- | --- | --- |
| AIStart · 대화 시작 | `haema-ai://ai-start` | `StartAI.cmd` |
| Start · 준비 시작 | `haema-ai://start` | `Start.cmd` |
| Stop · 종료 | `haema-ai://stop` | `Stop.cmd` |

웹콘솔 연결에는 `web-console/storage-downloads.mjs`가 내보내는 `windowsLauncherHandles`의 `aiStart`, `start`, `stop` 값을 사용한다. 각 주소는 사용자가 해당 버튼을 눌렀을 때 연다. macOS용 웹 실행 핸들은 아직 배포되지 않았다.
