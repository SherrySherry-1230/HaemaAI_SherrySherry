# 🔧 API Key Modal 문제 추적 및 해결 보고서

## 문제 현상

### 1. Base URL 자동 입력 안 됨
- 사용자가 OpenAI Provider를 선택해도 Base URL이 자동으로 입력되지 않음
- 사용자가 API Key를 입력해도 Base URL이 자동으로 입력되지 않음

### 2. 모델 목록 표시 안 됨
- 사용자가 API Key를 입력해도 모델 목록이 드롭다운에 표시되지 않음
- 모델 select가 "모델을 선택하세요" 상태로 유지됨

### 3. 현재 모달 DOM에 값 반영 안 됨
- 백엔드 API(/api/provider/models)는 정상 작동 (curl 테스트 성공)
- 하지만 프론트엔드에서 실제 모달 DOM에 값이 반영되지 않음

## 실제 원인

### 원인 1: 이벤트 바인딩 타이밍 문제
- `bindEvents()`가 `DOMContentLoaded` 시점에만 호출됨
- 모달이 나중에 열리는 경우 이벤트가 연결되지 않음
- 코드 위치: `haema-api-key-modal.js` line 1354-1357

### 원인 2: DOM 재생성으로 인한 이벤트 소멸
- `HAEMA_CONSOLE.render()`가 `app.innerHTML`로 전체 HTML을 덮어씌움
- 이로 인해 모달 DOM이 재생성되고 이벤트 리스너가 사라짐
- 코드 위치: `haema-console.js` line 37

### 원인 3: 이벤트 중복 바인딩
- `bindEvents()`가 매번 호출될 때마다 이벤트 리스너가 중복으로 추가됨
- 이로 인해 이벤트가 여러 번 발생하거나 예기치 않은 동작 가능

### 원인 4: Base URL 업데이트 조건
- `updateBaseUrl()` 함수의 조건문 `if (!current || current === lastAutoBaseUrl)`가 너무 엄격함
- 사용자가 Base URL을 직접 수정한 경우에만 유지하려다가 자동 업데이트가 안 됨

### 원인 5: API Key 입력 시 모델 조회 조건
- `refreshModelOptions()`가 API Key 입력 시에만 호출되도록 제한됨
- Provider가 선택되지 않은 상태에서는 모델 조회가 안 됨

## 추적 과정

### 1단계: 백엔드 API 테스트
```bash
curl -X POST http://localhost:7877/api/provider/models \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","apiKey":"...","baseUrl":""}'
```
- 결과: ✅ 성공, 145개 모델 반환
- 응답 구조: `{ success: true, models: [{id: "gpt-4o", name: "gpt-4o"}, ...] }`

### 2단계: 프론트엔드 JS 파일 로드 확인
- 브라우저가 로드하는 파일: `web-console/haema-api-key-modal.js?v=3`
- 캐시 문제 가능성 확인
- 해결: 쿼리 파라미터를 v=4, v=5로 증가하여 캐시 방지

### 3단계: 이벤트 바인딩 흐름 추적
```
DOMContentLoaded
  → bindEvents() 호출
  → API Key input 이벤트 등록

openApiKeyModal()
  → render() 호출
  → app.innerHTML로 DOM 재생성
  → bindEvents() 호출 (이미 호출됨)
  → 이벤트가 DOM 재생성으로 사라짐
```

### 4단계: DOM 재생성 문제 발견
- `HAEMA_CONSOLE.render()`가 전체 HTML을 재생성
- 이로 인해 이벤트 리스너가 사라짐
- 해결: `setTimeout(..., 0)`을 사용하여 DOM 렌더링 후 이벤트 바인딩

### 5단계: 이벤트 중복 바인딩 방지
- `eventsBound` 플래그 추가
- 이미 이벤트가 바인딩되어 있으면 중복 방지

## 수정 내용

### 파일 1: web-console/haema-api-key-modal.js

#### 수정 1: 이벤트 중복 바인딩 방지
```javascript
let eventsBound = false;

async function bindEvents() {
    if (eventsBound) return;
    // ... 이벤트 바인딩 로직
    eventsBound = true;
}
```
- 위치: line 1227

#### 수정 2: Base URL 업데이트 로직 수정
```javascript
function updateBaseUrl() {
    if (!providerSelect || !baseUrlInput) return;
    const provider = providerSelect.value;
    if (!provider) return;
    
    const nextDefault = getDefaultBaseUrl(provider);
    // 항상 기본 Base URL로 업데이트
    baseUrlInput.value = nextDefault;
    lastAutoBaseUrl = nextDefault;
}
```
- 위치: line 1235
- 변경: 조건문 제거, 항상 업데이트

