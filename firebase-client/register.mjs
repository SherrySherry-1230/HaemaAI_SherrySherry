import { proxyFetch } from './transport.mjs';
globalThis.fetch = proxyFetch(process.env.HAEMA_PROXY_URL, process.env.HAEMA_PROXY_TOKEN);
// SDK shim은 등록 시 fetch를 캡처하므로 전송 교체 후 로드한다.
await import('@anthropic-ai/sdk/shims/web');
await import('groq-sdk/shims/web');
console.info('[haema] Firebase proxy mode enabled');
