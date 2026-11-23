<!-- @editedBy SherrySherry 2026-11-22 -->
# 해마.ai 웹콘솔에서 쩜통 연결하기

1. [해마.ai 웹콘솔](https://sherrysherry-1230.github.io/HaemaAI_SherrySherry/)에서 **쩜통 연결**을 먼저 누르고 자신의 운영체제에 맞는 설치본을 내려받는다. 해당 설치본의 다운로드가 제공되는지 콘솔에서 확인한다.
2. Windows에서는 ZIP을 모두 풀고 `RegisterWebControls.cmd`를 한 번 실행한다. 기억을 보관할 폴더를 선택하고 표시된 쩜통을 확인해 등록한다. 기존 설치를 갱신할 때는 기존 실행기 폴더의 `Stop.cmd`로 종료하고, 새 ZIP을 별도 폴더에 푼 뒤 새 `RegisterWebControls.cmd`에서 기존 실행기 폴더를 고른다. 실행기와 기억이 서로 다른 드라이브에 있으면 웹콘솔에서 선택해 둔 기억 저장 위치도 이어서 사용한다.
3. 등록을 마치면 준비 모드로 연결된 웹콘솔이 열린다. 이후에는 웹콘솔의 **Connect** 또는 설치 폴더의 `Connect.cmd`로 준비 모드를 열 수 있다.
4. **API 연결**에서 AI 제공자와 모델을 선택하고 필요한 키를 직접 입력해 연결한다. **AI Start**를 누르고 Windows 확인창에서 기억 저장 위치와 대화 모드 전환을 확인한다.
5. **자기소개**를 입력해 저장하고 같은 쩜통에서 다시 열어 확인한다. 이제 호스트와 대화할 수 있다. 사용을 마치면 **Stop**으로 해당 쩜통의 실행을 종료한다.

자기소개만 먼저 작성하고 싶다면 준비 모드에서도 로컬에 저장할 수 있다.

### 웹콘솔의 Windows 실행 동작

웹콘솔과 Windows 설치 폴더에서 아래 세 동작을 실행할 수 있다. 웹콘솔은 연결한 쩜통과 실행기를 함께 확인한다. 파일로 준비 모드에서 대화 모드로 바꿀 때는 먼저 `Stop.cmd`를 실행한다.

| 버튼 | 기본 실행 주소 | 같은 용도의 Windows 파일 |
| --- | --- | --- |
| Connect · 준비 모드 연결 | `haema-ai://start` | `Connect.cmd` |
| AI Start · 대화 시작 | `haema-ai://ai-start` | `StartAI.cmd` |
| Stop · 종료 | `haema-ai://stop` | `Stop.cmd` |

웹콘솔 연결에는 `web-console/storage-downloads.mjs`가 내보내는 `windowsLauncherHandles`의 `aiStart`, `start`, `stop` 값을 사용한다. 기존 `Start.cmd` 바로가기도 준비 모드를 연다. macOS용 웹 실행 핸들은 아직 배포되지 않았다.
