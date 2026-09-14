// @editedBy SherrySherry 2026-09-13
/** Haema 로컬 콘솔 키 저장소 — 브라우저용

 * 타입 정의는 configStore.ts를 참고한다. 여기서는 브라우저에서 바로 쓸 수 있게
 * plain JS로 제공한다.
 *
 * 실제 암호화 구현은 placeholder다. 대표님이 채운다.
 */

/**
 * @typedef {('openai-compatible'|'anthropic'|'google'|'custom')} ProviderKind
 */

/**
 * @typedef {{
 *   provider: ProviderKind,
 *   model: string,
 *   apiKey: string,
 *   baseURL?: string,
 *   updatedAt: number,
 *   meta?: Record<string, unknown>,
 * }} ConsoleApiKeySet
 */

/**
 * @typedef {{
 *   version: 1,
 *   cipher: string,
 *   payload: string,
 *   meta?: { storedAt: number },
 * }} EncryptedConsoleConfig
 */

/**
 * @typedef {{
 *   apiKeySet: ConsoleApiKeySet | null,
 *   sets: ConsoleApiKeySet[],
 * }} ConsoleConfig
 */

const STORAGE_KEY = 'haema.console.config.v1';

// ── placeholder 암호화 ──────────────────────────────────────────────────

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

// ── 저장소 ─────────────────────────────────────────────────────────────

class ConsoleConfigStore {
  static STORAGE_KEY = STORAGE_KEY;

  constructor(cipher) {
    this.cipher = cipher;
  }

  async load() {
    const raw = this.rawStored();
    if (!raw) return { apiKeySet: null, sets: [] };

    try {
      const encrypted = JSON.parse(raw);
      return await this.cipher.decrypt(encrypted);
    } catch (err) {
      console.warn('[HaemaConsole] 설정 복호화 실패 — 저장된 설정을 무시합니다.', err);
      return { apiKeySet: null, sets: [] };
    }
  }

  async save(config) {
    const encrypted = await this.cipher.encrypt(config);
    this.rawStore(JSON.stringify(encrypted));
  }

  async clear() {
    this.rawStore(null);
  }

  rawStored() {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(STORAGE_KEY);
  }

  rawStore(value) {
    if (typeof window === 'undefined') return;
    if (value === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
  }
}

// ── 활성 키 꺼내기 ─────────────────────────────────────────────────────

function activeApiKeySet(config) {
  if (config.apiKeySet) return config.apiKeySet;
  return config.sets[0] ?? null;
}

// ── 내보내기 ───────────────────────────────────────────────────────────

export { ConsoleConfigStore, activeApiKeySet, STORAGE_KEY };
