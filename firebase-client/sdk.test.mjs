import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyFetch } from './transport.mjs';

test('installed OpenAI, Anthropic, Groq and Gemini SDKs all use proxy transport', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = proxyFetch('https://proxy.example/haemaProxy', 'local-proxy-test-token-32-characters', async (url, options) => {
    seen.push(url);
    assert.equal(options.headers.get('x-haema-proxy-token'), 'local-proxy-test-token-32-characters');
    if (url.includes('/anthropic/')) {
      assert.equal(options.headers.get('x-api-key'), 'anthropic-test');
      return Response.json({ id: 'test', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (url.includes('/google/')) {
      assert.equal(options.headers.get('x-goog-api-key'), 'google-test');
      return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }] });
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] });
  });
  try {
    await import('@anthropic-ai/sdk/shims/web');
    await import('groq-sdk/shims/web');
    const { default: OpenAI } = await import('openai');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const { default: Groq } = await import('groq-sdk');
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const request = { model: 'fake', messages: [{ role: 'user', content: 'hi' }] };
    await new OpenAI({ apiKey: 'openai-test', maxRetries: 0 }).chat.completions.create(request);
    await new Anthropic({ apiKey: 'anthropic-test', maxRetries: 0 }).messages.create({ ...request, max_tokens: 20 });
    await new Groq({ apiKey: 'groq-test', maxRetries: 0 }).chat.completions.create(request);
    const result = await new GoogleGenerativeAI('google-test').getGenerativeModel({ model: 'gemini-test' }).generateContent('hi');
    assert.equal(result.response.text(), 'ok');
    assert.deepEqual(seen, [
      'https://proxy.example/haemaProxy/openai/chat/completions',
      'https://proxy.example/haemaProxy/anthropic/messages',
      'https://proxy.example/haemaProxy/groq/chat/completions',
      'https://proxy.example/haemaProxy/google/models/gemini-test:generateContent',
    ]);
  } finally { globalThis.fetch = original; }
});