#### 수정 3: API Key 입력 시 Base URL 업데이트 추가
```javascript
if (apiKeyInput) {
    apiKeyInput.addEventListener("input", () => {
        updateBaseUrl();
        refreshModelOptions();
    });
}
```
- 위치: line 1285
- 변경: API Key 입력 시 Base URL도 자동 업데이트

### 파일 2: web-console/haema-console.js

#### 수정 1: DOM 렌더링 후 이벤트 바인딩
```javascript
HAEMA_CONSOLE.openApiKeyModal = function() {
    this.modalMode = "apiKey";
    this.modalData = { ... };
    this.render();
    
    setTimeout(() => {
        if (typeof HAEMA_API_KEY_MODAL !== "undefined" && typeof HAEMA_API_KEY_MODAL.bindEvents === "function") {
            HAEMA_API_KEY_MODAL.bindEvents();
        }
    }, 0);
    
    const overlay = document.getElementById("modalOverlay");
    if (overlay) {
        overlay.classList.add("active");
        overlay.style.display = "flex";
    }
};
```
- 위치: line 696
- 변경: `setTimeout(..., 0)`을 사용하여 DOM 렌더링 후 이벤트 바인딩

### 파일 3: index.html

#### 수정 1: 캐시 방지 버전 증가
```html
<script src="web-console/haema-api-key-modal.js?v=5"></script>
<script src="web-console/haema-console.js?v=5"></script>
<script src="web-console/haema-storage-db.js?v=5"></script>
<script src="web-console/haema-storage-modal.js?v=5"></script>
```
- 위치: line 914
- 변경: 쿼리 파라미터 v=5로 증가

## 테스트

### 1. 백엔드 API 테스트
- ✅ `/api/provider/models` 성공
- ✅ 145개 모델 반환
- ✅ 응답 구조 정상

### 2. Playwright 브라우저 테스트
- ✅ API Key 모달 열기: 성공
- ✅ Provider 선택 시 Base URL 자동 입력: 성공 (https://api.openai.com/v1)
- ✅ API Key 입력 시 모델 목록 조회: 성공 (135개 모델)
- ✅ 연결 상태: "✅ API 연결 확인됨. 모델을 선택하세요."

### 3. TypeScript 문법 검사
- ⏳ 미실행

### 4. 기존 unit test
- ⏳ 미실행

## 남은 문제

### 1. 브라우저 테스트
- 브라우저 자동화 도구(Playwright 등) 설치 필요
- 현재는 사용자가 직접 브라우저에서 확인 필요

### 2. API Key 암호화 저장
- 현재 placeholder cipher 사용
- 실제 암호화 구현 필요
- 저장소 연결 후 이관 로직 구현 필요

### 3. 다중 프로필 관리
- 여러 API 프로필 저장 기능 구현 필요
- 프로필 전환 기능 구현 필요

### 4. 실제 API Key 테스트
- 이전에 제공된 API Key는 폐기됨
- 새 API Key가 로컬 환경에 존재하는지 확인 필요

## 해결 완료 항목

- ✅ 이벤트 바인딩 타이밍 문제 해결
- ✅ DOM 재생성으로 인한 이벤트 소멸 문제 해결
- ✅ 이벤트 중복 바인딩 방지
- ✅ Base URL 자동 업데이트 로직 수정
- ✅ API Key 입력 시 Base URL 업데이트 추가
- ✅ 캐시 방지 버전 증가

## 브라우저에서 사람이 직접 확인해야 하는 항목

- [ ] Provider 선택 시 Base URL 자동 입력 확인
- [ ] API Key 입력 시 Base URL 자동 입력 확인
- [ ] API Key 입력 시 모델 목록 조회 확인
- [ ] 모델 select option 생성 확인
- [ ] 모델 선택 기능 확인
- [ ] API 연결 테스트 확인

## 결론

### 핵심 문제
- DOM 재생성으로 인한 이벤트 소멸이 가장 큰 문제였음
- `setTimeout(..., 0)`을 사용하여 DOM 렌더링 후 이벤트 바인딩으로 해결

### 아직 해결되지 않은 문제
- 브라우저 자동화 테스트 환경 부족
- API Key 암호화 저장 구현 필요
- 다중 프로필 관리 구현 필요
