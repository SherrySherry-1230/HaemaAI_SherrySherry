// @editedBy SherrySherry 2026-09-13
// ── 암호화 어댑터(구조만) ──────────────────────────────────────────────
//
// 대표님이 나중에 실제 암호화를 채운다.
// 지금은 "암호화해서 저장되는 구조"만 보여주기 위해,
// 저장 형태를 EncryptedConsoleConfig로 감싸는 최소 구현만 둔다.
//
// 실제 운영 시에는 여기서 암호화/복호화를 구현하거나,
// 별도 암호화 모듈을 끼워 넣는다.

class PlaceholderCipher {
  async encrypt(config) {
    // TODO: 대표님이 암호화 구현. 지금은 구조 확인용 placeholder.
    return {
      version: 1,
      cipher: 'placeholder', // 대표님이 실제 방식으로 교체
      payload: JSON.stringify(config), // 실제론 암호화된 blob
      meta: { storedAt: Date.now() },
    };
  }

  async decrypt(stored) {
    // TODO: 대표님이 복호화 구현. 지금은 구조 확인용 placeholder.
    if (stored.cipher === 'placeholder') {
      return JSON.parse(stored.payload);
    }
    // 다른 cipher는 아직 처리 못 함 → 복호화 실패로 간주
    throw new Error(`지원하지 않는 암호화 방식: ${stored.cipher}`);
  }
}

// ── 콘솔 상태 ──────────────────────────────────────────────────────────

const store = new ConsoleConfigStore(new PlaceholderCipher());
const statusEl = document.getElementById('status');
const configEl = document.getElementById('currentConfig');
const exampleEl = document.getElementById('connectionExample');
const storageKeyEl = document.getElementById('storageKeyName');

if (storageKeyEl) {
  storageKeyEl.textContent = ConsoleConfigStore.STORAGE_KEY;
}

function renderConnectionExample(config) {
  if (!exampleEl) return;

  const active = activeApiKeySet(config);

  const code = `
// 현재 저장된 활성 설정
${active ? `
const active = {
  provider: '${escapeHtml(active.provider)}',
  model: '${escapeHtml(active.model)}',
  apiKey: '<저장된 키>',
  baseURL: ${active.baseURL ? `'${escapeHtml(active.baseURL)}'` : 'undefined'},
  updatedAt: ${active.updatedAt},
};
` : '// 저장된 활성 설정이 없습니다.'}

// OpenAI 호환 제공자용 어댑터 예시
// 실제 호출부는 호스트(마이풉 등)가 조립한다.
const adapter = new OpenAIAdapter({
  provider: 'openai-compatible',
  model: active?.model ?? 'solar-pro',
  apiKey: active?.apiKey,            // 콘솔에서 저장한 사용자별 키
  baseURL: active?.baseURL,          // 콘솔에서 저장한 baseURL (없으면 환경변수 fallback)
  taskModels: {
    extract: active?.model ?? 'solar-pro',
    summarize: active?.model ?? 'solar-pro',
    judgeMerge: active?.model ?? 'solar-pro',
    scoreRecall: active?.model ?? 'solar-pro',
  },
});

// 참고:
// - Haema 코어는 키를 저장하지 않는다. 호출 시 메모리만 사용한다.
// - baseURL이 없으면 기존 process.env.SOLAR_BASE_URL fallback이 유지된다.
// - 여러 제공자를 바꿔 쓰는 구조는 추후 sets 배열로 확장 가능.
`.trim();

  exampleEl.textContent = code;
}

// ── 저장/초기화 ────────────────────────────────────────────────────────

async function saveFromForm() {
  const providerEl = document.getElementById('provider');
  const modelEl = document.getElementById('model');
  const apiKeyEl = document.getElementById('apiKey');
  const baseURLEl = document.getElementById('baseURL');

  if (!providerEl || !modelEl || !apiKeyEl) {
    showStatus('입력칸을 찾을 수 없습니다.', 'err');
    return;
  }

  const provider = providerEl.value;
  const model = modelEl.value.trim();
  const apiKey = apiKeyEl.value;
  const baseURL = baseURLEl ? baseURLEl.value.trim() : '';

  if (!model) {
    showStatus('모델을 입력해 주세요.', 'err');
    return;
  }
  if (!apiKey) {
    showStatus('API 키를 입력해 주세요.', 'err');
    return;
  }

  const current = await store.load();
  const active = {
    provider,
    model,
    apiKey,
    baseURL: baseURL || undefined,
    updatedAt: Date.now(),
  };

  const next = {
    apiKeySet: active,
    sets: [active, ...current.sets.filter(s => s.model !== model || s.provider !== provider)],
  };

  await store.save(next);
  renderConfig(next);
  renderConnectionExample(next);
  showStatus('저장했습니다. (실제 암호화 구현은 아직 placeholder입니다.)', 'ok');

  // 저장 후 입력칸은 비우지 않는다 — 대표님이 확인/수정할 수 있게
}

async function clearConfig() {
  if (!confirm('저장된 API 키를 초기화하시겠습니까?')) return;
  await store.clear();
  const empty = { apiKeySet: null, sets: [] };
  renderConfig(empty);
  renderConnectionExample(empty);
  showStatus('키를 초기화했습니다.', 'ok');
}

// ── 유틸 ───────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// ── 진입 ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('keyForm');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');

  const initial = await store.load();
  renderConfig(initial);
  renderConnectionExample(initial);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveFromForm();
  });

  saveBtn?.addEventListener('click', saveFromForm);
  clearBtn?.addEventListener('click', clearConfig);
});
