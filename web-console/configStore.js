// @editedBy SherrySherry 2026-09-13
/** Haema 로컬 콘솔 키 저장소 — 브라우저용

 * 타입 정의는 configStore.ts를 참고한다. 여기서는 브라우저에서 바로 쓸 수 있게
 * plain JS로 제공한다.
 *
 * 실제 암호화 구현은 Web Crypto API를 사용한 AES-GCM 암호화다.
 */

/**
 * @typedef {('openai'|'anthropic'|'google'|'custom'|'openrouter'|'ollama'|'aws-bedrock'|'openai-compatible'|'litellm'|'google-gemini'|'302ai'|'abacus'|'abliteration'|'abovedev'|'agenterouter'|'agnes-ai'|'aihub-mix'|'ai-router'|'ai-and'|'aixy'|'aki-io'|'alibaba'|'alibaba-china'|'alibaba-coding-plan'|'alibaba-coding-plan-china'|'alibaba-qwen'|'alibaba-qwen-code'|'deepseek'|'grok'|'openai-chatgpt-subscription')} ProviderKind
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

// ── Web Crypto API 기반 AES-GCM 암호화 ───────────────────────────────────

class WebCryptoCipher {
  constructor() {
    this.key = null; // 세션 기반 키 (메모리에만 저장)
    this.keyAlgorithm = 'AES-GCM';
    this.keyLength = 256; // 256-bit 키
  }

  // 세션 키 생성 (메모리 + sessionStorage에 저장)
  async generateSessionKey() {
    // sessionStorage에 키가 있는지 확인
    const storedKey = sessionStorage.getItem('haema.encryption.key');
    if (storedKey) {
      try {
        const keyData = JSON.parse(storedKey);
        this.key = await crypto.subtle.importKey(
          'jwk',
          keyData,
          { name: this.keyAlgorithm },
          true,
          ['encrypt', 'decrypt']
        );
        return this.key;
      } catch (e) {
        console.warn('저장된 키 복구 실패, 새 키 생성:', e);
      }
    }

    this.key = await crypto.subtle.generateKey(
      {
        name: this.keyAlgorithm,
        length: this.keyLength,
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );

    // 키를 sessionStorage에 저장 (세션 종료 시 삭제)
    const exportedKey = await crypto.subtle.exportKey('jwk', this.key);
    sessionStorage.setItem('haema.encryption.key', JSON.stringify(exportedKey));

    return this.key;
  }

  // 암호화
  async encrypt(config) {
    if (!this.key) {
      await this.generateSessionKey();
    }

    const configString = JSON.stringify(config);
    const encoder = new TextEncoder();
    const data = encoder.encode(configString);

    // IV (Initialization Vector) 생성
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // 암호화
    const encrypted = await crypto.subtle.encrypt(
      {
        name: this.keyAlgorithm,
        iv: iv,
      },
      this.key,
      data
    );

    // 암호화된 데이터와 IV를 base64로 인코딩
    const encryptedArray = new Uint8Array(encrypted);
    const ivArray = new Uint8Array(iv);

    return {
      version: 1,
      cipher: 'aes-gcm-256',
      iv: this.arrayBufferToBase64(ivArray),
      data: this.arrayBufferToBase64(encryptedArray),
      meta: { storedAt: Date.now() },
    };
  }

  // 복호화
  async decrypt(stored) {
    if (stored.cipher === 'aes-gcm-256') {
      if (!this.key) {
        throw new Error('세션 키가 없습니다. 저장소를 다시 연결해주세요.');
      }

      const iv = this.base64ToArrayBuffer(stored.iv);
      const encryptedData = this.base64ToArrayBuffer(stored.data);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: this.keyAlgorithm,
          iv: iv,
        },
        this.key,
        encryptedData
      );

      const decoder = new TextDecoder();
      const decryptedString = decoder.decode(decrypted);

      return JSON.parse(decryptedString);
    } else if (stored.cipher === 'placeholder') {
      // 레거시 placeholder 복호화 지원
      return JSON.parse(stored.payload);
    } else {
      throw new Error(`지원하지 않는 암호화 방식: ${stored.cipher}`);
    }
  }

  // 키 삭제 (세션 종료 시)
  clearKey() {
    this.key = null;
  }

  // ArrayBuffer를 Base64로 변환
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Base64를 ArrayBuffer로 변환
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// ── placeholder 암호화 (레거시 지원) ───────────────────────────────────────

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
    this.cipher.clearKey();
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

// 브라우저 전역 객체에 노출
window.ConsoleConfigStore = ConsoleConfigStore;
window.activeApiKeySet = activeApiKeySet;
window.STORAGE_KEY = STORAGE_KEY;
window.WebCryptoCipher = WebCryptoCipher;
window.PlaceholderCipher = PlaceholderCipher;
