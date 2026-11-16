// @editedBy SherrySherry 2026-09-24
// @editedBy YAONG1230 2026-10-07
// @editedBy YAONG1230 2026-10-16
// User-selected API profiles and model settings.
const HAEMA_API_KEY_MODAL = (() => {
function requestLocal(operation, input = {}) {
    const connection = globalThis.HAEMA_LOCAL_CONNECTION;
    if (!connection || typeof connection.request !== "function") {
        throw new Error("로컬 연결을 확인해 주세요.");
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

function isLocalProvider(provider) {
    return provider === "ollama" || provider === "lmstudio";
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

    const res = await requestLocal("models.list", { provider, apiKey, baseUrl });

    if (!res.ok) {
        throw new Error("모델 목록을 확인하지 못했어요. 연결 상태를 다시 확인해 주세요.");
    }

    const data = await res.json();
    if (!data.success) {
        throw new Error(data.error || "모델 목록을 가져올 수 없습니다.");
    }

    if (!Array.isArray(data.models)) throw new Error("모델 목록 응답을 확인할 수 없습니다.");
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
    const savedBaseUrl = data.baseURL ?? localStorage.getItem("haema_api_base_url") ?? "";
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
            <input class="form-input" id="modalApiKey" type="password"
                value="${escapeHtml(savedKey)}"
                placeholder="sk-...">
            <div class="form-hint" id="modalApiKeyHint">${isLocalProvider(savedProvider) ? "인증을 설정한 로컬 서버에서만 키를 입력하세요." : "실제 API 인증 키를 입력하세요."}</div>
        </div>
    `;

    // 모델 드롭다운
    // renderApiKeyModalContent()는 동기 HTML 반환 함수이므로,
    // buildModelOptions()를 여기서 직접 await 하지 않고 select를 비운 뒤
    // bindEvents() / initModelSelect()에서 비동기로 채운다.
    const modelSelect = `
        <div class="form-group" id="modalModelGroup">
            <label class="form-label" for="modalApiModel">모델</label>
            <select class="form-select" id="modalApiModel" data-selected-model="${escapeAttr(savedModel)}">
                <option value="">모델을 선택하세요</option>
            </select>
            <div class="form-hint">선택한 제공자에 맞는 모델을 선택하세요.</div>
            <button class="btn btn-small btn-ghost" type="button" id="modalRefreshModels">모델 다시 조회</button>
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

    return keys.map((item, index) => {
        const displayProvider = item.provider || "제공자 없음";
        const displayModel = item.model || "모델 없음";
        const maskedKey = maskApiKey(item.apiKey) || (isLocalProvider(item.provider) ? "키 없이 연결" : "");
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
// 암호화된 ConsoleConfigStore를 사용한다.

async function getSavedKeys() {
    if (typeof ConsoleConfigStore !== "undefined" && typeof WebCryptoCipher !== "undefined") {
        try {
            const { config } = await loadEncryptedConfig();
            return config.sets;
        } catch (e) {
            console.error("HAEMA_API_KEY_MODAL: 암호화 저장소 로드 실패", e);
            return [];
        }
    } else {
        // 레거시 방식 폴백
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
}

async function loadEncryptedConfig() {
    if (typeof ConsoleConfigStore === "undefined" || typeof WebCryptoCipher === "undefined") {
        throw new Error("암호화된 API 설정 저장소를 사용할 수 없습니다.");
    }

    const cipher = new WebCryptoCipher();
    await cipher.generateSessionKey();
    const store = new ConsoleConfigStore(cipher);
    const config = await store.load();
    if (!Array.isArray(config.sets)) config.sets = [];
    return { store, config };
}

async function persistApiKeyProfile(keyItem, activate = false, prepareOnly = false) {
    const { store, config } = await loadEncryptedConfig();
    const existingIndex = config.sets.findIndex(item => item.keyId === keyItem.keyId);
    if (existingIndex >= 0) {
        config.sets[existingIndex] = keyItem;
    } else {
        config.sets.push(keyItem);
    }
    if (activate) config.apiKeySet = keyItem;
    if (prepareOnly) await store.cipher.encrypt(config);
    else await store.save(config);
    return config;
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

function setActiveKeyMetadata(keyItem) {
    localStorage.setItem("haema_api_provider", keyItem.provider || "");
    localStorage.setItem("haema_api_model", keyItem.model || "");
    localStorage.setItem("haema_api_base_url", keyItem.baseURL || "");
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
    const formData = consoleRef?.modalData;
    const targetKeyId = editingKeyId;

    // 입력 검증
    if (!name) {
        await HAEMA_DIALOG.alert("설정 이름을 입력해주세요!", { tone: 'warning' });
        return false;
    }
    if (!provider) {
        await HAEMA_DIALOG.alert("API 제공자를 선택해주세요!", { tone: 'warning' });
        return false;
    }
    if (!model) {
        await HAEMA_DIALOG.alert("모델을 선택해주세요!", { tone: 'warning' });
        return false;
    }
    if (!isLocalProvider(provider) && !apiKey) {
        await HAEMA_DIALOG.alert("API 키를 입력해주세요!", { tone: 'warning' });
        return false;
    }

    const modalSaveButton = document.getElementById("modalSave");
    if (modalSaveButton?.disabled) return false;
    setProfileActionBusy(true);
    let serverSaved = false;

    try {
        const validation = await validateProviderConnection(provider, apiKey, baseURL, model);
        if (!validation.ok) {
            await notifySaveResult(false, provider, model, false, validation.message);
            return false;
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

        // Verify encryption without replacing a saved profile before the server
        // accepts it. A rejected request never needs to roll back another tab.
        await persistApiKeyProfile(keyItem, false, true);
        // Retrying this draft reuses its profile instead of appending a duplicate.
        if (!consoleRef || consoleRef.modalData === formData) {
            editingKeyId = keyItem.keyId;
            if (formData) formData.keyId = keyItem.keyId;
        }
        serverSaved = await saveConnectionSettings(keyItem);
        if (!serverSaved) {
            await notifySaveResult(false, provider, model, false, "로컬 서버에 API 설정을 저장하지 못했습니다.");
            return false;
        }

        await persistApiKeyProfile(keyItem, true);
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

        await notifySaveResult(true, provider, model);
        return true;
    } catch (error) {
        console.error("HAEMA_API_KEY_MODAL: API 설정 저장 실패", error);
        if (serverSaved) {
            const message = "연결 설정은 서버에 적용했지만 브라우저에 프로필을 저장하지 못했어요. 입력한 설정은 그대로 두었으니 저장 공간을 확인하고 다시 저장해주세요.";
            if (consoleRef) { consoleRef.apiConfigured = true; consoleRef.statusText = message; }
            await HAEMA_DIALOG.alert(message, { title: '서버 연결 설정은 적용했어요', tone: 'warning' });
            return false;
        }
        await notifySaveResult(false, provider, model, false, error.message || "API 설정을 저장하지 못했습니다.");
        return false;
    } finally {
        setProfileActionBusy(false);
    }
}

async function validateProviderConnection(provider, apiKey, baseUrl, model) {
    const response = await requestLocal("models.list", { provider, apiKey, baseUrl });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        return {
            ok: false,
            message: payload.error || "API 키 또는 Base URL 연결에 실패했습니다."
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
    try {
        const response = await requestLocal("settings.save", {
            provider: keyItem.provider,
            model: keyItem.model,
            apiKey: keyItem.apiKey,
            baseUrl: keyItem.baseURL
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
// 상태 텍스트를 유지하고, 연결 실패는 캐릭터 알림으로도 안내한다.
async function notifySaveResult(success, provider, model, serverSaveOnlyFailed = false, errorMessage = "") {
    const message = !success
        ? `❌ API 연결 실패: ${errorMessage || "제공자와 Base URL, 필요한 경우 키를 확인해주세요."}`
        : serverSaveOnlyFailed
        ? `✅ 연결 프로필 보관 완료: ${provider} / ${model} (서버 저장은 확인되지 않았습니다)`
        : `✅ 연결 설정 저장 완료: ${provider} / ${model}`;

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

    consoleRef.statusText = message;
    if (typeof consoleRef.refreshApiStatus === "function") {
        await consoleRef.refreshApiStatus();
    } else if (typeof consoleRef.render === "function") {
        consoleRef.render();
    }
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
    try {
        const keys = await getSavedKeys();
        const target = keys.find(item => item.keyId === keyId);
        if (!target) {
            await refreshConsoleAfterProfileAction("선택한 API 키를 찾을 수 없습니다.");
            return false;
        }

        if (isLocalProvider(target.provider)) {
            const validation = await validateProviderConnection(target.provider, target.apiKey || "", target.baseURL || "", target.model);
            if (!validation.ok) {
                await notifySaveResult(false, target.provider, target.model, false, validation.message);
                return false;
            }
        }
        if (!await saveConnectionSettings(target)) {
            await refreshConsoleAfterProfileAction("API 키 전환에 실패했습니다. 로컬 서버 설정을 저장하지 못했습니다.");
            return false;
        }

        await persistApiKeyProfile(target, true);
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
        await refreshConsoleAfterProfileAction(`✅ 연결 설정 전환 완료: ${target.provider} / ${target.model}`);
        return true;
    } catch (error) {
        console.error("HAEMA_API_KEY_MODAL: API 키 전환 실패", error);
        await refreshConsoleAfterProfileAction(error.message || "API 키 전환에 실패했습니다.");
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
    try {
        const { store, config } = await loadEncryptedConfig();
        const target = config.sets.find(item => item.keyId === keyId);
        if (!target) {
            await refreshConsoleAfterProfileAction("삭제할 API 키를 찾을 수 없습니다.");
            return false;
        }

        const deletingActiveKey = getCurrentKeyId() === keyId || config.apiKeySet?.keyId === keyId;
        if (deletingActiveKey && !await clearLocalServerConfig()) {
            await refreshConsoleAfterProfileAction("활성 API 설정을 서버에서 지우지 못해 프로필을 삭제하지 않았습니다.");
            return false;
        }
        serverConfigCleared = deletingActiveKey;

        config.sets = config.sets.filter(item => item.keyId !== keyId);
        if (deletingActiveKey) config.apiKeySet = null;
        await store.save(config);

        if (deletingActiveKey) {
            clearActiveKeyMetadata();
            if (consoleRef) {
                consoleRef.apiConfigured = false;
                consoleRef.modalData = { apiKey: "", provider: "", model: "", baseURL: "", name: "" };
            }
        }

        await refreshConsoleAfterProfileAction(`🗑️ API 키 삭제 완료: ${target.provider} / ${target.model}`);
        return true;
    } catch (error) {
        if (serverConfigCleared) {
            clearActiveKeyMetadata();
            if (consoleRef) {
                consoleRef.apiConfigured = false;
                consoleRef.modalData = { apiKey: "", provider: "", model: "", baseURL: "", name: "" };
            }
        }
        console.error("HAEMA_API_KEY_MODAL: API 키 삭제 실패", error);
        await refreshConsoleAfterProfileAction(error.message || "API 키 삭제에 실패했습니다.");
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

        editingKeyId = target.keyId;
        const name = target.name || target.keyName || "";
        if (consoleRef && typeof consoleRef.render === "function") {
            consoleRef.modalMode = "apiKey";
            consoleRef.modalData = {
                keyId: target.keyId,
                name,
                apiKey: target.apiKey || "",
                provider: target.provider || "",
                baseURL: target.baseURL || "",
                model: target.model || ""
            };
            consoleRef.statusText = `✏️ API 키 편집 시작: ${name || target.keyId}`;
            consoleRef.render();
        } else {
            document.getElementById("modalApiKeyName").value = name;
            document.getElementById("modalApiKey").value = target.apiKey || "";
            document.getElementById("modalApiProvider").value = target.provider || "";
            document.getElementById("modalApiBaseUrl").value = target.baseURL || "";
            document.getElementById("modalApiModel").dataset.selectedModel = target.model || "";
            await bindEvents();
        }
        return true;
    } catch (error) {
        console.error("HAEMA_API_KEY_MODAL: API 키 편집 시작 실패", error);
        await refreshConsoleAfterProfileAction(error.message || "API 키 편집을 시작하지 못했습니다.");
        return false;
    }
}

// =========================================================
// 16. 모달 이벤트 바인딩
// =========================================================
// 제공자 선택이 바뀌면 모델 드롭다운을 다시 그린다.
// 저장된 키 목록의 사용/편집/삭제 버튼도 여기서 처리한다.
const boundModalBodies = new WeakSet();

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
    if (providerSelect.value) {
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

        const renderedList = savedKeysList;
        savedListUpdate = renderSavedKeysList().then(html => {
            if (document.getElementById("savedKeysList") === renderedList) renderedList.innerHTML = html;
        });
    }

    let previousBaseUrl = baseUrlInput.value.trim();
    let modelRequestVersion = 0;
    let modelRefreshTimer = null;

    function clearConnectionSelection() {
        apiKeyInput.value = "";
        modelSelect.dataset.selectedModel = "";
        modelSelect.innerHTML = '<option value="">모델을 선택하세요</option>';
    }

    function updateKeyHint() {
        const local = isLocalProvider(providerSelect.value);
        const label = document.getElementById("modalApiKeyLabel");
        const hint = document.getElementById("modalApiKeyHint");
        if (label) label.textContent = local ? "API 키 (선택사항)" : "API 키";
        if (hint) hint.textContent = local ? "인증을 설정한 로컬 서버에서만 키를 입력하세요." : "실제 API 인증 키를 입력하세요.";
    }

    function connectionSnapshot() {
        return { provider: providerSelect.value, apiKey: apiKeyInput.value.trim(), baseUrl: baseUrlInput.value.trim(),
            selectedModel: modelSelect.value || modelSelect.dataset.selectedModel || "" };
    }

    async function refreshModelOptions(requestVersion, snapshot = connectionSnapshot()) {
        const { provider, selectedModel: currentModel } = snapshot;
        if (document.getElementById("modalApiModel") !== modelSelect) return;

        if (!provider) {
            modelSelect.innerHTML = '<option value="">모델을 선택하세요</option>';
            if (connectionStatus) connectionStatus.textContent = "Provider를 선택하면 연결 상태와 모델 목록을 확인합니다.";
            return;
        }

        if (!isLocalProvider(provider) && !snapshot.apiKey) {
            modelSelect.innerHTML = buildModelOptionsFallback(provider, currentModel);
            modelSelect.dataset.selectedModel = currentModel;
            if (connectionStatus) connectionStatus.textContent = "⚠️ API 키를 입력하면 연결을 확인하고 모델 목록을 가져옵니다.";
            return;
        }

        if (connectionStatus) connectionStatus.textContent = "🔄 API 연결과 모델 목록을 확인하는 중...";
        try {
            const options = await buildModelOptions(provider, currentModel, snapshot);
            if (requestVersion !== modelRequestVersion || document.getElementById("modalApiModel") !== modelSelect) return;
            modelSelect.innerHTML = options;
            const latestModel = modelSelect.dataset.selectedModel || currentModel;
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
            if (requestVersion !== modelRequestVersion || document.getElementById("modalApiModel") !== modelSelect) return;
            console.warn('[HAEMA_API_KEY_MODAL] 모델 목록 갱신 실패:', error);
            modelSelect.innerHTML = buildModelOptionsFallback(provider, currentModel);
            modelSelect.dataset.selectedModel = isLocalProvider(provider) ? "" : currentModel;
            if (connectionStatus) connectionStatus.textContent = `❌ API 연결 실패: ${error.message || "키와 Base URL을 확인해주세요."}`;
        }
    }

    function scheduleModelRefresh() {
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

    providerSelect.addEventListener("change", () => {
        clearConnectionSelection();
        baseUrlInput.value = getDefaultBaseUrl(providerSelect.value);
        previousBaseUrl = baseUrlInput.value.trim();
        updateKeyHint();
        scheduleModelRefresh();
    });
    apiKeyInput.addEventListener("input", scheduleModelRefresh);
    baseUrlInput.addEventListener("input", () => {
        if (baseUrlInput.value.trim() !== previousBaseUrl) clearConnectionSelection();
        previousBaseUrl = baseUrlInput.value.trim();
        scheduleModelRefresh();
    });
    modelSelect.addEventListener("change", () => {
        modelSelect.dataset.selectedModel = modelSelect.value || "";
    });
    document.getElementById("modalRefreshModels")?.addEventListener("click", () => {
        if (!profileActionBusy) scheduleModelRefresh();
    });

    updateKeyHint();
    if (isLocalProvider(providerSelect.value) || apiKeyInput.value.trim()) {
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
