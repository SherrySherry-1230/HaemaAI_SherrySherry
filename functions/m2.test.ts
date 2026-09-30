// @editedBy SherrySherry 2026-09-24
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createProxy } from './proxy.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverPath = join(repoRoot, 'local-server', 'server.ts');

async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

test('M2: local server calls authenticated proxy, stores JJums and returns host preview', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'haema-server-smoke-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const configDir = join(temp, 'config');
  const storageParent = join(temp, 'storage');
  let upstreamCalls = 0;
  const forwardedKeys: string[] = [];
  const proxyToken = 'local-proxy-test-token-32-characters';
  const handler = createProxy({ token: proxyToken, fetchImpl: async (url, options) => {
      upstreamCalls++;
      forwardedKeys.push(options.headers.authorization || options.headers['x-api-key'] || options.headers['x-goog-api-key']);
      if (options.method === 'GET') return Response.json(url.includes('googleapis') ? { models: [{ name: 'models/fake' }] } : { data: [{ id: 'fake' }] });
      const request = JSON.parse(options.body);
      const system = request.system || request.systemInstruction?.parts?.[0]?.text || request.messages?.[0]?.content || '';
      const content = system.includes('추출하는 AI')
        ? JSON.stringify([{ jjumName: '테스트 기억', type: 'event', aliases: [], tags: ['테스트'],
            factTexts: ['로컬 테스트 사실'], relatedNames: [] }]) : '로컬 테스트 요약';
      if (url.includes('anthropic')) return Response.json({ id: 'test', type: 'message', role: 'assistant', content: [{ type: 'text', text: content }], usage: { input_tokens: 1, output_tokens: 1 } });
      if (url.includes('googleapis')) return Response.json({ candidates: [{ content: { parts: [{ text: content }], role: 'model' }, finishReason: 'STOP' }] });
      return Response.json({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] });
    } });
  const localProvider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    await handler({ path: req.url, method: req.method, body: raw ? JSON.parse(raw) : undefined,
      get: (key) => req.headers[key], is: () => req.headers['content-type']?.includes('application/json') }, {
      set(key, value) { res.setHeader(key, value); return this; },
      status(code) { res.statusCode = code; return this; },
      json(data) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return this; },
    });
  });
  await new Promise<void>((resolve) => localProvider.listen(0, '127.0.0.1', resolve));
  t.after(() => localProvider.close());
  const providerAddress = localProvider.address();
  assert.ok(providerAddress && typeof providerAddress !== 'string');

  const port = await unusedPort();
  const child = spawn(process.execPath, ['--import', './firebase-client/register.mjs', '--disable-warning=ExperimentalWarning', '--experimental-strip-types', serverPath], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), HAEMA_CONFIG_DIR: configDir,
      HAEMA_PROXY_URL: `http://127.0.0.1:${providerAddress.port}`, HAEMA_PROXY_TOKEN: proxyToken,
      HAEMA_DATA_DIR: join(temp, 'unused-default'), HAEMA_LAYA_ENABLED: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => child.kill('SIGTERM'));
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/api/storage/status`);
      if (response.ok) { ready = true; break; }
    } catch { /* process starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, `isolated server failed to start: ${stderr}`);

  const request = async (path: string, body?: unknown, method = 'GET') => {
    const response = await fetch(`${base}${path}`, { method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };

  const initial = await request('/api/storage/status');
  assert.equal(initial.data.connected, false);
  assert.equal((await request('/api/owners/demo/jjums')).data.jjums.length, 0);
  assert.equal((await request('/api/owners/demo/jjums', { jjumName: '차단' }, 'POST')).status, 409);
  assert.equal((await fetch(`${base}/local-server/server.ts`)).status, 404);
  assert.equal((await fetch(`${base}/index.html`)).status, 200);

  const createdStore = await request('/api/storage/init', { storageRoot: storageParent }, 'POST');
  assert.equal(createdStore.status, 200);
  assert.equal(createdStore.data.connected, true);
  const firstRoot: string = createdStore.data.storageRoot;
  assert.equal((await request('/api/storage/status')).data.storageRoot, firstRoot);

  const created = await request('/api/owners/demo/jjums', { jjumName: '수동 기억', summary: '처음' }, 'POST');
  assert.equal(created.status, 201);
  const id = created.data.jjum.jjumId;
  assert.equal(created.data.jjum.schemaVersion, 4);
  const edited = await request(`/api/owners/demo/jjums/${id}`, { jjumId: 'forged', ownerId: 'other', summary: '수정됨' }, 'PATCH');
  assert.equal(edited.status, 200);
  assert.equal(edited.data.jjum.jjumId, id);
  assert.equal(edited.data.jjum.ownerId, 'demo');
  assert.equal((await request('/api/owners/demo/search?q=%EC%88%98%EC%A0%95%EB%90%A8')).data.results.length, 1);
  assert.deepEqual((await request('/api/owners')).data.owners, ['demo']);

  const probe = await request('/api/storage/init', { storageRoot: storageParent }, 'POST');
  assert.equal(probe.data.exists, true);
  assert.equal((await request('/api/storage/status')).data.storageRoot, firstRoot);
  const second = await request('/api/storage/init', { storageRoot: firstRoot, forceCreate: true }, 'POST');
  assert.equal(second.data.connected, true);
  assert.match(second.data.storageRoot, /_2$/);
  assert.equal((await request('/api/owners/demo/jjums')).data.jjums.length, 0);
  const reconnected = await request('/api/storage/init', { storageRoot: firstRoot, connectExisting: true }, 'POST');
  assert.equal(reconnected.data.connected, true);
  assert.equal((await request('/api/owners/demo/jjums')).data.jjums.length, 1);

  const savedConfig = await request('/api/config/save', { provider: 'openai', model: 'fake', apiKey: 'mock-upstream-key',
    baseUrl: 'https://api.upstage.ai/v1/solar' }, 'POST');
  assert.equal(savedConfig.status, 200);
  assert.equal((await request('/api/config/status')).data.configured, true);
  const processed = await request('/api/conversation', { ownerId: 'demo',
    turns: [{ role: 'user', text: '테스트 기억', at: Date.now() }], cues: ['테스트 기억'] }, 'POST');
  assert.equal(processed.status, 200, JSON.stringify(processed.data));
  assert.equal(processed.data.success, true);
  assert.ok(upstreamCalls >= 2);
  assert.ok(processed.data.hostPreview.candidates.length > 0);
  assert.ok(processed.data.hostPreview.guide);
  assert.ok(Array.isArray(processed.data.hostPreview.topics));
  assert.equal(processed.data.extraction.storedCount, 1);
  assert.equal((await request('/api/owners/demo/jjums')).data.jjums.length, 2);
  assert.equal(readdirSync(join(second.data.storageRoot, '🪣쩜통🪣')).filter((name) => name.endsWith('.jj')).length, 0);
  // 웹콘솔과 같은 설정 API로 제공자·키를 바꾸고 모델 조회 및 대화를 반복한다.
  for (const provider of ['openai', 'anthropic', 'google', 'groq']) {
    const selectedKey = `test-${provider}-key`;
    const validation = await request('/api/provider/models', { provider, apiKey: selectedKey }, 'POST');
    assert.equal(validation.status, 200, JSON.stringify(validation.data));
    const saved = await request('/api/config/save', { provider, apiKey: selectedKey, model: 'fake' }, 'POST');
    assert.equal(saved.status, 200);
    const next = await request('/api/conversation', { ownerId: 'demo',
      turns: [{ role: 'user', text: '테스트 기억을 다시 언급', at: Date.now() }], cues: ['테스트 기억'] }, 'POST');
    assert.equal(next.status, 200, JSON.stringify(next.data));
    assert.ok(next.data.hostPreview.candidates.length > 0);
    assert.ok(forwardedKeys.slice(-2).every(key => key === selectedKey || key === `Bearer ${selectedKey}`));
  }
  assert.equal((await request('/api/config', undefined, 'DELETE')).data.success, true);
  assert.equal((await request('/api/config/status')).data.configured, false);
  assert.equal((await request('/api/owners/demo/jjums')).data.jjums.length, 2);
});
