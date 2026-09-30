import { timingSafeEqual } from 'node:crypto';
import { providers, allowedRoute } from './routes.mjs';

/** 키는 매 요청 전달받고 저장하지 않는다. 프록시 인증은 별도 토큰을 사용한다. */
export function createProxy({ token, fetchImpl = fetch }) {
  const fail = (res, status, message) => res.status(status).json({ error: { message } });
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!token || token.length < 32) return fail(res, 503, 'Proxy configuration is incomplete');
    const supplied = Buffer.from(req.get('x-haema-proxy-token') || '');
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return fail(res, 401, 'Invalid proxy token');
    }
    const match = req.path.match(/^\/([a-z]+)(\/.*)$/);
    const provider = match?.[1];
    const path = match?.[2];
    if (!allowedRoute(provider, path, req.method)) return fail(res, 404, 'Unsupported provider or route');
    const { base, format } = providers[provider];
    const headers = { 'Content-Type': 'application/json' };
    const keyHeader = format === 'google' ? 'x-goog-api-key' : format === 'anthropic' ? 'x-api-key' : 'authorization';
    const key = req.get(keyHeader);
    if (!key || key.length > 8192 || (keyHeader === 'authorization' && !/^Bearer \S+$/.test(key))) {
      return fail(res, 401, 'Provider API key required');
    }
    headers[keyHeader] = key;
    if (format === 'anthropic') headers['anthropic-version'] = '2023-06-01';
    let payload;
    if (req.method === 'POST') {
      if (!req.is('application/json')) return fail(res, 415, 'JSON body required');
      const body = req.body;
      if (Buffer.byteLength(JSON.stringify(body) || '') > 128 * 1024) return fail(res, 413, 'Prompt exceeds 128 KiB');
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.stream === true) {
        return fail(res, 400, 'Invalid request or streaming option');
      }
      if (format === 'google') {
        if (!Array.isArray(body.contents) || !body.contents.length) return fail(res, 400, 'Contents required');
        payload = { contents: body.contents, ...(body.systemInstruction ? { systemInstruction: body.systemInstruction } : {}),
          generationConfig: { ...body.generationConfig, maxOutputTokens: Math.min(4096, positiveLimit(body.generationConfig?.maxOutputTokens)) } };
      } else {
        if (typeof body.model !== 'string' || !/^[A-Za-z0-9._:/-]{1,200}$/.test(body.model) ||
            !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100) {
          return fail(res, 400, 'Model and messages required');
        }
        payload = { model: body.model, messages: body.messages, stream: false };
        if (body.temperature !== undefined) {
          if (typeof body.temperature !== 'number' || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2) {
            return fail(res, 400, 'Invalid temperature');
          }
          payload.temperature = body.temperature;
        }
        if (format === 'anthropic') {
          payload.max_tokens = Math.min(4096, positiveLimit(body.max_tokens));
          if (body.system) payload.system = body.system;
        } else {
          const limitKey = provider === 'openai' ? 'max_completion_tokens' : 'max_tokens';
          payload[limitKey] = Math.min(4096, positiveLimit(body.max_completion_tokens ?? body.max_tokens));
        }
      }
    }
    try {
      const upstream = await fetchImpl(base + path, { method: req.method, headers,
        redirect: 'error', signal: AbortSignal.timeout(55_000),
        ...(payload ? { body: JSON.stringify(payload) } : {}) });
      if (!upstream.ok) {
        const status = [400, 401, 403, 404, 429].includes(upstream.status) ? upstream.status : 502;
        return fail(res, status, status === 429 ? 'Provider usage limit reached' : `Provider request failed (${status})`);
      }
      return res.json(await upstream.json());
    } catch (error) {
      return fail(res, error?.name === 'TimeoutError' ? 504 : 502, 'Provider connection failed');
    }
  };
}
function positiveLimit(value) {
  return Number.isInteger(value) && value > 0 ? value : 4096;
}
