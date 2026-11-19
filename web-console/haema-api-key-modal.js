// @editedBy SherrySherry 2026-11-19
// @editedBy SherrySherry 2026-09-24
// @editedBy YAONG1230 2026-10-07
// @editedBy YAONG1230 2026-10-16
// @editedBy SherrySherry 2026-11-17
// User-selected API profiles and model settings.
const HAEMA_API_KEY_MODAL = (() => {
const safeMessages = new WeakMap();
const missingConnections = new WeakSet();
function connectionFailure(error) {
    if (missingConnections.has(error)) return "쩜통 버튼에서 쩜통을 다운로드한 뒤 압축을 풀고 시작 파일을 열어 주세요. 이미 준비했다면 같은 시작 파일을 다시 열어 주세요. 입력한 설정은 그대로 남아 있어요.";
    try {
        const message = globalThis.HAEMA_LOCAL_CONNECTION?.describeFailure?.(error);
        return typeof message === "string" && message ? message : null;
    } catch { return null; }
}
function operationMessage(message, status) {
    const http = Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : "";
    return message + http;
}
function safeError(message, status) {
    const error = new Error("API_CONFIGURATION_OPERATION_FAILED");
    safeMessages.set(error, operationMessage(message, status));
    return error;
}
function safeFailure(error, fallback) { return safeMessages.get(error) || fallback; }
async function notifyConnectionFailure(error) {
    const message = connectionFailure(error);
    if (!message) return false;
    if (consoleRef) consoleRef.statusText = "⚠️ " + message;
    const connection = globalThis.HAEMA_LOCAL_CONNECTION;
    const state = connection?.status?.();
    const openDownload = (!connection || state?.connection === 'setup-required' && !state.remembered)
        && globalThis.HAEMA_STORAGE_MODAL?.open;
    const reconnect = openDownload || globalThis.HAEMA_RECONNECT_LOCAL;
    await HAEMA_DIALOG.alert(message, { title: '실행 프로그램 연결을 확인해 주세요', tone: 'warning',
        ...(typeof reconnect === 'function' ? { confirmText: openDownload ? '쩜통 다운로드' : '다시 연결', onConfirm: reconnect } : {}) });
    return true;
}
function requestLocal(operation, input = {}) {
    const connection = globalThis.HAEMA_LOCAL_CONNECTION;
    if (!connection || typeof connection.request !== "function") {
        const error = new Error("CONNECTION_REQUIRED");
        missingConnections.add(error);
        throw error;
    }
    return connection.request(operation, input);
}
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

    const PROVIDER_BASE_URLS = {
        openai: "https://api.openai.com/v1",
        anthropic: "https://api.anthropic.com",
        google: "https://generativelanguage.googleapis.com",
        grok: "https://api.x.ai/v1",
        deepseek: "https://api.deepseek.com",
        openrouter: "https://openrouter.ai/api/v1",
        ollama: "http://127.0.0.1:11434/v1",
        lmstudio: "http://127.0.0.1:1234/v1",
        "openai-compatible": "https://api.openai.com/v1"
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
// 유틸리티 함수
// =========================================================
function getDefaultBaseUrl(provider) {
    return PROVIDER_BASE_URLS[provider] || "";
}

// Providers append paths such as /models or /chat/completions to this base.
function safeBaseUrl(value) {
    if (!value) return '';
    if (typeof value !== 'string' || /[?#\\\u0000-\u001f\u007f]/.test(value)) return null;
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? value : null;
    } catch { return null; }
}
const baseUrlNotice = 'Base URL에는 http(s) 주소와 경로만 입력해 주세요. 인증 키는 API 키 입력칸에 넣어 주세요.';

function isLocalProvider(provider) {
    return provider === "ollama" || provider === "lmstudio";
}

function isSetupOnlyRuntime() {
    const state = globalThis.HAEMA_LOCAL_CONNECTION?.status?.();
    return state?.connection === "connected" && state.runtimeMode === "setup-only";
}

// =========================================================
// 4. 모델 드롭다운 생성
// =========================================================
// 선택한 제공자에 맞는 모델 옵션을 반환한다.
// provider가 없거나 매핑이 없으면 빈 옵션을 반환한다.
// 로컬 제공자는 서버가 실제로 반환한 모델만 표시한다.
// 기존 클라우드 제공자의 고정 목록은 연결 전/실패 안내에만 사용한다.
async function buildModelOptions(provider, selectedModel, credentials) {
    if (!provider) {
        return '<option value="">모델을 선택하세요</option>';
    }

    try {
        const models = await fetchProviderModels(provider, credentials);
        if (!models || models.length === 0) {
            return '<option value="">모델을 선택하세요</option>';
        }

        const modelIds = new Set(models.map(model => model.id == null ? "" : String(model.id)));
        const options = models.map(model => {
            const modelId = model.id == null ? "" : String(model.id);
            const sel = modelId === selectedModel ? ' selected' : '';
            return `<option value="${escapeAttr(modelId)}"${sel}>${escapeHtml(model.name || modelId)}</option>`;
        }).join("");
        const preservedOption = !isLocalProvider(provider) && selectedModel && !modelIds.has(String(selectedModel))
            ? `<option value="${escapeAttr(selectedModel)}" selected>${escapeHtml(selectedModel)}</option>`
            : "";

        return `<option value="">모델을 선택하세요</option>${preservedOption}${options}`;
    } catch (e) {
        throw e;
    }
}

// 선택한 제공자의 모델 목록을 확인한다.
async function fetchProviderModels(provider, credentials = {}) {
    const apiKey = credentials.apiKey ?? document.getElementById("modalApiKey")?.value ?? "";
    const baseUrl = credentials.baseUrl ?? document.getElementById("modalApiBaseUrl")?.value.trim() ?? "";

    if (safeBaseUrl(baseUrl) === null) throw safeError(baseUrlNotice);
    const res = await requestLocal("models.list", { provider, apiKey, baseUrl });

    if (!res.ok) {
        throw safeError("모델 목록 요청을 완료하지 못했어요.", res.status);
    }

    const data = await res.json();
    if (!data.success) {
        throw safeError("모델 목록을 가져올 수 없어요.", res.status);
    }

    if (!Array.isArray(data.models)) throw safeError("모델 목록 응답을 확인할 수 없어요.", res.status);
    return data.models;
}

// 고정 목록 폴백
function buildModelOptionsFallback(provider, selectedModel) {
    if (isLocalProvider(provider)) return '<option value="">모델을 선택하세요</option>';
    const models = HAEMA_API_KEY_MODAL.PROVIDER_MODEL_MAP[provider];
    if (!models || models.length === 0) {
        return '<option value="">모델을 선택하세요</option>';
    }

    const options = models.map(model => {
        const sel = model === selectedModel ? ' selected' : '';
        return `<option value="${escapeAttr(model)}"${sel}>${escapeHtml(model)}</option>`;
    }).join("");
    const preservedOption = selectedModel && !models.includes(selectedModel)
        ? `<option value="${escapeAttr(selectedModel)}" selected>${escapeHtml(selectedModel)}</option>`
        : "";

    return `<option value="">모델을 선택하세요</option>${preservedOption}${options}`;
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
    // The edit identity belongs to this form, not a previously closed modal.
    editingKeyId = data.keyId || "";
    const savedProvider = data.provider || localStorage.getItem("haema_api_provider") || "";
    const savedModel = data.model || localStorage.getItem("haema_api_model") || "";
    const savedBaseUrl = safeBaseUrl(data.baseURL ?? localStorage.getItem("haema_api_base_url")) || "";
    const displayedBaseUrl = savedBaseUrl || (isLocalProvider(savedProvider) ? getDefaultBaseUrl(savedProvider) : "");
    const savedKey = data.apiKey || "";
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
        { value: "lmstudio", label: "LM Studio" },
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
            <label class="form-label" for="modalApiKeyName">설정 이름</label>
            <input class="form-input" id="modalApiKeyName" type="text"
                value="${escapeHtml(savedName)}"
                placeholder="예: OpenAI 테스트">
            <div class="form-hint">테스트 편의를 위해 API 설정을 구분할 이름을 입력하세요.</div>
        </div>
    `;

    // API 키 입력칸
    const apiKeyInput = `
        <div class="form-group">
            <label class="form-label" id="modalApiKeyLabel" for="modalApiKey">${isLocalProvider(savedProvider) ? "API 키 (선택사항)" : "API 키"}</label>
            <input class="form-input" id="modalApiKey" type="password" autocomplete="off"
                value="${escapeHtml(savedKey)}"
                placeholder="sk-...">
            <div class="form-hint" id="modalApiKeyHint">${isLocalProvider(savedProvider) ? "인증을 설정한 로컬 서버에서만 키를 입력하세요." : "키는 연결된 내 컴퓨터의 실행 프로그램에 저장해요."}</div>
        </div>
    `;

    // 모델 드롭다운
    // renderApiKeyModalContent()는 동기 HTML 반환 함수이므로,
    // buildModelOptions()를 여기서 직접 await 하지 않고 select를 비운 뒤
    // bindEvents() / initModelSelect()에서 비동기로 채운다.
    const modelControl = isSetupOnlyRuntime() ? `
            <input class="form-input" id="modalApiModel" type="text" list="modalModelSuggestions"
                value="${escapeAttr(savedModel)}" placeholder="모델 ID 입력" autocomplete="off">
            <datalist id="modalModelSuggestions"></datalist>
            <div class="form-hint">사용할 모델 ID를 입력하세요. 설정 전용 모드에서는 이 컴퓨터에 설정을 저장하고 모델 연결 확인은 전체 실행 모드에서 진행해요.</div>` : `
            <select class="form-select" id="modalApiModel" data-selected-model="${escapeAttr(savedModel)}">
                <option value="">모델을 선택하세요</option>
            </select>
            <div class="form-hint">선택한 제공자에 맞는 모델을 선택하세요.</div>
            <button class="btn btn-small btn-ghost" type="button" id="modalRefreshModels">모델 다시 조회</button>`;
    const modelSelect = `
        <div class="form-group" id="modalModelGroup">
            <label class="form-label" for="modalApiModel">모델</label>
            ${modelControl}
            <div class="form-hint" id="modalApiConnectionStatus" role="status"></div>
        </div>
    `;

    // Base URL
    const baseUrlGroup = `
        <div class="form-group" id="modalBaseUrlGroup">
            <label class="form-label" for="modalApiBaseUrl">Base URL (선택사항)</label>
            <input class="form-input" id="modalApiBaseUrl" type="url"
                value="${escapeHtml(displayedBaseUrl)}"
                placeholder="https://api.example.com/v1">
            <div class="form-hint">OpenAI 호환 API나 자체 서버의 Base URL입니다.</div>
        </div>
    `;

    return `
        ${apiKeyNameInput}
        ${providerSelect}
        ${baseUrlGroup}
        ${apiKeyInput}
        ${modelSelect}
        <div class="form-group">
            <label class="form-label">저장된 연결 설정</label>
            <div class="saved-keys-list" id="savedKeysList">
                <div class="saved-keys-empty">로딩 중...</div>
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
async function renderSavedKeysList() {
    const keys = await getSavedKeys();
    if (!keys || keys.length === 0) {
        return '<div class="saved-keys-empty">저장된 연결 설정이 없습니다.</div>';
    }

    return keys.map(item => {
        const displayProvider = item.provider || "제공자 없음";
        const displayModel = item.model || "모델 없음";
        const state = savedProfileState(item);
        const maskedKey = state === "active" ? "이 쩜통에 키가 저장돼 있어요" : state === "matching" ? "현재 서버 설정과 일치" :
            item.requiresKey ? "사용 시 키 입력" : maskApiKey(item.apiKey) || (isLocalProvider(item.provider) ? "키 없이 연결" : "");
        const isSelected = state === "active" || (!item.requiresKey && item.keyId === getCurrentKeyId());
        const useLabel = state === "active" ? "사용 중" : state === "matching" ? "현재 설정 유지" : "사용";
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
                    <button type="button" class="btn btn-small btn-ghost use-key-btn" data-key-id="${escapeAttr(item.keyId)}">${useLabel}</button>
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
// 암호화된 ConsoleConfigStore를 사용한다.

// New browser profiles store only display/connection metadata. Previously saved
// profiles remain readable with their original key until explicitly edited.
const profilesKey = 'haema_api_profile_metadata_v1';
function readProfileMetadata() {
    const parsed = JSON.parse(localStorage.getItem(profilesKey) ?? '[]');
    if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.keyId !== 'string' ||
        typeof item.provider !== 'string' || typeof item.model !== 'string' || typeof item.requiresKey !== 'boolean' ||
        (item.metadataOnly !== undefined && typeof item.metadataOnly !== 'boolean'))) {
        throw safeError('저장된 연결 설정 목록을 읽지 못했어요.');
    }
    return parsed;
}
async function getSavedKeys() {
    const profiles = new Map((await getLegacyKeys()).map(item => [item.keyId, item]));
    for (const item of readProfileMetadata()) profiles.set(item.keyId, item);
    return [...profiles.values()];
}
async function getLegacyKeys() {
    const encrypted = localStorage.getItem('haema.console.config.v1');
    let current;
    if (encrypted) {
        try { current = (await loadEncryptedConfig(encrypted)).config.sets; }
        catch { return []; }
    }
    let previous = [];
    try { previous = readPlainProfiles(localStorage.getItem('haema_api_keys')); }
    catch { /* Encrypted profiles are independent of the older list. */ }
    return [...new Map([...previous, ...(current || [])].map(item => [item.keyId, item])).values()];
}
function readPlainProfiles(raw) {
    if (!raw) return [];
    const profiles = JSON.parse(raw);
    if (!Array.isArray(profiles) || profiles.some(item => !item || typeof item.keyId !== 'string')) {
        throw safeError('기존 API 프로필 목록을 확인하지 못했어요.');
    }
    return profiles;
}

async function loadEncryptedConfig(raw = localStorage.getItem('haema.console.config.v1')) {
    if (typeof ConsoleConfigStore === "undefined" || typeof WebCryptoCipher === "undefined") {
        throw safeError("암호화된 API 설정 저장소를 사용할 수 없습니다.");
    }

    const cipher = new WebCryptoCipher();
    await cipher.generateSessionKey();
    try {
        const config = raw ? await cipher.decrypt(JSON.parse(raw)) : { sets: [], apiKeySet: null };
        if (!Array.isArray(config?.sets)) throw new Error();
        return { cipher, config };
    } catch {
        throw safeError('기존 API 프로필을 읽을 수 없어요. 해당 프로필을 저장한 탭에서 다시 시도해 주세요.');
    }
}

function persistProfileMetadata(keyItem, isNew, scope) {
    const { keyId, name, provider, model, baseURL, updatedAt } = keyItem;
    const profiles = readProfileMetadata();
    const previous = profiles.find(item => item.keyId === keyId);
    const metadataOnly = isNew || previous?.metadataOnly === true ||
        (!localStorage.getItem('haema.console.config.v1') && !localStorage.getItem('haema_api_keys'));
    const next = profiles.filter(item => item.keyId !== keyId);
    next.push({ keyId, name, provider, model, baseURL, updatedAt, requiresKey: !!keyItem.apiKey, metadataOnly, ...(scope && { scope }) });
    localStorage.setItem(profilesKey, JSON.stringify(next));
}

function currentStorageScope() {
    if (!consoleRef?.isStorageReady?.() || consoleRef.storageStatusUnconfirmed) return null;
    const scope = consoleRef.getConversationScope?.();
    if (!scope?.ownerId || !scope.storageRoot || !scope.storageId) return null;
    return { ownerId: scope.ownerId, storageRoot: scope.storageRoot, storageId: scope.storageId };
}

function sameStorageScope(left, right) {
    return !!left && !!right && left.ownerId === right.ownerId &&
        left.storageId === right.storageId && left.storageRoot === right.storageRoot;
}

function checkProfileActionScope(scope) {
    if (scope && !sameStorageScope(scope, currentStorageScope())) {
        throw safeError("쩜통 연결이 바뀌었어요. 현재 쩜통의 설정을 확인한 뒤 다시 시도해 주세요.");
    }
}

function sameConnection(left, right) {
    if (!left || !right || !left.provider || !left.model || left.provider !== right.provider || left.model !== right.model) return false;
    const base = value => safeBaseUrl(value || getDefaultBaseUrl(left.provider));
    return base(left.baseURL) !== null && base(left.baseURL) === base(right.baseURL);
}

function confirmedProfile() {
    const profile = consoleRef?.confirmedApiProfile;
    return consoleRef?.apiConfigured && !consoleRef.apiStatusUnconfirmed && sameStorageScope(profile?.scope, currentStorageScope())
        ? profile : null;
}

// Older rows have no store identity. They can keep the server's current settings,
// but matching a provider and model cannot establish which credential was used.
function savedProfileState(item) {
    const profile = confirmedProfile();
    if (!item?.requiresKey || !item.keyId || item.keyId !== getCurrentKeyId() || !sameConnection(item, profile)) return "";
    if (item.scope === undefined) return "matching";
    return sameStorageScope(item.scope, profile.scope) ? "active" : "";
}

function keepServerSettings(item) {
    if (consoleRef) consoleRef.statusText = `현재 쩜통의 ${item.provider} / ${item.model} 설정을 그대로 사용해요.`;
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
        console.warn("HAEMA_API_KEY_MODAL: 현재 키 ID 저장에 실패했습니다.");
    }
}

function setActiveKeyMetadata(keyItem) {
    localStorage.setItem("haema_api_provider", keyItem.provider || "");
    localStorage.setItem("haema_api_model", keyItem.model || "");
    localStorage.setItem("haema_api_base_url", safeBaseUrl(keyItem.baseURL) || "");
    setCurrentKeyId(keyItem.keyId || "");
}

function clearActiveKeyMetadata() {
    localStorage.removeItem("haema_api_key");
    localStorage.removeItem("haema_api_provider");
    localStorage.removeItem("haema_api_model");
    localStorage.removeItem("haema_api_base_url");
    localStorage.setItem("haema_api_configured", "false");
    setCurrentKeyId("");
}

// =========================================================
// 10. 단일 키 저장
// =========================================================
// 후보 프로필의 암호화를 먼저 확인하고 서버 수락 뒤 프로필과 활성 메타데이터를 저장한다.
// 서버 저장 실패 시 같은 폼의 프로필 ID를 유지해 수동 재시도할 수 있다.
let editingKeyId = "";
let profileActionBusy = false;

function setProfileActionBusy(busy) {
    profileActionBusy = busy;
    document.querySelectorAll('#modalBody input, #modalBody select, #modalBody .saved-key-actions button, #modalRefreshModels, #modalSave')
        .forEach(control => { control.disabled = busy; });
}

async function saveApiKeyModal() {
    if (profileActionBusy) return false;
    const provider = document.getElementById("modalApiProvider")?.value;
    const model = document.getElementById("modalApiModel")?.value.trim();
    const apiKey = document.getElementById("modalApiKey")?.value.trim();
    const baseURL = document.getElementById("modalApiBaseUrl")?.value.trim();
    const name = document.getElementById("modalApiKeyName")?.value.trim();
    const setupOnly = isSetupOnlyRuntime();
    const formData = consoleRef?.modalData;
    const targetKeyId = editingKeyId;
    const targetScope = currentStorageScope();

    // 입력 검증
    if (safeBaseUrl(baseURL) === null) {
        await HAEMA_DIALOG.alert(baseUrlNotice, { tone: 'warning' });
        return false;
    }
    if (!name) {
        await HAEMA_DIALOG.alert("설정 이름을 입력해주세요!", { tone: 'warning' });
        return false;
    }
    if (!provider) {
        await HAEMA_DIALOG.alert("API 제공자를 선택해주세요!", { tone: 'warning' });
        return false;
    }
    if (!model) {
        await HAEMA_DIALOG.alert(setupOnly ? "모델 ID를 입력해 주세요." : "모델을 선택해주세요!", { tone: 'warning' });
        return false;
    }
    if (!apiKey && targetKeyId) {
        try {
            const target = readProfileMetadata().find(item => item.keyId === targetKeyId);
            if (savedProfileState(target) && target.name === name && sameConnection(target, { provider, model, baseURL })) {
                keepServerSettings(target);
                return true;
            }
        } catch (error) {
            await HAEMA_DIALOG.alert(safeFailure(error, "저장된 연결 설정을 확인하지 못했어요."), { tone: 'warning' });
            return false;
        }
    }
    if ((!isLocalProvider(provider) || (consoleRef?.modalData?.requiresKey && consoleRef.modalData.provider === provider)) && !apiKey) {
        await HAEMA_DIALOG.alert("API 키를 입력해주세요!", { tone: 'warning' });
        return false;
    }

    const modalSaveButton = document.getElementById("modalSave");
    if (modalSaveButton?.disabled) return false;
    setProfileActionBusy(true);
    let serverSaved = false;

    try {
        if (!setupOnly) {
            const validation = await validateProviderConnection(provider, apiKey, baseURL, model);
            if (!validation.ok) {
                await notifySaveResult(false, provider, model, false, validation.message);
                return false;
            }
        }

        const keyItem = {
            keyId: targetKeyId || ("key_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
            name,
            provider,
            model,
            apiKey,
            baseURL: baseURL || "",
            updatedAt: new Date().toISOString()
        };

        // An unreadable profile list must never be replaced by a partial copy.
        readProfileMetadata();
        // Retrying this draft reuses its profile instead of appending a duplicate.
        if (!consoleRef || consoleRef.modalData === formData) {
            editingKeyId = keyItem.keyId;
            if (formData) formData.keyId = keyItem.keyId;
        }
        checkProfileActionScope(targetScope);
        serverSaved = await saveConnectionSettings(keyItem);
        checkProfileActionScope(targetScope);
        if (!serverSaved) {
            await notifySaveResult(false, provider, model, false, "로컬 서버에 API 설정을 저장하지 못했습니다.");
            return false;
        }

        persistProfileMetadata(keyItem, !targetKeyId, targetScope);
        setActiveKeyMetadata(keyItem);
        localStorage.setItem("haema_api_configured", "true");

        if (consoleRef) {
            consoleRef.apiConfigured = true;
            if (consoleRef.modalData === formData) consoleRef.modalData = {
                keyId: keyItem.keyId,
                provider,
                model,
                baseURL: baseURL || "",
                name,
                apiKey: ""
            };
        }

        await notifySaveResult(true, provider, model, setupOnly);
        return true;
    } catch (error) {
        if (await notifyConnectionFailure(error)) return false;
        if (serverSaved) {
            const message = safeFailure(error, "연결 설정은 서버에 적용했지만 브라우저에 프로필을 저장하지 못했어요. 입력한 설정은 그대로 두었으니 저장 공간을 확인하고 다시 저장해주세요.");
            if (consoleRef) {
                if (!targetScope || sameStorageScope(targetScope, currentStorageScope())) consoleRef.apiConfigured = true;
                consoleRef.statusText = message;
            }
            await HAEMA_DIALOG.alert(message, { title: '서버 연결 설정은 적용했어요', tone: 'warning' });
            return false;
        }
        await notifySaveResult(false, provider, model, false, safeFailure(error, "API 설정을 저장하지 못했어요. 입력한 설정을 유지한 채 다시 확인해 주세요."));
        return false;
    } finally {
        setProfileActionBusy(false);
    }
}

async function validateProviderConnection(provider, apiKey, baseUrl, model) {
    const response = await requestLocal("models.list", { provider, apiKey, baseUrl });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success !== true || !Array.isArray(payload.models)) {
        return {
            ok: false,
            message: operationMessage("모델 목록 요청을 완료하지 못했어요.", response.status)
        };
    }
    if (isLocalProvider(provider) && (!Array.isArray(payload.models) || !payload.models.some(item => item && String(item.id) === model))) {
        return { ok: false, message: "선택한 모델을 로컬 서버에서 찾지 못했습니다. 모델 목록을 다시 확인해주세요." };
    }
    return { ok: true };
}

// =========================================================
// 11. 연결 설정 저장
// =========================================================
// 명시적인 성공 응답을 받은 뒤 선택한 프로필을 반영한다.
async function saveConnectionSettings(keyItem) {
    const response = await requestLocal("settings.save", {
        provider: keyItem.provider,
        model: keyItem.model,
        apiKey: keyItem.apiKey,
        baseUrl: keyItem.baseURL
    });

    if (!response.ok) {
        throw safeError("실행 프로그램에 API 설정을 저장하지 못했어요.", response.status);
    }

    const data = await response.json().catch(() => null);
    if (data?.success !== true) {
        throw safeError("API 설정 저장 완료를 확인할 수 없어요.", response.status);
    }

    return true;
}

// =========================================================
// 12. 저장 결과 안내
// =========================================================
// 상태 텍스트를 유지하고, 연결 실패는 캐릭터 알림으로도 안내한다.
function savedSettingsMessage(provider, model, setupOnly) {
    return setupOnly ? `✅ 이 컴퓨터에 연결 설정을 저장했어요. ${provider} / ${model}의 모델 연결은 아직 확인하지 않았어요.`
        : `✅ 연결 설정 저장 완료: ${provider} / ${model}`;
}
async function notifySaveResult(success, provider, model, setupOnly = false, errorMessage = "") {
    const message = !success
        ? `❌ API 연결 실패: ${errorMessage || "제공자와 Base URL, 필요한 경우 키를 확인해주세요."}`
        : savedSettingsMessage(provider, model, setupOnly);

    if (consoleRef && typeof consoleRef.render === "function") {
        consoleRef.statusText = message;
    } else if (success) {
        await HAEMA_DIALOG.alert(message, { title: '연결 설정을 저장했어요', tone: 'info' });
    }
    if (!success) await HAEMA_DIALOG.alert(message, { title: 'API 연결을 확인해주세요', tone: 'error' });
}

async function refreshConsoleAfterProfileAction(message) {
    if (!consoleRef) {
        await HAEMA_DIALOG.alert(message, { tone: 'info' });
        return;
    }

    const list = document.getElementById("savedKeysList");
    consoleRef.statusText = message;
    if (typeof consoleRef.refreshApiStatus === "function") {
        await consoleRef.refreshApiStatus();
    } else if (typeof consoleRef.render === "function") {
        consoleRef.render();
    }
    if (list && list === document.getElementById("savedKeysList")) await updateSavedList(list);
}

async function clearLocalServerConfig() {
    const response = await requestLocal("settings.clear");
    const payload = await response.json().catch(() => null);
    return response.ok && payload?.success === true;
}

// =========================================================
// 13. 저장된 키 전환
// =========================================================
// 목록에서 선택한 키로 현재 사용 키를 바꾼다.
async function switchToKey(keyId) {
    if (profileActionBusy) return false;
    setProfileActionBusy(true);
    const targetScope = currentStorageScope();
    try {
        const keys = await getSavedKeys();
        checkProfileActionScope(targetScope);
        const target = keys.find(item => item.keyId === keyId);
        if (!target) {
            await refreshConsoleAfterProfileAction("선택한 API 키를 찾을 수 없습니다.");
            return false;
        }

        if (safeBaseUrl(target.baseURL) === null) {
            await HAEMA_DIALOG.alert(baseUrlNotice, { tone: 'warning' });
            return false;
        }
        if (savedProfileState(target)) {
            keepServerSettings(target);
            if (typeof consoleRef?.render === "function") consoleRef.render();
            return true;
        }
        if (target.requiresKey && !target.apiKey) {
            showProfileForm(target);
            if (consoleRef) consoleRef.statusText = '이 설정을 적용하려면 API 키를 입력한 뒤 저장해 주세요.';
            document.getElementById('modalApiKey')?.focus?.();
            return false;
        }
        const setupOnly = isSetupOnlyRuntime();
        if (!setupOnly && isLocalProvider(target.provider)) {
            const validation = await validateProviderConnection(target.provider, target.apiKey || "", target.baseURL || "", target.model);
            if (!validation.ok) {
                await notifySaveResult(false, target.provider, target.model, false, validation.message);
                return false;
            }
        }
        checkProfileActionScope(targetScope);
        if (!await saveConnectionSettings(target)) {
            await refreshConsoleAfterProfileAction("API 키 전환에 실패했습니다. 로컬 서버 설정을 저장하지 못했습니다.");
            return false;
        }

        checkProfileActionScope(targetScope);
        setActiveKeyMetadata(target);
        localStorage.setItem("haema_api_configured", "true");
        if (consoleRef) {
            consoleRef.apiConfigured = true;
            consoleRef.modalData = {
                keyId: target.keyId,
                provider: target.provider,
                model: target.model,
                baseURL: target.baseURL || "",
                name: target.name || target.keyName || "",
                apiKey: ""
            };
        }
        await refreshConsoleAfterProfileAction(setupOnly ? savedSettingsMessage(target.provider, target.model, true)
            : `✅ 연결 설정 전환 완료: ${target.provider} / ${target.model}`);
        return true;
    } catch (error) {
        if (await notifyConnectionFailure(error)) return false;
        await refreshConsoleAfterProfileAction(safeFailure(error, "연결 설정 전환에 실패했어요."));
        return false;
    } finally {
        setProfileActionBusy(false);
    }
}

// =========================================================
// 14. 저장된 키 삭제
// =========================================================
// 선택한 키를 목록에서 삭제하고, 현재 사용 중이면 단일 키 필드도 비운다.
async function deleteKey(keyId) {
    if (profileActionBusy) return false;
    setProfileActionBusy(true);
    let serverConfigCleared = false;
    let selectedScope;
    function forgetClearedSettings() {
        if (selectedScope && !sameStorageScope(selectedScope, currentStorageScope())) return;
        if (getCurrentKeyId() && getCurrentKeyId() !== keyId) return;
        clearActiveKeyMetadata();
        if (consoleRef) {
            consoleRef.apiConfigured = false;
            consoleRef.modalData = { apiKey: "", provider: "", model: "", baseURL: "", name: "" };
        }
    }
    try {
        const metadata = readProfileMetadata().find(item => item.keyId === keyId);
        const legacyKey = 'haema.console.config.v1';
        const raw = metadata?.metadataOnly === true ? null : localStorage.getItem(legacyKey);
        const legacy = raw ? await loadEncryptedConfig(raw) : null;
        const plainRaw = metadata?.metadataOnly === true ? null : localStorage.getItem('haema_api_keys');
        const plain = readPlainProfiles(plainRaw);
        const plainTarget = plain.find(item => item?.keyId === keyId);
        const legacyTarget = legacy?.config.sets.find(item => item?.keyId === keyId);
        const target = metadata || legacyTarget || plainTarget;
        if (!target) {
            await refreshConsoleAfterProfileAction("삭제할 API 키를 찾을 수 없습니다.");
            return false;
        }
        const activeLegacy = legacy?.config.apiKeySet?.keyId === keyId;
        let nextEncrypted;
        if (legacyTarget || activeLegacy) {
            const next = { ...legacy.config, sets: legacy.config.sets.filter(item => item?.keyId !== keyId) };
            if (activeLegacy) next.apiKeySet = null;
            nextEncrypted = JSON.stringify(await legacy.cipher.encrypt(next));
        }
        function verifyProfileSnapshot() {
            const current = readProfileMetadata().find(item => item.keyId === keyId);
            if (JSON.stringify(current) !== JSON.stringify(metadata) || (metadata?.metadataOnly !== true &&
                (localStorage.getItem(legacyKey) !== raw || localStorage.getItem('haema_api_keys') !== plainRaw))) {
                throw safeError('다른 탭에서 API 프로필이 변경됐어요. 목록을 확인한 뒤 다시 시도해 주세요.');
            }
        }
        verifyProfileSnapshot();
        const currentId = getCurrentKeyId();
        const selected = currentId === keyId || !currentId && activeLegacy;
        selectedScope = metadata?.scope;
        if (selected && selectedScope && (!sameStorageScope(selectedScope, currentStorageScope()) ||
            consoleRef.apiStatusUnconfirmed || (consoleRef.apiConfigured && !confirmedProfile()))) {
            throw safeError("이 프로필을 저장한 쩜통을 연결하고 설정 상태를 확인한 뒤 삭제해 주세요.");
        }
        const deletingActiveKey = selected && (!selectedScope || sameConnection(target, confirmedProfile()));
        if (deletingActiveKey && !await clearLocalServerConfig()) {
            await refreshConsoleAfterProfileAction("활성 API 설정을 서버에서 지우지 못해 프로필을 삭제하지 않았습니다.");
            return false;
        }
        serverConfigCleared = deletingActiveKey;
        verifyProfileSnapshot();
        if (nextEncrypted) localStorage.setItem(legacyKey, nextEncrypted);
        if (plainTarget) localStorage.setItem('haema_api_keys', JSON.stringify(plain.filter(item => item?.keyId !== keyId)));
        if (metadata) {
            localStorage.setItem(profilesKey, JSON.stringify(readProfileMetadata().filter(item => item.keyId !== keyId)));
        }
        if (deletingActiveKey) forgetClearedSettings();
        else if (selected && getCurrentKeyId() === keyId) setCurrentKeyId("");

        const message = deletingActiveKey ? "API 키 삭제 완료" : "브라우저 프로필 삭제 완료";
        await refreshConsoleAfterProfileAction(`🗑️ ${message}: ${target.provider} / ${target.model}`);
        return true;
    } catch (error) {
        if (serverConfigCleared) forgetClearedSettings();
        if (await notifyConnectionFailure(error)) return false;
        await refreshConsoleAfterProfileAction(safeFailure(error, "API 설정 삭제에 실패했어요."));
        return false;
    } finally {
        setProfileActionBusy(false);
    }
}

// =========================================================
// 15. 저장된 키 편집 시작
// =========================================================
// 저장된 프로필의 값을 모달 입력칸에 불러온다.
// 이후 저장하면 같은 keyId를 유지한 채 업데이트된다.
function showProfileForm(target) {
    editingKeyId = target.keyId;
    const name = target.name || target.keyName || "";
    const baseURL = safeBaseUrl(target.baseURL);
    const existingKey = baseURL === null ? "" : target.apiKey || "";
    if (consoleRef && typeof consoleRef.render === "function") {
        consoleRef.modalMode = "apiKey";
        consoleRef.modalData = {
            keyId: target.keyId,
            requiresKey: target.requiresKey === true,
            name,
            apiKey: existingKey,
            provider: target.provider || "",
            baseURL: baseURL || "",
            model: target.model || ""
        };
        consoleRef.statusText = `✏️ API 키 편집 시작: ${name || target.keyId}`;
        consoleRef.render();
    } else {
        document.getElementById("modalApiKeyName").value = name;
        document.getElementById("modalApiKey").value = existingKey;
        document.getElementById("modalApiProvider").value = target.provider || "";
        document.getElementById("modalApiBaseUrl").value = baseURL || "";
        document.getElementById("modalApiModel").dataset.selectedModel = target.model || "";
        void bindEvents();
    }
}

async function startEditingKey(keyId) {
    if (profileActionBusy) return false;
    try {
        const keys = await getSavedKeys();
        if (profileActionBusy) return false;
        const target = keys.find(item => item.keyId === keyId);
        if (!target) {
            await refreshConsoleAfterProfileAction("편집할 API 키를 찾을 수 없습니다.");
            return false;
        }

        showProfileForm(target);
        return true;
    } catch (error) {
        if (await notifyConnectionFailure(error)) return false;
        await refreshConsoleAfterProfileAction(safeFailure(error, "API 설정 편집을 시작하지 못했어요."));
        return false;
    }
}

// =========================================================
// 16. 모달 이벤트 바인딩
// =========================================================
// 제공자 선택이 바뀌면 모델 드롭다운을 다시 그린다.
// 저장된 키 목록의 사용/편집/삭제 버튼도 여기서 처리한다.
const boundModalBodies = new WeakSet();
const listUpdates = new WeakMap();
const listSignatures = new WeakMap();

function refreshKeyHint() {
    const provider = document.getElementById("modalApiProvider")?.value;
    const hint = document.getElementById("modalApiKeyHint");
    if (!hint) return;
    const local = isLocalProvider(provider);
    const label = document.getElementById("modalApiKeyLabel");
    if (label) label.textContent = local ? "API 키 (선택사항)" : "API 키";
    let message = local ? "인증을 설정한 로컬 서버에서만 키를 입력하세요." : "키는 연결된 내 컴퓨터의 실행 프로그램에 저장해요.";
    const profile = confirmedProfile();
    const endpoint = document.getElementById("modalApiBaseUrl")?.value.trim();
    const matches = !local && !document.getElementById("modalApiKey")?.value &&
        sameConnection(profile, { provider, model: document.getElementById("modalApiModel")?.value, baseURL: endpoint });
    if (matches) {
        let target;
        try { if (editingKeyId) target = readProfileMetadata().find(item => item.keyId === editingKeyId); }
        catch { /* An unreadable browser profile cannot establish a match. */ }
        const keep = savedProfileState(target) && target.name === document.getElementById("modalApiKeyName")?.value.trim();
        message = `이 쩜통에 ${provider} / ${profile.model}의 API 키가 저장돼 있어요. ` +
            (keep ? "현재 설정을 그대로 쓸 때는 키 입력칸을 비워 두세요." : "새 설정이나 다른 프로필을 적용할 때는 키를 입력하세요.");
    }
    if (hint.textContent !== message) hint.textContent = message;
    const status = document.getElementById("modalApiConnectionStatus");
    if (status?.dataset?.modelsFromFallback === "true") {
        status.textContent = matches
            ? "현재 모델로 대화할 때는 저장된 키를 사용해요. 제공자의 최신 모델 목록을 다시 조회할 때만 키를 입력하세요."
            : "기본 모델 목록을 표시하고 있어요. 키를 입력하면 제공자의 최신 목록을 조회해요.";
    }
    const list = document.getElementById("savedKeysList");
    if (list && listUpdates.has(list)) {
        const signature = JSON.stringify([profile, getCurrentKeyId()]);
        if (listSignatures.get(list) !== signature) {
            listSignatures.set(list, signature);
            void updateSavedList(list);
        }
    }
}

async function updateSavedList(list) {
    const request = Symbol();
    listUpdates.set(list, request);
    const current = () => listUpdates.get(list) === request && document.getElementById("savedKeysList") === list;
    try {
        const html = await renderSavedKeysList();
        if (current()) list.innerHTML = html;
    } catch {
        if (current()) list.textContent = "기존 설정 목록을 읽지 못했어요.";
    }
}

async function bindEvents() {
    const modalBody = document.getElementById("modalBody");
    if (!modalBody || boundModalBodies.has(modalBody)) return;

    const providerSelect = document.getElementById("modalApiProvider");
    const modelSelect = document.getElementById("modalApiModel");
    const apiKeyInput = document.getElementById("modalApiKey");
    const baseUrlInput = document.getElementById("modalApiBaseUrl");
    const connectionStatus = document.getElementById("modalApiConnectionStatus");
    if (!providerSelect || !modelSelect || !apiKeyInput || !baseUrlInput) {
        return;
    }
    // Restore an edited profile's model synchronously. Remote model discovery
    // may take longer than the user needs to submit the form.
    const initialModel = modelSelect.dataset.selectedModel || modelSelect.value || "";
    const manualModel = modelSelect.tagName === "INPUT";
    if (!manualModel && providerSelect.value) {
        modelSelect.innerHTML = buildModelOptionsFallback(providerSelect.value, initialModel);
        if (initialModel) modelSelect.value = initialModel;
    }
    boundModalBodies.add(modalBody);
    setProfileActionBusy(profileActionBusy);

    const savedKeysList = document.getElementById("savedKeysList");
    let savedListUpdate = Promise.resolve();
    if (savedKeysList) {
        savedKeysList.addEventListener("click", async (event) => {
            const useBtn = event.target?.closest(".use-key-btn");
            if (useBtn) {
                const keyId = useBtn.getAttribute("data-key-id");
                if (keyId) await switchToKey(keyId);
                return;
            }

            const editBtn = event.target?.closest(".edit-key-btn");
            if (editBtn) {
                const keyId = editBtn.getAttribute("data-key-id");
                if (keyId) await startEditingKey(keyId);
                return;
            }

            const deleteBtn = event.target?.closest(".delete-key-btn");
            if (deleteBtn) {
                const keyId = deleteBtn.getAttribute("data-key-id");
                if (keyId && await HAEMA_DIALOG.confirm("이 연결 설정을 삭제하시겠습니까?", { title: '연결 설정을 삭제할까요?', confirmText: '삭제하기', cancelText: '취소' })) {
                    await deleteKey(keyId);
                }
            }
        });

        listSignatures.set(savedKeysList, JSON.stringify([confirmedProfile(), getCurrentKeyId()]));
        savedListUpdate = updateSavedList(savedKeysList);
    }

    let previousBaseUrl = baseUrlInput.value.trim();
    let modelRequestVersion = 0;
    let modelRefreshTimer = null;

    function clearConnectionSelection() {
        apiKeyInput.value = "";
        modelSelect.dataset.selectedModel = "";
        if (manualModel) modelSelect.value = "";
        else modelSelect.innerHTML = '<option value="">모델을 선택하세요</option>';
    }

    function connectionSnapshot() {
        return { provider: providerSelect.value, apiKey: apiKeyInput.value.trim(), baseUrl: baseUrlInput.value.trim(),
            selectedModel: modelSelect.value || modelSelect.dataset.selectedModel || "" };
    }

    async function canApplyModelList(version) {
        const current = () => version === modelRequestVersion && document.getElementById("modalApiModel") === modelSelect;
        const supportsOpen = globalThis.CSS?.supports?.("selector(select:open)");
        // External options must not replace the native list under a pointer or keyboard.
        // In older browsers focus leaving the selector is a reliable point to apply them.
        while (current() && document.activeElement === modelSelect && (!supportsOpen || modelSelect.matches(":open"))) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return current();
    }

    async function refreshModelOptions(requestVersion, snapshot = connectionSnapshot()) {
        const { provider, selectedModel: currentModel } = snapshot;
        if (document.getElementById("modalApiModel") !== modelSelect) return;
        if (manualModel || isSetupOnlyRuntime()) return;

        if (connectionStatus?.dataset) delete connectionStatus.dataset.modelsFromFallback;
        if (!provider) {
            modelSelect.innerHTML = '<option value="">모델을 선택하세요</option>';
            if (connectionStatus) connectionStatus.textContent = "Provider를 선택하면 연결 상태와 모델 목록을 확인합니다.";
            return;
        }

        if (!isLocalProvider(provider) && !snapshot.apiKey) {
            modelSelect.innerHTML = buildModelOptionsFallback(provider, currentModel);
            modelSelect.dataset.selectedModel = currentModel;
            if (connectionStatus) {
                connectionStatus.dataset.modelsFromFallback = "true";
                refreshKeyHint();
            }
            return;
        }

        if (connectionStatus) connectionStatus.textContent = "🔄 API 연결과 모델 목록을 확인하는 중...";
        try {
            const options = await buildModelOptions(provider, currentModel, snapshot);
            if (!await canApplyModelList(requestVersion)) return;
            const latestModel = modelSelect.value || modelSelect.dataset.selectedModel || "";
            modelSelect.innerHTML = options;
            if (!isLocalProvider(provider) && latestModel && !Array.from(modelSelect.options).some(option => option.value === latestModel)) {
                const preserved = document.createElement("option");
                preserved.value = latestModel;
                preserved.textContent = latestModel;
                modelSelect.appendChild(preserved);
            }
            modelSelect.value = latestModel;
            modelSelect.dataset.selectedModel = modelSelect.value || "";
            if (connectionStatus) connectionStatus.textContent = isLocalProvider(provider) && modelSelect.options.length <= 1
                ? "연결은 확인했지만 사용할 수 있는 모델이 없어요. 로컬 서버에서 모델을 준비하고 다시 조회해주세요."
                : "✅ API 연결 확인됨. 모델을 선택하세요.";
        } catch (error) {
            if (!await canApplyModelList(requestVersion)) return;
            const connectionMessage = connectionFailure(error);
            if (connectionMessage) {
                if (connectionStatus) connectionStatus.textContent = "⚠️ " + connectionMessage;
                return;
            }
            const latestModel = modelSelect.value || modelSelect.dataset.selectedModel || "";
            modelSelect.innerHTML = buildModelOptionsFallback(provider, latestModel);
            modelSelect.dataset.selectedModel = isLocalProvider(provider) ? "" : latestModel;
            if (connectionStatus) connectionStatus.textContent = "❌ 모델 목록 확인 실패: " + safeFailure(error, "모델 목록을 확인하지 못했어요. 입력한 설정을 유지한 채 다시 확인해 주세요.");
        }
    }

    function scheduleModelRefresh() {
        if (manualModel || isSetupOnlyRuntime()) return;
        const requestVersion = ++modelRequestVersion;
        const snapshot = connectionSnapshot();
        if (modelRefreshTimer !== null) clearTimeout(modelRefreshTimer);
        if (isLocalProvider(snapshot.provider)) {
            modelSelect.dataset.selectedModel = snapshot.selectedModel;
            modelSelect.innerHTML = '<option value="">모델을 선택하세요</option>';
        }
        modelRefreshTimer = setTimeout(() => {
            modelRefreshTimer = null;
            refreshModelOptions(requestVersion, snapshot);
        }, 300);
    }

    function updateModelSuggestions() {
        const list = document.getElementById("modalModelSuggestions");
        if (!list) return;
        const models = providerSelect.value === "custom" ? [] : PROVIDER_MODEL_MAP[providerSelect.value] || [];
        list.innerHTML = models.filter(id => id !== "custom-model")
            .map(id => `<option value="${escapeAttr(id)}"></option>`).join("");
    }
    providerSelect.addEventListener("change", () => {
        clearConnectionSelection();
        baseUrlInput.value = getDefaultBaseUrl(providerSelect.value);
        previousBaseUrl = baseUrlInput.value.trim();
        refreshKeyHint();
        updateModelSuggestions();
        scheduleModelRefresh();
    });
    apiKeyInput.addEventListener("input", () => {
        refreshKeyHint();
        scheduleModelRefresh();
    });
    baseUrlInput.addEventListener("input", () => {
        if (baseUrlInput.value.trim() !== previousBaseUrl) clearConnectionSelection();
        previousBaseUrl = baseUrlInput.value.trim();
        refreshKeyHint();
        scheduleModelRefresh();
    });
    modelSelect.addEventListener(manualModel ? "input" : "change", () => {
        modelSelect.dataset.selectedModel = modelSelect.value || "";
        refreshKeyHint();
    });
    document.getElementById("modalRefreshModels")?.addEventListener("click", () => {
        if (!profileActionBusy) scheduleModelRefresh();
    });

    document.getElementById("modalApiKeyName")?.addEventListener("input", refreshKeyHint);
    refreshKeyHint();
    if (manualModel) {
        updateModelSuggestions();
    } else if (isLocalProvider(providerSelect.value) || apiKeyInput.value.trim()) {
        scheduleModelRefresh();
    } else {
        const requestVersion = ++modelRequestVersion;
        await refreshModelOptions(requestVersion);
        if (initialModel) modelSelect.dataset.selectedModel = initialModel;
    }
    await savedListUpdate;
}

// =========================================================
// 17. 공개 API
// =========================================================
return {
    setConsole,
    safeBaseUrl,
    savedProfileState,
    renderApiKeyModalContent,
    refreshKeyHint,
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
