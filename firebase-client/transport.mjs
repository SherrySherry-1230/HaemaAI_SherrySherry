import { providers, allowedRoute } from '../functions/routes.mjs';

/** 로컬 서버의 SDK 요청을 동일한 제공자 형식 그대로 Firebase로 전달한다. */
export function proxyFetch(baseUrl, token, originalFetch = fetch) {
  const base = new URL(baseUrl);
  const local = ['127.0.0.1', 'localhost'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(local && base.protocol === 'http:')) || base.username || base.password || base.search || base.hash) {
    throw new Error('HAEMA_PROXY_URL must be an HTTPS function URL or local emulator URL');
  }
  if (!token || token.length < 32) throw new Error('HAEMA_PROXY_TOKEN must contain at least 32 characters');
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    // 로컬 서버 내부 요청은 기존대로 유지한다.
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return originalFetch(request);
    const entry = Object.entries(providers).find(([, value]) =>
      request.url.startsWith(value.base + '/'));
    if (!entry) throw new Error('Unsupported provider URL in Firebase proxy mode');
    const [provider, config] = entry;
    const path = url.pathname.slice(new URL(config.base).pathname.replace(/\/$/, '').length);
    if (!allowedRoute(provider, path, request.method)) throw new Error('Unsupported AI operation in Firebase proxy mode');
    const headers = new Headers();
    for (const key of ['content-type', 'authorization', 'x-api-key', 'x-goog-api-key']) {
      if (request.headers.has(key)) headers.set(key, request.headers.get(key));
    }
    if (provider === 'google' && url.searchParams.has('key')) headers.set('x-goog-api-key', url.searchParams.get('key'));
    headers.set('x-haema-proxy-token', token);
    return originalFetch(base.href.replace(/\/$/, '') + '/' + provider + path, {
      method: request.method, headers, signal: request.signal, redirect: 'error',
      ...(request.method === 'POST' ? { body: await request.text() } : {}),
    });
  };
}
