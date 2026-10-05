import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProxy } from './proxy.mjs';
const token = 'local-proxy-test-token-32-characters';
const body = { model: 'test-model', messages: [{ role: 'user', content: '기억할 내용' }] };
async function run({ path = '/upstage/chat/completions', method = 'POST', auth = token,
  input = body, fetchImpl = async () => Response.json({ ok: true }), config = {}, headers = {} } = {}) {
  let calls = 0;
  const allHeaders = { 'x-haema-proxy-token': auth, authorization: 'Bearer user-key', ...headers };
  const req = { path, method, body: input, get: (key) => allHeaders[key], is: () => true };
  const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
    status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } };
  await createProxy({ token, fetchImpl: async (...args) => { calls++; return fetchImpl(...args); }, ...config })(req, res);
  return { ...res, calls };
}
test('missing/wrong proxy token and missing config fail closed', async () => {
  for (const auth of ['', 'wrong']) { const r = await run({ auth }); assert.equal(r.statusCode, 401); assert.equal(r.calls, 0); }
  assert.equal((await run({ config: { token: '' } })).statusCode, 503);
  assert.equal((await run({ headers: { authorization: '' } })).statusCode, 401);
});
test('reject arbitrary URLs, unsupported routes and invalid prompts', async () => {
  for (const path of ['/unknown/models', '/openai/files', '/openai/../models', '/constructor/models']) {
    const r = await run({ path }); assert.equal(r.statusCode, 404); assert.equal(r.calls, 0);
  }
  for (const input of [null, {}, { ...body, messages: [] }, { ...body, stream: true }, { ...body, temperature: '1' }]) {
    assert.equal((await run({ input })).statusCode, 400);
  }
  assert.equal((await run({ input: { ...body, messages: [{ role: 'user', content: 'x'.repeat(140000) }] } })).statusCode, 413);
});
test('OpenAI compatible providers preserve user keys/models and bound output', async () => {
  for (const provider of ['openai', 'upstage', 'groq', 'grok', 'deepseek', 'openrouter']) {
    const r = await run({ path: `/${provider}/chat/completions`, input: { ...body, max_tokens: 999999, baseURL: 'https://example.com' },
      fetchImpl: async (url, options) => {
        assert.equal(options.headers.authorization, 'Bearer user-key');
        assert.equal(options.headers['x-haema-proxy-token'], undefined);
        assert.equal(options.redirect, 'error');
        const payload = JSON.parse(options.body);
        assert.equal(payload.model, 'test-model');
        assert.equal(payload.max_completion_tokens ?? payload.max_tokens, 4096);
        assert.equal(payload.baseURL, undefined);
        assert.ok(!url.includes('example.com'));
        return Response.json({ choices: [{ message: { content: '결과' } }] });
      } });
    assert.equal(r.statusCode, 200);
  }
});
test('Anthropic preserves native request format and key header', async () => {
  const r = await run({ path: '/anthropic/messages', headers: { 'x-api-key': 'claude-key' },
    input: { ...body, system: '기억 추출', max_tokens: 500 }, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(options.headers['x-api-key'], 'claude-key');
      assert.equal(options.headers.authorization, undefined);
      assert.equal(JSON.parse(options.body).system, '기억 추출');
      return Response.json({ content: [{ type: 'text', text: '결과' }] });
    } }); assert.equal(r.statusCode, 200);
});
test('Gemini preserves contents and bounds generation tokens', async () => {
  const r = await run({ path: '/google/models/gemini-test:generateContent', headers: { 'x-goog-api-key': 'gemini-key' },
    input: { contents: [{ role: 'user', parts: [{ text: '입력' }] }], generationConfig: { maxOutputTokens: 100000 } },
    fetchImpl: async (url, options) => {
      assert.ok(!url.includes('gemini-key')); assert.equal(options.headers['x-goog-api-key'], 'gemini-key');
      assert.equal(JSON.parse(options.body).generationConfig.maxOutputTokens, 4096);
      return Response.json({ candidates: [] });
    } }); assert.equal(r.statusCode, 200);
});
test('model discovery is authenticated and uses current provider key', async () => {
  const r = await run({ path: '/openai/models', method: 'GET', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models'); assert.equal(options.body, undefined);
    return Response.json({ data: [{ id: 'available-model' }] });
  } }); assert.equal(r.body.data[0].id, 'available-model');
});
test('upstream failures expose no raw error, key or prompt', async () => {
  for (const status of [400, 401, 429, 500]) {
    const r = await run({ fetchImpl: async () => new Response('private provider detail', { status }) });
    assert.equal(r.statusCode, status === 500 ? 502 : status); assert.ok(!JSON.stringify(r.body).includes('private'));
  }
  assert.equal((await run({ fetchImpl: async () => { throw new DOMException('secret', 'TimeoutError'); } })).statusCode, 504);
});
