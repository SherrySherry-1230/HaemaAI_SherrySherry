// @editedBy Yaong1230 2026-09-14
/**
 * Haema 로컬 콘솔 — API 키 설정 UI (서랍형)
 *
 * 범위:
 * - 브라우저 localStorage에 API 키 설정을 저장/조회/초기화한다.
 * - 서랍형(drawer) UI로 API 키 입력 패널을 열고 닫는다.
 * - "암호화해서 저장되는 구조"만 잡는다. 실제 암호화 구현은 placeholder.
 * - AI 어댑터 연결 지점 예시를 보여준다.
 */

import {
  ConsoleConfigStore,
  activeApiKeySet,
} from './tools/console-web/configStore.js';

class PlaceholderCipher {
  async encrypt(config) {
    return {
      version: 1,
      cipher: 'placeholder',
      payload: JSON.stringify(config),
      meta: { storedAt: Date.now() },
    };
  }

  async decrypt(stored) {
    if (stored.cipher === 'placeholder') {
      return JSON.parse(stored.payload);
    }
    throw new Error(`지원하지 않는 암호화 방식: ${stored.cipher}`);
  }
}

const store = new ConsoleConfigStore(new PlaceholderCipher());

const drawer = document.getElementById('apiKeyDrawer');
const drawerOverlay = document.getElementById('drawerOverlay');
const apiKeyToggleBtn = document.getElementById('apiKeyToggleBtn');
const drawerCloseBtn = document.getElementById('drawerCloseBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const configEl = document.getElementById('currentConfig');
const configDetails = document.getElementById('configDetails');
const currentConfigDrawer = document.getElementById('currentConfigDrawer');
const connectionExample = document.getElementById('connectionExample');
const keyStatusIcon = document.getElementById('keyStatusIcon');
const apiKeyBtnText = document.getElementById('apiKeyBtnText');

const providerEl = document.getElementById('provider');
const modelEl = document.getElementById('model');
const apiKeyEl = document.getElementById('apiKey');
const baseURLEl = document.getElementById('baseURL');

function showStatus(message, type) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = 'status ' + (type === 'ok' ? 'ok' : 'err');
  statusEl.style.display = 'block';
  setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function maskKey(key) {
  if (!key || key.length < 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

function openDrawer() {
  drawer.classList.add('open');
  drawerOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawerOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

function renderConfig(config) {
  if (!configEl) return;
  if (!config.apiKeySet && config.sets.length === 0) {
    configEl.innerHTML = '<p class="muted">저장된 설정이 없습니다. 우측 상단 [API 키 설정] 버튼을 눌러 키를 입력하세요.</p>';
    updateKeyStatus(null);
    return;
  }
  const active = activeApiKeySet(config);
  if (!active) {
    configEl.innerHTML = '<p class="muted">저장된 설정이 없습니다.</p>';
    updateKeyStatus(null);
    return;
  }
  configEl.innerHTML = `
    <div>
      <label>현재 활성 설정</label>
      <div style="margin-top:8px;">
        <span class="chip">제공자: ${escapeHtml(active.provider)}</span>
        <span class="chip" style="margin-left:6px;">모델: ${escapeHtml(active.model)}</span>
      </div>
      <div style="margin-top:8px;font-size:13px;color:var(--text-secondary);">
        Base URL: ${active.baseURL ? escapeHtml(active.baseURL) : '(기본값 사용)'}
      </div>
      <div style="margin-top:4px;font-size:12px;color:var(--text-secondary);">
        마지막 수정: ${formatTime(active.updatedAt)}
      </div>
    </div>
  `;
  updateKeyStatus(active);
}

function renderConfigDrawer(config) {
  if (!currentConfigDrawer || !configDetails) return;
  if (!config.apiKeySet && config.sets.length === 0) {
    currentConfigDrawer.style.display = 'none';
    return;
  }
  const active = activeApiKeySet(config);
  if (!active) {
    currentConfigDrawer.style.display = 'none';
    return;
  }
  currentConfigDrawer.style.display = 'block';
  configDetails.innerHTML = `
    <div class="config-row"><span class="config-label">제공자</span><span class="config-value">${escapeHtml(active.provider)}</span></div>
    <div class="config-row"><span class="config-label">모델</span><span class="config-value">${escapeHtml(active.model)}</span></div>
    <div class="config-row"><span class="config-label">Base URL</span><span class="config-value">${active.baseURL ? escapeHtml(active.baseURL) : '(기본값 사용)'}</span></div>
    <div class="config-row"><span class="config-label">API 키</span><span class="config-value key-mask">${maskKey(active.apiKey)}</span></div>
    <div class="config-row"><span class="config-label">마지막 수정</span><span class="config-value">${formatTime(active.updatedAt)}</span></div>
  `;
}

function updateKeyStatus(active) {
  if (!keyStatusIcon || !apiKeyBtnText) return;
  if (active && active.apiKey) {
    keyStatusIcon.className = 'key-status setted';
    apiKeyBtnText.textContent = 'API 키 설정됨';
  } else {
    keyStatusIcon.className = 'key-status';
    apiKeyBtnText.textContent = 'API 키 설정';
  }
}

function renderConnectionExample(config) {
  if (!connectionExample) return;
  const active = activeApiKeySet(config);
  const code = `
// Haema 콘솔에서 저장한 API 키 설정 예시
const active = ${active ? JSON.stringify(active, null, 2) : 'null'};

if (!active) {
  console.warn('Haema 콘솔에 저장된 API 키가 없습니다.');
}

const adapter = new OpenAIAdapter({
  provider: active?.provider ?? 'openai-compatible',
  model: active?.model ?? 'solar-pro',
  apiKey: active?.apiKey,
  baseURL: active?.baseURL,
  taskModels: {
    extract: active?.model ?? 'solar-pro',
    summarize: active?.model ?? 'solar-pro',
    judgeMerge: active?.model ?? 'solar-pro',
    scoreRecall: active?.model ?? 'solar-pro',
  },
});
`.trim();
  connectionExample.textContent = code;
}

async function saveFromForm() {
  if (!providerEl || !modelEl || !apiKeyEl) {
    showStatus('입력칸을 찾을 수 없습니다.', 'err');
    return;
  }
  const provider = providerEl.value;
  const model = modelEl.value.trim();
  const apiKey = apiKeyEl.value;
  const baseURL = baseURLEl ? baseURLEl.value.trim() : '';
  if (!model) { showStatus('모델을 입력해 주세요.', 'err'); return; }
  if (!apiKey) { showStatus('API 키를 입력해 주세요.', 'err'); return; }
  const current = await store.load();
  const active = { provider, model, apiKey, baseURL: baseURL || undefined, updatedAt: Date.now() };
  const next = { apiKeySet: active, sets: [active, ...current.sets.filter(s => s.model !== model || s.provider !== provider)] };
  await store.save(next);
  renderConfig(next);
  renderConfigDrawer(next);
  renderConnectionExample(next);
  showStatus('저장했습니다. 서버로 키를 전송합니다...', 'ok');
  apiKeyEl.value = '';
  sendKeyToServer(active);
  closeDrawer();
}

async function clearConfig() {
  if (!confirm('저장된 API 키를 초기화하시겠습니까?')) return;
  await store.clear();
  const empty = { apiKeySet: null, sets: [] };
  renderConfig(empty);
  renderConfigDrawer(empty);
  renderConnectionExample(empty);
  showStatus('키를 초기화했습니다.', 'ok');
  closeDrawer();
}

async function sendKeyToServer(apiKeySet) {
  console.log('[HaemaConsole] 서버로 키 전송:', {
    provider: apiKeySet.provider,
    model: apiKeySet.model,
    hasKey: !!apiKeySet.apiKey,
    baseURL: apiKeySet.baseURL,
    timestamp: new Date().toISOString(),
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const initial = await store.load();
  renderConfig(initial);
  renderConfigDrawer(initial);
  renderConnectionExample(initial);
  apiKeyToggleBtn?.addEventListener('click', openDrawer);
  drawerCloseBtn?.addEventListener('click', closeDrawer);
  cancelBtn?.addEventListener('click', closeDrawer);
  drawerOverlay?.addEventListener('click', closeDrawer);
  saveBtn?.addEventListener('click', saveFromForm);
  clearBtn?.addEventListener('click', clearConfig);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });
});
