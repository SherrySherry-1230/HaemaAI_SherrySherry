// @editedBy SherrySherry 2026-10-31
/** 인증된 저장소·사용자·호스트 문맥에만 연결하는 선택적 Laya HTTP 경계. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Awaitable<T> = T | Promise<T>;
export type LayaHttpBody = Record<string, unknown>;

/** 구현은 세션에 고정된 범위를 사용한다. 본문의 식별자가 인증을 대신하지 않는다. */
export interface LayaHttpBackend {
  status(signal?: AbortSignal): Awaitable<unknown>;
  conversation(conversationId: string, signal?: AbortSignal): Awaitable<unknown>;
  registerTurns(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
  hostDraft(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
  hostResponse(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
  feedback(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
  listReflections(signal?: AbortSignal): Awaitable<unknown>;
  enqueueReflection(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
  runReflectionOpportunity(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
  cancelReflection(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
  resumeReflection(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
  setReflectionEnabled(body: LayaHttpBody, signal?: AbortSignal): Awaitable<unknown>;
}

export interface LayaHttpSession {
  storageId: string;
  ownerId: string;
  hostChatbotId: string;
  backend: LayaHttpBackend;
}

export type LayaHttpSessionResolver = (request: IncomingMessage) => Awaitable<LayaHttpSession | null>;

export class LayaHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'LayaHttpError';
    this.status = status;
    this.code = code;
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

/** 설정이 없으면 503, 인증이 맞지 않으면 null이다. 토큰을 파일·로그·응답에 넣지 않는다. */
export function createStaticLayaSessionResolver(
  options: Partial<LayaHttpSession> & { accessToken?: string },
): LayaHttpSessionResolver {
  const configured = validIdentifier(options.ownerId) && validIdentifier(options.hostChatbotId)
    && validIdentifier(options.storageId) && !!options.backend
    && typeof options.accessToken === 'string' && options.accessToken.length > 0
    && options.accessToken.length <= 4096 && options.accessToken === options.accessToken.trim()
    && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(options.accessToken);
  const digest = configured ? createHash('sha256').update(options.accessToken!).digest() : undefined;
  const session = configured ? {
    storageId: options.storageId!, ownerId: options.ownerId!,
    hostChatbotId: options.hostChatbotId!, backend: options.backend!,
  } : undefined;
  return request => {
    if (!session || !digest) throw new LayaHttpError(503, 'LAYA_NOT_CONFIGURED');
    const headers = request.rawHeaders;
    let count = 0;
    for (let i = 0; i < headers.length; i += 2) if (headers[i].toLowerCase() === 'authorization') count++;
    const match = typeof request.headers.authorization === 'string'
      ? /^Bearer ([^\s]+)$/iu.exec(request.headers.authorization) : null;
    if (!match || count !== 1 || match[1].length > 4096) return null;
    const supplied = createHash('sha256').update(match[1]).digest();
    return timingSafeEqual(digest, supplied) ? session : null;
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertScope(values: Record<string, unknown>, session: LayaHttpSession): void {
  for (const key of ['ownerId', 'hostChatbotId', 'storageId'] as const) {
    if (Object.hasOwn(values, key) && values[key] !== session[key]) {
      throw new LayaHttpError(key === 'storageId' ? 409 : 403,
        key === 'storageId' ? 'LAYA_STORAGE_CONFLICT' : 'LAYA_SCOPE_FORBIDDEN');
    }
  }
  // 내부 scope 객체를 받는 호출도 세션과 대조한다. 피드백의 문자열 scope는 별도 의미다.
  if (object(values.scope)) {
    for (const key of ['ownerId', 'hostChatbotId', 'storageId'] as const) {
      if (Object.hasOwn(values.scope, key) && values.scope[key] !== session[key]) {
        throw new LayaHttpError(key === 'storageId' ? 409 : 403,
          key === 'storageId' ? 'LAYA_STORAGE_CONFLICT' : 'LAYA_SCOPE_FORBIDDEN');
      }
    }
  }
}

function abortError(): LayaHttpError { return new LayaHttpError(499, 'LAYA_REQUEST_ABORTED'); }

function readBody(request: IncomingMessage, signal: AbortSignal, maximum: number): Promise<LayaHttpBody> {
  if (signal.aborted) return Promise.reject(abortError());
  const encoding = request.headers['content-encoding'];
  if (encoding && encoding !== 'identity') return Promise.reject(new LayaHttpError(415, 'LAYA_UNSUPPORTED_ENCODING'));
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|\s*$)/iu.test(contentType)) {
    return Promise.reject(new LayaHttpError(415, 'LAYA_JSON_REQUIRED'));
  }
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) {
    request.resume();
    return Promise.reject(new LayaHttpError(413, 'LAYA_REQUEST_TOO_LARGE'));
  }
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const clean = () => {
      request.off('data', data); request.off('end', end); request.off('error', fail);
      signal.removeEventListener('abort', aborted);
    };
    const fail = (error: unknown) => { clean(); reject(error); };
    const aborted = () => fail(abortError());
    const data = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maximum) {
        fail(new LayaHttpError(413, 'LAYA_REQUEST_TOO_LARGE'));
        request.resume();
      } else chunks.push(buffer);
    };
    const end = () => {
      clean();
      try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!object(value) || ['__proto__', 'prototype', 'constructor'].some(key => Object.hasOwn(value, key))) {
          throw new TypeError('A JSON object is required');
        }
        resolve(value);
      } catch { reject(new LayaHttpError(400, 'LAYA_INVALID_JSON')); }
    };
    request.on('data', data); request.once('end', end); request.once('error', fail);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function withAbort<T>(operation: Awaitable<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    if (signal.aborted) { void Promise.resolve(operation).catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function errorResponse(error: unknown): { status: number; code: string } {
  if (error instanceof LayaHttpError && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    && /^LAYA_[A-Z_]{1,48}$/u.test(error.code)) return { status: error.status, code: error.code };
  if (error instanceof TypeError) return { status: 400, code: 'LAYA_INVALID_INPUT' };
  const code = object(error) && typeof error.code === 'string' ? error.code : undefined;
  if (code === 'invalid') return { status: 400, code: 'LAYA_INVALID_INPUT' };
  if (['conflict', 'locked', 'stale', 'stale_lease', 'id_conflict'].includes(code ?? '')) {
    return { status: 409, code: 'LAYA_CONFLICT' };
  }
  if (['forbidden', 'unauthorized', 'scope_mismatch'].includes(code ?? '')) return { status: 403, code: 'LAYA_SCOPE_FORBIDDEN' };
  if (code === 'not_found') return { status: 404, code: 'LAYA_NOT_FOUND' };
  if (['unavailable', 'corrupt', 'timeout', 'disabled'].includes(code ?? '')) return { status: 503, code: 'LAYA_UNAVAILABLE' };
  return { status: 500, code: 'LAYA_REQUEST_FAILED' };
}

const POST_ROUTES: Record<string, keyof Pick<LayaHttpBackend,
  'registerTurns' | 'hostDraft' | 'hostResponse' | 'feedback' | 'enqueueReflection' | 'runReflectionOpportunity'
  | 'cancelReflection' | 'resumeReflection' | 'setReflectionEnabled'>> = {
  '/api/laya/host-draft': 'hostDraft', '/api/laya/host-response': 'hostResponse',
  '/api/laya/turns': 'registerTurns',
  '/api/laya/feedback': 'feedback', '/api/laya/reflections': 'enqueueReflection',
  '/api/laya/reflections/opportunity': 'runReflectionOpportunity',
  '/api/laya/reflections/cancel': 'cancelReflection', '/api/laya/reflections/resume': 'resumeReflection',
  '/api/laya/reflections/enabled': 'setReflectionEnabled',
};

/** 모르는 /api/laya 경로는 404이며 그 밖의 요청은 false로 호출 서버에 돌려준다. */
export function createLayaHttpHandler(options: {
  resolveSession: LayaHttpSessionResolver;
  maxBodyBytes?: number;
}): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  const maximum = options.maxBodyBytes ?? 256 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 256 * 1024) {
    throw new TypeError('Laya HTTP body limit must be between 1 and 262144 bytes');
  }
  return async (request, response) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); } catch { return false; }
    if (url.pathname !== '/api/laya' && !url.pathname.startsWith('/api/laya/')) return false;
    response.removeHeader('Access-Control-Allow-Origin');
    response.removeHeader('Access-Control-Allow-Headers');
    response.removeHeader('Access-Control-Allow-Methods');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const controller = new AbortController();
    const abort = () => controller.abort();
    const disconnected = () => { if (!response.writableEnded) abort(); };
    request.once('aborted', abort); response.once('close', disconnected);
    const send = (status: number, value: unknown) => {
      if (!controller.signal.aborted && !response.destroyed && !response.writableEnded) {
        const json = JSON.stringify(value ?? null);
        response.writeHead(status); response.end(json);
      }
    };
    try {
      const session = await withAbort(options.resolveSession(request), controller.signal);
      if (!session) throw new LayaHttpError(401, 'LAYA_UNAUTHORIZED');
      if (![session.ownerId, session.hostChatbotId, session.storageId].every(validIdentifier) || !session.backend) {
        throw new LayaHttpError(503, 'LAYA_NOT_CONFIGURED');
      }
      const query = Object.fromEntries(url.searchParams);
      for (const key of ['ownerId', 'hostChatbotId', 'storageId']) {
        if (url.searchParams.getAll(key).length > 1) throw new LayaHttpError(400, 'LAYA_INVALID_INPUT');
      }
      assertScope(query, session);
      let result: unknown;
      if (request.method === 'GET' && url.pathname === '/api/laya/status') {
        result = await withAbort(session.backend.status(controller.signal), controller.signal);
      } else if (request.method === 'GET' && url.pathname === '/api/laya/conversation') {
        const id = url.searchParams.get('conversationId');
        if (!validIdentifier(id) || url.searchParams.getAll('conversationId').length !== 1) {
          throw new LayaHttpError(400, 'LAYA_INVALID_INPUT');
        }
        result = await withAbort(session.backend.conversation(id, controller.signal), controller.signal);
      } else if (request.method === 'GET' && url.pathname === '/api/laya/reflections') {
        result = await withAbort(session.backend.listReflections(controller.signal), controller.signal);
      } else if (request.method === 'POST' && Object.hasOwn(POST_ROUTES, url.pathname)) {
        const body = await readBody(request, controller.signal, maximum);
        assertScope(body, session);
        controller.signal.throwIfAborted();
        result = await withAbort(session.backend[POST_ROUTES[url.pathname]](body, controller.signal), controller.signal);
      } else {
        const known = Object.hasOwn(POST_ROUTES, url.pathname)
          || ['/api/laya/status', '/api/laya/conversation'].includes(url.pathname);
        throw new LayaHttpError(known ? 405 : 404, known ? 'LAYA_METHOD_NOT_ALLOWED' : 'LAYA_NOT_FOUND');
      }
      send(object(result) && result.status === 'conflict' ? 409 : 200, result);
    } catch (error) {
      const failure = errorResponse(error);
      send(failure.status, { success: false, code: failure.code });
    } finally {
      request.off('aborted', abort); response.off('close', disconnected);
      if (!request.complete && !request.destroyed) request.resume();
    }
    return true;
  };
}
