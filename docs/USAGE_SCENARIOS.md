<!-- @editedBy SherrySherry 2026-11-24 -->
# 해마.ai 웹콘솔에서 쩜통 연결하기

1. [해마.ai 웹콘솔](https://sherrysherry-1230.github.io/HaemaAI_SherrySherry/)에서 **쩜통 연결**을 먼저 누르고 자신의 운영체제에 맞는 설치본을 내려받는다. 해당 설치본의 다운로드가 제공되는지 콘솔에서 확인한다.
2. ZIP을 모두 푼 뒤 운영체제에 맞는 파일을 연다.
   - **macOS 13.5 이상**(Apple Silicon · Intel)에서는 Safari로도 설치본을 내려받을 수 있다. 쩜통 연결에는 Mac에 설치된 Google Chrome이 필요하다. Finder에서 `쩜통_연결.command`를 열고 기억을 보관할 폴더를 선택한다. 터미널에 “해마.ai가 준비됐어요.”가 표시되면 실행기가 연 Chrome 창에서 계속한다. Mac의 기본 브라우저 설정은 그대로 유지된다.
   - **Windows**에서는 `쩜통_연결.cmd`를 실행한다. 기억을 보관할 폴더를 선택하고 표시된 쩜통을 확인해 등록한다. 기존 설치를 갱신할 때는 기존 실행기 폴더의 `Stop.cmd`로 종료하고, 새 ZIP을 별도 폴더에 푼 뒤 새 `쩜통_연결.cmd`에서 기존 실행기 폴더를 고른다. 실행기와 기억이 서로 다른 드라이브에 있으면 웹콘솔에서 선택해 둔 기억 저장 위치도 이어서 사용한다.
3. 등록을 마치면 준비 모드로 연결된 웹콘솔이 열린다. 이후에는 웹콘솔의 **Connect** 또는 아래의 운영체제별 파일로 준비 모드를 열 수 있다.
4. **API 연결**에서 AI 제공자와 모델을 선택하고 필요한 키를 직접 입력해 연결한다. **AI Start**를 누르고 실행기 확인 창에서 기억 저장 위치와 대화 모드 전환을 확인한다.
5. 호스트를 선택해 대화를 시작한다. **자기소개**는 선택 사항이며 같은 쩜통에 저장해 다시 열 수 있다. 사용을 마치면 **Stop**으로 해당 쩜통의 실행을 종료한다.

자기소개만 먼저 작성하고 싶다면 준비 모드에서도 로컬에 저장할 수 있다.

### 웹콘솔의 실행 동작

웹콘솔은 현재 연결된 쩜통과 실행기를 확인한다. **쩜통 연결**과 **API 연결**을 마치면 실행 버튼을 사용할 수 있다. 브라우저가 실행기 열기를 물으면 허용하고, 실행기에 표시된 저장 폴더와 동작을 확인한다.

| 웹콘솔 버튼 | 기본 실행 주소 | macOS 파일 | Windows 파일 |
| --- | --- | --- | --- |
| Connect · 준비 모드 연결 | `haema-ai://start` | `Start.command` | `Connect.cmd` |
| AI Start · 대화 시작 | `haema-ai://ai-start` | `StartAI.command` | `StartAI.cmd` |
| Stop · 종료 | `haema-ai://stop` | `Stop.command` | `Stop.cmd` |

`web-console/storage-downloads.mjs`에서 두 운영체제의 공통 실행 주소를 `launcherHandles`로 제공한다. 기존 `windowsLauncherHandles`도 같은 값을 제공한다. Windows에서 파일로 대화 모드로 바꿀 때는 먼저 `Stop.cmd`를 실행한다. 기존 `Start.cmd` 바로가기도 준비 모드를 연다.
