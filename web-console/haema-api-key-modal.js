
/**
 * haema-api-key-modal.js
 *
 * =========================================================
 * 역할
 * =========================================================
 * API Key 설정 모달의 UI와 API Key 프로필 관리만 담당한다.
 *
 * 핵심 목적:
 * - 사용자가 테스트용 API Key에 직접 이름을 붙여 저장할 수 있다.
 * - 여러 개의 API Key 프로필을 저장할 수 있다.
 * - 저장된 프로필을 나중에 불러와 편집할 수 있다.
 * - 저장된 프로필 중 하나를 "현재 사용" API Key로 전환할 수 있다.
 * - Provider 선택 후 해당 Provider에서 제공하는 모델 목록을
 *   동적으로 조회하여 선택할 수 있다.
 *
 * 예:
 *
 *   "내 OpenAI 테스트"
 *   "업스테이지 테스트"
 *   "Gemini 개발용"
 *   "회사 API"
 *
 * 같은 사람이 알아보기 쉬운 이름을 붙여 여러 API 설정을 관리한다.
 *
 *
 * =========================================================
 * 파일 경계
 * =========================================================
 * 이 파일은 API Key 설정 모달과 API Key 프로필 관리만 담당한다.
 *
 * 이 파일에서 건드리면 안 되는 것:
 * - 채팅 로직
 * - JJum / 쩜 생성·저장·삭제·회상 로직
 * - 쩜선(Seon) 로직
 * - 감정 분석
 * - Chat Evaluator
 * - 전체 콘솔 렌더링
 * - 기타 Haema 핵심 엔진 로직
 *
 * haema-console.js와는 다음 정도만 연결한다.
 *
 * - 모달 콘텐츠 반환
 * - API Key 저장 완료/실패 상태 전달
 * - 모달 닫기 또는 콘솔 render 요청
 *
 *
 * =========================================================
 * 모달에서 사용자가 입력하는 순서
 * =========================================================
 *
 * 모달 UI의 입력 순서는 반드시 다음 순서를 따른다.
 *
 * 1. 키 이름
 * 2. API 키
 * 3. API 제공자(Provider)
 * 4. Base URL (선택사항)
 * 5. 모델명
 * 6. 저장
 *
 *
 * ---------------------------------------------------------
 * 1. 키 이름
 * ---------------------------------------------------------
 * 사용자가 테스트 편의를 위해 직접 지정하는 이름이다.
 *
 * 예:
 * - "OpenAI 테스트용"
 * - "Solar 테스트"
 * - "Gemini 개인키"
 *
 * DOM ID:
 * - modalApiKeyName
 *
 * 주의:
 * - API Key 자체의 이름이 아니라 사용자가 관리하기 위한 별칭(alias)이다.
 * - 실제 API Key 값과 별도로 저장한다.
 * - 같은 Provider / 같은 API Key라도 사용자가 다른 이름으로 관리할
 *   필요가 있다면 keyId를 기준으로 개별 프로필을 식별한다.
 *
 *
 * ---------------------------------------------------------
 * 2. API 키
 * ---------------------------------------------------------
 * 실제 Provider에서 발급받은 비밀 API Key.
 *
 * DOM ID:
 * - modalApiKey
 *
 * 예:
 * - sk-...
 * - ...
 *
 * UI에서는 password input으로 표시한다.
 *
 *
 * ---------------------------------------------------------
 * 3. API 제공자(Provider)
 * ---------------------------------------------------------
 * 사용할 API 제공자를 선택한다.
 *
 * DOM ID:
 * - modalApiProvider
 *
 * 예:
 * - OpenAI
 * - Anthropic
 * - Google Gemini
 * - Grok
 * - DeepSeek
 * - OpenRouter
 * - LiteLLM
 * - Ollama
 * - AWS Bedrock
 * - OpenAI Compatible
 * - 302.AI
 * - Abacus
 * - Custom
 *
 *
 * ---------------------------------------------------------
 * 4. Base URL
 * ---------------------------------------------------------
 * 선택 입력.
 *
 * DOM ID:
 * - modalApiBaseUrl
 *
 * OpenAI-compatible API 또는 사용자가 직접 지정하는 API 서버에서
 * 사용할 수 있다.
 *
 * 비워둘 수 있다.
 *
 *
 * ---------------------------------------------------------
 * 5. 모델명
 * ---------------------------------------------------------
 * DOM ID:
 * - modalApiModel
 *
 * 모델명은 단순 텍스트 입력이 아니라 선택형 UI를 기본으로 한다.
 *
 * 동작:
 *
 * Provider 선택
 *      ↓
 * 해당 Provider의 모델 목록 조회
 *      ↓
 * 모델 드롭다운 갱신
 *      ↓
 * 사용자가 모델 선택
 *
 * 가능하면:
 * - /api/provider/models
 *   등의 백엔드 엔드포인트를 통해 실제 Provider의 모델 목록을
 *   동적으로 가져온다.
 *
 * 모델 조회에 실패하거나 지원되지 않는 Provider인 경우:
 * - PROVIDER_MODEL_MAP의 고정 모델 목록을 fallback으로 사용한다.
 *
 * 즉, "동적 모델 목록 조회 + 고정 목록 fallback" 구조를 사용한다.
 *
 *
 * =========================================================
 * API Key 프로필 저장 스키마
 * =========================================================
 *
 * 여러 개의 API 설정을 저장하기 위해 다음 구조를 사용한다.
 *
 * localStorage key:
 *
 *   "haema_api_keys"
 *
 * 값:
 *
 *   JSON Array
 *
 * 각 API Key 프로필:
 *
 * {
 *     keyId: "key_1758000000000_ab123",
 *     keyName: "OpenAI 테스트용",
 *     provider: "openai",
 *     model: "gpt-4o",
 *     apiKey: "sk-xxxxxxxx",
 *     baseURL: "",
 *     updatedAt: "2026-09-18T10:00:00.000Z"
 * }
 *
 *
 * 필드 설명
 * ---------------------------------------------------------
 *
 * keyId
 * - 시스템에서 프로필을 식별하기 위한 고유 ID.
 * - 사용자가 입력하는 이름과 다르다.
 * - 편집 / 삭제 / 현재 사용 전환 시 keyId를 기준으로 찾는다.
 *
 * keyName
 * - 사용자가 직접 지정하는 API Key 프로필 이름.
 * - 테스트 편의를 위한 alias.
 * - UI에 표시한다.
 *
 * provider
 * - API 제공자 식별자.
 *
 * model
 * - 선택된 모델 ID.
 *
 * apiKey
 * - 실제 API Key 값.
 *
 * baseURL
 * - 선택 입력.
 * - OpenAI-compatible API 등의 사용자 지정 endpoint.
 *
 * updatedAt
 * - 마지막 저장/수정 시각.
 *
 *
 * =========================================================
 * 현재 사용 중인 API Key
 * =========================================================
 *
 * localStorage:
 *
 *   "haema_current_key_id"
 *
 * 값:
 *
 *   keyId
 *
 * 현재 실제 API 호출에 사용할 프로필은
 * haema_current_key_id가 가리키는 프로필이다.
 *
 * 따라서 여러 API Key를 저장해놓고 필요할 때
 * "사용" 버튼으로 현재 프로필을 교체할 수 있다.
 *
 *
 * =========================================================
 * 기존 단일 API 설정값과의 호환
 * =========================================================
 *
 * 기존 코드에서 사용하고 있는 다음 localStorage 값은
 * 기존 콘솔과의 호환을 위해 유지할 수 있다.
 *
 * - haema_api_key
 * - haema_api_provider
 * - haema_api_model
 * - haema_api_base_url
 *
 * 현재 프로필을 선택하거나 저장할 때 위 값도 함께 갱신한다.
 *
 * 즉:
 *
 *   haema_api_keys
 *          ↓
 *   여러 API Key 프로필 저장소
 *
 *   haema_current_key_id
 *          ↓
 *   현재 선택된 프로필
 *
 *   haema_api_key
 *   haema_api_provider
 *   haema_api_model
 *   haema_api_base_url
 *          ↓
 *   기존 콘솔/기존 API 호출 코드와의 호환용 현재 설정값
 *
 *
 * =========================================================
 * 반드시 지원해야 하는 사용자 흐름
 * =========================================================
 *
 * [새 API Key 저장]
 *
 * 사용자가:
 *
 *   키 이름
 *   API 키
 *   Provider
 *   Base URL
 *   모델
 *
 * 을 입력/선택
 *
 *        ↓
 *
 * [저장]
 *
 *        ↓
 *
 * haema_api_keys 배열에 프로필 저장
 *
 *        ↓
 *
 * haema_current_key_id 갱신
 *
 *        ↓
 *
 * 기존 단일 localStorage 값도 현재 프로필 기준으로 갱신
 *
 *
 * ---------------------------------------------------------
 *
 * [저장된 API Key 사용]
 *
 * 저장된 목록에서
 *
 *   "사용"
 *
 * 버튼 클릭
 *
 *        ↓
 *
 * 해당 keyId를 현재 프로필로 지정
 *
 *        ↓
 *
 * haema_current_key_id 갱신
 *
 *        ↓
 *
 * 기존 단일 API 설정값 갱신
 *
 *
 * ---------------------------------------------------------
 *
 * [저장된 API Key 편집]
 *
 * 저장된 목록에서
 *
 *   "편집"
 *
 * 버튼 클릭
 *
 *        ↓
 *
 * 해당 프로필의
 *
 *   keyName
 *   apiKey
 *   provider
 *   baseURL
 *   model
 *
 * 을 모달에 불러온다.
 *
 *        ↓
 *
 * 사용자가 수정
 *
 *        ↓
 *
 * 기존 keyId를 유지한 채 해당 프로필을 업데이트한다.
 *
 * 새로운 keyId를 생성하지 않는다.
 *
 *
 * ---------------------------------------------------------
 *
 * [저장된 API Key 삭제]
 *
 * 목록에서
 *
 *   "삭제"
 *
 * 버튼 클릭
 *
 *        ↓
 *
 * 해당 keyId 프로필 삭제
 *
 *        ↓
 *
 * 만약 현재 사용 중인 프로필이었다면:
 *
 * - haema_current_key_id 초기화
 * - 기존 단일 API 설정값도 적절히 초기화
 *
 *
 * =========================================================
 * 저장된 API Key 목록 UI
 * =========================================================
 *
 * 저장된 API Key는 최소한 다음 정보를 사용자가 확인할 수 있어야 한다.
 *
 * - keyName
 * - provider
 * - model
 * - 마스킹된 API Key
 *
 * 예:
 *
 *   ● OpenAI 테스트용
 *     OpenAI / gpt-4o
 *     sk-****1234
 *
 *     [사용] [편집] [삭제]
 *
 *
 * 현재 사용 중인 프로필은 UI에서 구분할 수 있어야 한다.
 *
 *
 * =========================================================
 * 보안 관련
 * =========================================================
 *
 * API Key 원문은 화면의 저장 목록에 그대로 표시하지 않는다.
 *
 * 목록에서는 반드시 마스킹한다.
 *
 * 예:
 *
 *   sk-a1b2c3d4...xyz9
 *
 * 또는
 *
 *   sk-****xyz9
 *
 * 단, 현재 테스트 환경에서는 localStorage에 API Key를 저장하는
 * 기존 구조를 유지할 수 있다.
 *
 * 서버 .env 저장이 필요한 경우:
 *
 *   POST /api/config/save
 *
 * 를 사용한다.
 *
 * 프론트엔드에서 직접 파일 시스템에 접근하지 않는다.
 *
 *
 * =========================================================
 * DOM ID 계약
 * =========================================================
 *
 * API Key 모달에서 사용하는 ID는 다음과 같이 고정한다.
 *
 * - modalApiKeyName
 * - modalApiKey
 * - modalApiProvider
 * - modalApiBaseUrl
 * - modalApiModel
 * - savedKeysList
 *
 * 다른 파일에서 이미 사용하는 ID를 임의로 변경하지 않는다.
 *
 *
 * =========================================================
 * haema-console.js와의 연결
 * =========================================================
 *
 * HAEMA_API_KEY_MODAL.setConsole(HAEMA_CONSOLE)
 *
 * 방식으로 콘솔 참조를 전달할 수 있다.
 *
 * 저장/전환/삭제가 완료되면 필요에 따라 콘솔의 상태 텍스트를
 * 갱신하고 render()를 호출할 수 있다.
 *
 * 단, API Key 모달의 실제 데이터 관리와 UI는 이 파일이 담당한다.
 *
 *
 * =========================================================
 * 중요: 기존 핵심 로직 보호
 * =========================================================
 *
 * 이번 작업에서는 API Key 모달 기능을 분리/정리하는 것이 목적이다.
 *
 * 다음 파일 또는 로직을 불필요하게 수정하지 않는다.
 *
 * - JJum 생성
 * - JJum 저장
 * - JJum 삭제
 * - JJum 회상
 * - Seon / 쩜선
 * - Chat Evaluator
 * - 감정 분석
 * - 채팅 UI
 * - 전체 콘솔 렌더링
 *
 * 필요한 경우에도 최소한의 연결 코드만 추가한다.
 *
 *
 * =========================================================
 * 현재 구조의 핵심 요약
 * =========================================================
 *
 * API Key 하나를 단순 문자열로 저장하는 구조가 아니라,
 * "API Key 프로필"을 저장하는 구조로 관리한다.
 *
 *     keyName
 *       +
 *     apiKey
 *       +
 *     provider
 *       +
 *     baseURL
 *       +
 *     model
 *       ↓
 *     하나의 API Key 프로필
 *
 * 여러 프로필:
 *
 *     haema_api_keys[]
 *
 * 현재 사용 프로필:
 *
 *     haema_current_key_id
 *
 * 기존 콘솔 호환:
 *
 *     haema_api_key
 *     haema_api_provider
 *     haema_api_model
 *     haema_api_base_url
 *
 * =========================================================
 */



