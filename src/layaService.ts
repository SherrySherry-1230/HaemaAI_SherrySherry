// @editedBy SherrySherry 2026-10-31
/** UI와 별개로 실행할 수 있는 로컬 관찰 서비스. OS 자동 시작 등록은 수행하지 않는다. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { LayaRuntime } from './layaRuntime.ts';
import { LayaDecisionEngine } from './decision/layaDecisionEngine.ts';
import { createLayaHttpHandler, createStaticLayaSessionResolver } from './layaHttp.ts';

export async function startLayaService(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name];
    if (!value?.trim()) throw new TypeError(`Required setting: ${name}`);
    return value;
  };
  const port = Number(env.HAEMA_LAYA_PORT ?? 7881);
  const intervalMs = Number(env.HAEMA_LAYA_REFLECTION_INTERVAL_MS ?? 30_000);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid HAEMA_LAYA_PORT');
  if (!Number.isSafeInteger(intervalMs) || intervalMs !== 0 && (intervalMs < 10_000 || intervalMs > 3_600_000)) {
    throw new TypeError('Invalid HAEMA_LAYA_REFLECTION_INTERVAL_MS');
  }
  const device = env.HAEMA_LAYA_DEVICE ?? 'cpu';
  if (!['cpu', 'mps', 'cuda'].includes(device)) throw new TypeError('Invalid HAEMA_LAYA_DEVICE');
  const ownerId = required('HAEMA_LAYA_OWNER_ID'), hostChatbotId = required('HAEMA_LAYA_HOST_ID');
  const accessToken = required('HAEMA_LAYA_ACCESS_TOKEN');
  if (accessToken.length > 4096 || /[\s\u0000-\u001f\u007f-\u009f]/u.test(accessToken)) {
    throw new TypeError('Invalid HAEMA_LAYA_ACCESS_TOKEN');
  }
  const runtime = new LayaRuntime({ memoryRoot: required('HAEMA_DATA_DIR'), ownerId, hostChatbotId,
    retainText: env.HAEMA_LAYA_RETAIN_TEXT === '1', engine: new LayaDecisionEngine({
      pythonCommand: env.HAEMA_LAYA_PYTHON_COMMAND, enginePath: env.HAEMA_LAYA_ENGINE_PATH,
      checkpointPath: env.HAEMA_LAYA_CHECKPOINT, device: device as 'cpu' | 'mps' | 'cuda',
    }) });
  const handle = createLayaHttpHandler({ resolveSession: createStaticLayaSessionResolver({
    ownerId, hostChatbotId, storageId: runtime.storageId, accessToken, backend: runtime,
  }) });
  const server = createServer((request, response) => {
    void handle(request, response).then(handled => {
      if (!handled) { response.writeHead(404); response.end(); }
    }).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const shutdown = new AbortController();
  let working = false;
  const opportunity = async () => {
    if (working || shutdown.signal.aborted || runtime.engine.getStatus().state !== 'ready') return;
    working = true;
    try { await runtime.runReflectionOpportunity({ budgetMs: 15000 }, shutdown.signal); }
    catch { /* 대기/실패는 큐에 보존한다. 원문이나 인증 정보를 로그에 출력하지 않는다. */ }
    finally { working = false; }
  };
  const timer = intervalMs ? setInterval(() => { void opportunity(); }, intervalMs) : undefined;
  const awake = runtime.awake();
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= (async () => {
    shutdown.abort(); if (timer) clearInterval(timer);
    try { await runtime.close(); }
    finally {
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    }
  })();
  return { server, runtime, awake, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const service = await startLayaService();
    const address = service.server.address();
    if (address && typeof address === 'object') console.log(`Laya observation service: http://127.0.0.1:${address.port}`);
    void service.awake.then(status => console.log(`Laya worker: ${status.state}`));
    const stop = () => { void service.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) {
    console.error(error instanceof TypeError ? error.message : 'Laya service startup failed'); process.exitCode = 1;
  }
}
