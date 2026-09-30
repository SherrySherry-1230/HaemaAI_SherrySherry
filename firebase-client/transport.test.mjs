import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyFetch } from './transport.mjs';
const token = 'local-proxy-test-token-32-characters';
test('URL key moves to header; proxy token is separate; no direct fallback', async () => {
  let calls = 0;
  const send = proxyFetch('https://example.cloudfunctions.net/haemaProxy', token, async (url, init) => {
    calls++;
    assert.equal(url, 'https://example.cloudfunctions.net/haemaProxy/google/models');
    assert.equal(init.headers.get('x-goog-api-key'), 'google-secret');
    assert.equal(init.headers.get('x-haema-proxy-token'), token);
    return Response.json({ models: [] });
  });
  await send('https://generativelanguage.googleapis.com/v1beta/models?key=google-secret');
  await assert.rejects(send('https://untrusted.example/v1/models'), /Unsupported/);
  assert.equal(calls, 1);
});
test('request bodies and user keys survive rerouting', async () => {
  const send = proxyFetch('https://example.cloudfunctions.net/haemaProxy', token, async (url, init) => {
    assert.equal(url, 'https://example.cloudfunctions.net/haemaProxy/openai/chat/completions');
    assert.equal(init.headers.get('authorization'), 'Bearer my-key'); assert.equal(init.body, '{"model":"chosen"}');
    return Response.json({});
  });
  await send(new Request('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer my-key' }, body: '{"model":"chosen"}' }));
});
test('unsafe proxy destination or short token fails at startup', () => {
  assert.throws(() => proxyFetch('http://example.com', token));
  assert.throws(() => proxyFetch('https://example.com?key=secret', token));
  assert.throws(() => proxyFetch('https://example.com', 'short'));
});

test('all eight provider model routes preserve their leading slash', async () => {
  const { providers } = await import('../functions/routes.mjs');
  for (const [provider, config] of Object.entries(providers)) {
    const send = proxyFetch('https://proxy.example/function', token, async (url) => {
      assert.equal(url, `https://proxy.example/function/${provider}/models`);
      return Response.json({});
    });
    await send(config.base + '/models');
  }
});