const HAEMA_API_KEY_MODAL = (() => {
    // =========================================================
    // 1. 제공자별 고정 모델 목록
    // =========================================================
    // 제공자별로 대표 모델 목록을 고정 배열로 관리한다.
    // 추후 확장이 필요하면 이 객체만 수정하면 된다.
    const PROVIDER_MODEL_MAP = {
        openai: [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4-turbo",
            "gpt-4",
            "gpt-3.5-turbo"
        ],
        anthropic: [
            "claude-opus-4-6",
            "claude-opus-4-5",
            "claude-sonnet-4-5",
            "claude-haiku-3-5"
        ],
        google: [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-pro",
            "gemini-1.5-flash"
        ],
        grok: [
            "grok-4",
            "grok-3",
            "grok-3-mini",
            "grok-2"
        ],
        deepseek: [
            "deepseek-r1",
            "deepseek-r1-distill-llama-70b",
            "deepseek-v3",
            "deepseek-coder-v2"
        ],
        openrouter: [
            "openai/gpt-4o",
            "anthropic/claude-opus-4-6",
            "google/gemini-2.5-pro",
            "deepseek/deepseek-r1",
            "meta/llama-4-maverick"
        ],
        litellm: [
            "gpt-4o",
            "claude-opus-4-6",
            "gemini-2.5-pro",
            "llama-4-maverick",
            "custom-model"
        ],
        ollama: [
            "llama3.3",
            "llama3.2",
            "mistral",
            "gemma2",
            "qwen2.5"
        ],
        "aws-bedrock": [
            "anthropic.claude-opus-4-6",
            "anthropic.claude-sonnet-4-5",
            "amazon.nova-pro-v1",
            "meta.llama3-1-405b",
            "google.gemini-2.5-pro"
        ],
        "openai-compatible": [
            "gpt-4o",
            "llama-4-maverick",
            "custom-model"
        ],
        "302ai": [
            "gpt-4o",
            "claude-opus-4-6",
            "gemini-2.5-pro",
            "llama-4-maverick"
        ],
        abacus: [
            "abacus-4",
            "abacus-3",
            "abacus-mini"
        ],
        custom: [
            "직접 입력 모델"
        ]
    };

// =========================================================
// 2. 내부 상태
// =========================================================
// 콘솔 참조는 선택적으로 전달받는다.
// 전달받으면 저장 완료 후 상태 텍스트 갱신이나 모달 닫기 등을 콘솔과 맞출 수 있다.
let consoleRef = null;

// 로컬 서버 저장 엔드포인트
// =========================================================
// 3. 콘솔 참조 연결
// =========================================================
// haema-console.js에서 이 파일을 사용할 때 호출한다.
// 예: HAEMA_API_KEY_MODAL.setConsole(HAEMA_CONSOLE)
function setConsole(consoleObj) {
    if (!consoleObj) {
        consoleRef = null;
        return;
    }
    consoleRef = consoleObj;
}

// =========================================================
// 4. 모델 드롭다운 생성
// =========================================================
// 선택한 제공자에 맞는 모델 옵션을 반환한다.
// provider가 없거나 매핑이 없으면 빈 옵션을 반환한다.
// 현재는 백엔드 /api/provider/models 호출 결과를 우선 사용하고,
// 호출 실패 시 고정 목록(PROVIDER_MODEL_MAP)으로 폴백한다.
async function buildModelOptions(provider, selectedModel) {
    if (!provider) {
        return '<option value="">모델을 선택하세요</option>';
    }

    try {
        const models = await fetchProviderModels(provider);
        if (!models || models.length === 0) {
            return '<option value="">모델을 선택하세요</option>';
        }

        const options = models.map(model => {
            const modelId = model.id != null ? String(model.id) : model.id;
            const sel = modelId === selectedModel ? ' selected' : '';
            return `<option value="${escapeAttr(modelId)}"${sel}>${escapeHtml(model.name || modelId)}</option>`;
        }).join("");

        return `<option value="">모델을 선택하세요</option>${options}`;
    } catch (e) {
        console.warn('[HAEMA_API_KEY_MODAL] 백엔드 모델 목록 조회 실패, 고정 목록으로 폴백합니다.', e);
        return buildModelOptionsFallback(provider, selectedModel);
    }
}

// 백엔드 /api/provider/models 호출
async function fetchProviderModels(provider) {
    const apiKey = document.getElementById("modalApiKey")?.value || "";
    const baseUrl = document.getElementById("modalApiBaseUrl")?.value.trim() || "";

    const res = await fetch("/api/provider/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, baseUrl })
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`모델 목록 조회 실패: ${res.status} ${text}`);
    }

    const data = await res.json();
    if (!data.success) {
        throw new Error(data.error || "모델 목록을 가져올 수 없습니다.");
    }

    return data.models;
}

// 고정 목록 폴백
function buildModelOptionsFallback(provider, selectedModel) {
    const models = HAEMA_API_KEY_MODAL.PROVIDER_MODEL_MAP[provider];
    if (!models || models.length === 0) {
        return '<option value="">모델을 선택하세요</option>';
    }

    const options = models.map(model => {
        const sel = model === selectedModel ? ' selected' : '';
        return `<option value="${escapeAttr(model)}"${sel}>${escapeHtml(model)}</option>`;
    }).join("");

    return `<option value="">모델을 선택하세요</option>${options}`;
}

// =========================================================
// 5. HTML 이스케이프 헬퍼
// =========================================================
// 모달 콘텐츠 생성 시 XSS 방지를 위해 사용한다.
function escapeHtml(text) {
    if (text == null) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(text) {
    if (text == null) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// =========================================================
// 6. API 키 모달 콘텐츠 렌더링
// =========================================================
// haema-console.js의 renderModalContent()에서 API 키 모달일 때
// 이 함수를 호출해 HTML을 받아온다.
//
// 입력
// - data: 모달에 표시할 기존 값 객체
//   - apiKey, provider, model, baseURL
//
// 출력
// - 모달 body에 넣을 HTML 문자열
function renderApiKeyModalContent(data = {}) {
    const savedProvider = data.provider || localStorage.getItem("haema_api_provider") || "";
    const savedModel = data.model || localStorage.getItem("haema_api_model") || "";
    const savedBaseUrl = data.baseURL || localStorage.getItem("haema_api_base_url") || "";
    const savedKey = data.apiKey || localStorage.getItem("haema_api_key") || "";
    const savedName = data.name || "";

    // 제공자 선택
    const providerOptions = [
        { value: "openai", label: "OpenAI" },
        { value: "anthropic", label: "Anthropic" },
        { value: "google", label: "Google Gemini" },
        { value: "grok", label: "Grok" },
        { value: "deepseek", label: "DeepSeek" },
        { value: "openrouter", label: "OpenRouter" },
        { value: "litellm", label: "LiteLLM" },
        { value: "ollama", label: "Ollama" },
        { value: "aws-bedrock", label: "AWS Bedrock" },
        { value: "openai-compatible", label: "OpenAI Compatible" },
        { value: "302ai", label: "302.AI" },
        { value: "abacus", label: "Abacus" },
        { value: "custom", label: "직접 입력 (Custom)" }
    ].map(opt => {
        const sel = opt.value === savedProvider ? ' selected' : '';
        return `<option value="${escapeAttr(opt.value)}"${sel}>${escapeHtml(opt.label)}</option>`;
    }).join("");

    const providerSelect = `
        <div class="form-group">
            <label class="form-label" for="modalApiProvider">API 제공자 (Provider)</label>
            <select class="form-select" id="modalApiProvider">
                <option value="">선택하세요</option>
                ${providerOptions}
            </select>
            <div class="form-hint">사용할 API 제공자를 선택하세요.</div>
        </div>
    `;

    // 키 이름 입력칸
    const apiKeyNameInput = `
        <div class="form-group">
            <label class="form-label" for="modalApiKeyName">키 이름</label>
            <input class="form-input" id="modalApiKeyName" type="text"
                value="${escapeHtml(savedName)}"
                placeholder="예: OpenAI 테스트">
            <div class="form-hint">테스트 편의를 위해 API 설정을 구분할 이름을 입력하세요.</div>
        </div>
    `;

    // API 키 입력칸
    const apiKeyInput = `
        <div class="form-group">
            <label class="form-label" for="modalApiKey">API 키</label>
            <input class="form-input" id="modalApiKey" type="password"
                value="${escapeHtml(savedKey)}"
                placeholder="sk-...">
            <div class="form-hint">실제 API 인증 키를 입력하세요.</div>
        </div>
    `;

    // 모델 드롭다운
    // renderApiKeyModalContent()는 동기 HTML 반환 함수이므로,
    // buildModelOptions()를 여기서 직접 await 하지 않고 select를 비운 뒤
    // bindEvents() / initModelSelect()에서 비동기로 채운다.
    const modelSelect = `
        <div class="form-group" id="modalModelGroup">
            <label class="form-label" for="modalApiModel">모델</label>
            <select class="form-select" id="modalApiModel">
                <option value="">모델을 선택하세요</option>
            </select>
            <div class="form-hint">선택한 제공자에 맞는 모델을 선택하세요.</div>
        </div>
    `;

    // Base URL
    const baseUrlGroup = `
        <div class="form-group" id="modalBaseUrlGroup">
            <label class="form-label" for="modalApiBaseUrl">Base URL (선택사항)</label>
            <input class="form-input" id="modalApiBaseUrl" type="url"
                value="${escapeHtml(savedBaseUrl)}"
                placeholder="https://api.example.com/v1">
            <div class="form-hint">OpenAI 호환 API나 자체 서버의 Base URL입니다.</div>
        </div>
    `;

    // 저장된 키 목록 표시
    const savedKeysList = renderSavedKeysList();

    return `
        ${apiKeyNameInput}
        ${apiKeyInput}
        ${providerSelect}
        ${baseUrlGroup}
        ${modelSelect}
        <div class="form-group">
            <label class="form-label">저장된 API 설정</label>
            <div class="saved-keys-list" id="savedKeysList">
                ${savedKeysList}
            </div>
            <div class="form-hint">저장된 설정을 확인하거나 새로 저장할 수 있습니다.</div>
        </div>
    `;
}

// =========================================================
// 7. 저장된 키 목록 렌더링
// =========================================================
// localStorage에 저장된 키 목록을 보여준다.
// 목록이 없으면 안내 문구를 표시한다.
function renderSavedKeysList() {
    const keys = getSavedKeys();
    if (!keys || keys.length === 0) {
        return '<div class="saved-keys-empty">저장된 API 키가 없습니다.</div>';
    }

    return keys.map((item, index) => {
        const displayProvider = item.provider || "제공자 없음";
        const displayModel = item.model || "모델 없음";
        const maskedKey = maskApiKey(item.apiKey);
        const isSelected = item.keyId === getCurrentKeyId();
        return `
            <div class="saved-key-item ${isSelected ? "selected" : ""}" data-key-id="${escapeAttr(item.keyId)}">
                <div class="saved-key-main">
                    <span class="saved-key-dot"></span>
                    <span class="saved-key-info">
                        <span class="saved-key-name">${escapeHtml(item.name || "이름 없음")}</span>
                        <span class="saved-key-provider">${escapeHtml(displayProvider)}</span>
                        <span class="saved-key-model">${escapeHtml(displayModel)}</span>
                    </span>
                    <span class="saved-key-value">${escapeHtml(maskedKey)}</span>
                </div>
                <div class="saved-key-actions">
                    <button type="button" class="btn btn-small btn-ghost use-key-btn" data-key-id="${escapeAttr(item.keyId)}">사용</button>
                    <button type="button" class="btn btn-small btn-ghost edit-key-btn" data-key-id="${escapeAttr(item.keyId)}">편집</button>
                    <button type="button" class="btn btn-small btn-ghost delete-key-btn" data-key-id="${escapeAttr(item.keyId)}">삭제</button>
                </div>
            </div>
        `;
    }).join("");
}

// =========================================================
// 8. API 키 마스킹
// =========================================================
// 저장된 키를 목록에 표시할 때 전체를 노출하지 않도록 앞/뒤 일부만 보여준다.
function maskApiKey(key) {
    if (!key) return "";
    if (key.length <= 8) return "*".repeat(key.length);
    return key.slice(0, 4) + "****" + key.slice(-4);
}

// =========================================================
// 9. 저장된 키 목록 관리
// =========================================================
// 여러 키를 목록 형태로 저장/불러오기/삭제/전환할 수 있게 한다.
// 저장 형식:
// localStorage "haema_api_keys" = JSON 배열
// 각 항목: { keyId, provider, model, apiKey, baseURL, updatedAt }

function getSavedKeys() {
    try {
        const raw = localStorage.getItem("haema_api_keys");
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch (e) {
        return [];
    }
}

function saveKeysList(keys) {
    try {
        localStorage.setItem("haema_api_keys", JSON.stringify(keys));
    } catch (e) {
        // 저장 실패 시에도 앱은 계속 동작하도록 조용히 넘긴다.
        console.warn("HAEMA_API_KEY_MODAL: 저장된 키 목록 유지에 실패했습니다.", e);
    }
}

function getCurrentKeyId() {
    try {
        return localStorage.getItem("haema_current_key_id") || "";
    } catch (e) {
        return "";
    }
}

function setCurrentKeyId(keyId) {
    try {
        localStorage.setItem("haema_current_key_id", keyId || "");
    } catch (e) {
        console.warn("HAEMA_API_KEY_MODAL: 현재 키 ID 저장에 실패했습니다.", e);
    }
}

// =========================================================
// 10. 단일 키 저장
// =========================================================
// 현재는 모달에서 저장한 키를 다음 두 곳에 남긴다.
// 1) localStorage 단일 키 필드
//    - haema_api_key
//    - haema_api_provider
//    - haema_api_model
//    - haema_api_base_url
// 2) 로컬 서버 .env 저장 요청
//
// 또한 여러 키 목록에도 함께 저장해, 나중에 전환할 수 있게 한다.
let editingKeyId = "";

function saveApiKeyModal() {
    const provider = document.getElementById("modalApiProvider")?.value;
    const model = document.getElementById("modalApiModel")?.value.trim();
    const apiKey = document.getElementById("modalApiKey")?.value;
    const baseURL = document.getElementById("modalApiBaseUrl")?.value.trim();
    const name = document.getElementById("modalApiKeyName")?.value.trim();

    // 입력 검증
    if (!name) {
        alert("키 이름을 입력해주세요!");
        return false;
    }
    if (!provider) {
        alert("API 제공자를 선택해주세요!");
        return false;
    }
    if (!model) {
        alert("모델을 선택해주세요!");
        return false;
    }
    if (!apiKey) {
        alert("API 키를 입력해주세요!");
        return false;
    }

    // 현재 저장 대상 키 객체
    const keyItem = {
        keyId: editingKeyId || ("key_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
        name: name,
        provider: provider,
        model: model,
        apiKey: apiKey,
        baseURL: baseURL || "",
        updatedAt: new Date().toISOString()
    };

    // 1) 단일 키 필드 저장
    localStorage.setItem("haema_api_key", apiKey);
    localStorage.setItem("haema_api_provider", provider);
    localStorage.setItem("haema_api_model", model);
    localStorage.setItem("haema_api_base_url", baseURL || "");

    // 2) 여러 키 목록에도 저장
    const existingKeys = getSavedKeys();
    const existingIndex = existingKeys.findIndex(item => item.keyId === editingKeyId);
    if (existingIndex >= 0) {
        existingKeys[existingIndex] = keyItem;
    } else {
        existingKeys.push(keyItem);
    }
    saveKeysList(existingKeys);
    setCurrentKeyId(keyItem.keyId);

    // 3) 로컬 서버 .env 저장 요청
    // - 프론트가 직접 파일 시스템에 쓸 수 없으므로 서버로 요청을 보낸다.
    // - 서버가 없으면 이 요청은 실패해도 앱 동작에는 영향이 없도록 처리한다.
    saveToLocalServerEnv(keyItem).then(success => {
        if (success) {
            notifySaveResult(true, provider, model);
        } else {
            notifySaveResult(true, provider, model, true);
        }
    }).catch(() => {
        notifySaveResult(true, provider, model, true);
    });

    return true;
}

// =========================================================
// 11. 로컬 서버 .env 저장 요청
// =========================================================
// 저장 대상 경로:
// /Users/heewonjung/Documents/MyPoopAI_UpSol_SherrySherry/HaemaAI_SherrySherry/local-server
//
// 프론트는 이 폴더에 직접 쓸 수 없으므로, 로컬 서버가 제공하는 저장 API를 호출한다.
// 현재는 솔로 테스트용이므로, 서버가 준비되기 전에는 실패해도 무시한다.
async function saveToLocalServerEnv(keyItem) {
    if (!window.fetch) {
        return false;
    }

    try {
        const response = await window.fetch("/api/config/save", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                provider: keyItem.provider,
                model: keyItem.model,
                apiKey: keyItem.apiKey,
                baseUrl: keyItem.baseURL
            })
        });

        if (!response.ok) {
            return false;
        }

        const data = await response.json().catch(() => null);
        if (!data || !data.success) {
            return false;
        }

        return true;
    } catch (e) {
        return false;
    }
}

// =========================================================
// 12. 저장 결과 안내
// =========================================================
// 콘솔 참조가 있으면 상태 텍스트를 갱신하고, 없으면 alert로 안내한다.
function notifySaveResult(success, provider, model, serverSaveOnlyFailed = false) {
    const message = serverSaveOnlyFailed
        ? `✅ API 키 저장 완료: ${provider} / ${model} (로컬 서버 .env 저장은 확인되지 않았습니다)`
        : `✅ API 키 저장 완료: ${provider} / ${model}`;

    if (consoleRef && typeof consoleRef.render === "function") {
        consoleRef.statusText = message;
        consoleRef.render();
    } else {
        alert(message);
    }
}

// =========================================================
// 13. 저장된 키 전환
// =========================================================
// 목록에서 선택한 키로 현재 사용 키를 바꾼다.
function switchToKey(keyId) {
    const keys = getSavedKeys();
    const target = keys.find(item => item.keyId === keyId);
    if (!target) {
        alert("선택한 API 키를 찾을 수 없습니다.");
        return false;
    }

    localStorage.setItem("haema_api_key", target.apiKey);
    localStorage.setItem("haema_api_provider", target.provider);
    localStorage.setItem("haema_api_model", target.model);
    localStorage.setItem("haema_api_base_url", target.baseURL || "");
    setCurrentKeyId(target.keyId);

    if (typeof saveToLocalServerEnv === "function") {
        saveToLocalServerEnv(target).catch(() => {});
    }

    if (consoleRef && typeof consoleRef.render === "function") {
        consoleRef.statusText = `✅ API 키 전환 완료: ${target.provider} / ${target.model}`;
        consoleRef.render();
    } else {
        alert(`✅ API 키 전환 완료: ${target.provider} / ${target.model}`);
    }

    return true;
}

// =========================================================
// 14. 저장된 키 삭제
// =========================================================
// 선택한 키를 목록에서 삭제하고, 현재 사용 중이면 단일 키 필드도 비운다.
function deleteKey(keyId) {
    const keys = getSavedKeys();
    const target = keys.find(item => item.keyId === keyId);
    if (!target) {
        alert("삭제할 API 키를 찾을 수 없습니다.");
        return false;
    }

    const remaining = keys.filter(item => item.keyId !== keyId);
    saveKeysList(remaining);

    const currentKeyId = getCurrentKeyId();
    if (currentKeyId === keyId) {
        localStorage.removeItem("haema_api_key");
        localStorage.removeItem("haema_api_provider");
        localStorage.removeItem("haema_api_model");
        localStorage.removeItem("haema_api_base_url");
        setCurrentKeyId("");
    }

    if (consoleRef && typeof consoleRef.render === "function") {
        consoleRef.statusText = `🗑️ API 키 삭제 완료: ${target.provider} / ${target.model}`;
        consoleRef.render();
    } else {
        alert(`🗑️ API 키 삭제 완료: ${target.provider} / ${target.model}`);
    }

    return true;
}

// =========================================================
// 15. 저장된 키 편집 시작
// =========================================================
// 저장된 프로필의 값을 모달 입력칸에 불러온다.
// 이후 저장하면 같은 keyId를 유지한 채 업데이트된다.
function startEditingKey(keyId) {
    const keys = getSavedKeys();
    const target = keys.find(item => item.keyId === keyId);
    if (!target) {
        alert("편집할 API 키를 찾을 수 없습니다.");
        return;
    }

    document.getElementById("modalApiKeyName").value = target.name || "";
    document.getElementById("modalApiKey").value = target.apiKey || "";
    document.getElementById("modalApiProvider").value = target.provider || "";
    document.getElementById("modalApiBaseUrl").value = target.baseURL || "";
    document.getElementById("modalApiModel").value = target.model || "";

    editingKeyId = target.keyId;

    if (consoleRef && typeof consoleRef.render === "function") {
        consoleRef.statusText = `✏️ API 키 편집 시작: ${target.name || target.keyId}`;
        consoleRef.render();
    } else {
        alert(`✏️ API 키 편집 시작: ${target.name || target.keyId}`);
    }
}

// =========================================================
// 16. 모달 이벤트 바인딩
// =========================================================
// 제공자 선택이 바뀌면 모델 드롭다운을 다시 그린다.
// 저장된 키 목록의 사용/편집/삭제 버튼도 여기서 처리한다.
async function bindEvents() {
    const providerSelect = document.getElementById("modalApiProvider");
    const modelSelect = document.getElementById("modalApiModel");

    if (providerSelect) {
        providerSelect.addEventListener("change", async () => {
            const provider = providerSelect.value;
            const currentModel = modelSelect?.value || "";
            modelSelect.innerHTML = await buildModelOptions(provider, currentModel);
        });
    }

    const savedKeysListEl = document.getElementById("savedKeysList");
    if (savedKeysListEl) {
        savedKeysListEl.addEventListener("click", (e) => {
            const useBtn = e.target.closest(".use-key-btn");
            if (useBtn) {
                const keyId = useBtn.getAttribute("data-key-id");
                if (keyId) switchToKey(keyId);
                return;
            }

            const editBtn = e.target.closest(".edit-key-btn");
            if (editBtn) {
                const keyId = editBtn.getAttribute("data-key-id");
                if (keyId) startEditingKey(keyId);
                return;
            }

            const deleteBtn = e.target.closest(".delete-key-btn");
            if (deleteBtn) {
                const keyId = deleteBtn.getAttribute("data-key-id");
                if (keyId && confirm("이 API 키를 삭제하시겠습니까?")) {
                    deleteKey(keyId);
                }
                return;
            }
        });
    }
}

// =========================================================
// 17. 공개 API
// =========================================================
return {
    setConsole,
    renderApiKeyModalContent,
    saveApiKeyModal,
    switchToKey,
    deleteKey,
    getSavedKeys,
    bindEvents,
    PROVIDER_MODEL_MAP,
    startEditingKey
};
})();

// =========================================================
// 초기화 보조
// =========================================================
// DOM이 준비된 뒤 모달 이벤트가 필요한 경우 사용한다.
// 현재는 haema-console.js와 함께 동작하므로, 콘솔 초기화 흐름에서
// 필요한 시점에 bindEvents()를 호출해도 된다.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        HAEMA_API_KEY_MODAL.bindEvents();
    });
} else {
    HAEMA_API_KEY_MODAL.bindEvents();
}
