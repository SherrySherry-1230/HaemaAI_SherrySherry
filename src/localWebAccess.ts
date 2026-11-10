// @editedBy SherrySherry 2026-11-10
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type LocalWebSession = Readonly<{
  id: string;
  origin: string;
  runtimeScope: string;
  expiresAt: number;
}>;

export type LocalWebAccessOptions = {
  webOrigin?: string;
  localHost: string | (() => string);
  runtimeScope: string | (() => string);
  sessionHeader: string;
  pairingPath: string;
  revocationPath?: string;
  revocationMethod?: 'POST' | 'DELETE';
  allowPath: (path: string, method: string) => boolean;
  allowNavigation?: (req: IncomingMessage) => boolean;
  allowedMethods?: readonly string[];
  allowedHeaders?: readonly string[];
  codeTtlMs?: number;
  sessionTtlMs?: number;
  maxPairingAttempts?: number;
  maxSessions?: number;
  maxPairingBodyBytes?: number;
  now?: () => number;
};

type PairingCode = { value: string; expiresAt: number; attempts: number; scope: string };
type SessionRecord = { token: string; context: LocalWebSession };

function opaque(): string { return randomBytes(32).toString('base64url'); }
function positive(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('INVALID_LOCAL_ACCESS_CONFIG');
  return value;
}
function exactHttpsOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new TypeError('INVALID_LOCAL_ACCESS_ORIGIN');
  }
  return value;
}
function canonicalPath(target: string | undefined): string | undefined {
  if (!target || !target.startsWith('/') || target.startsWith('//') || /[\\#\u0000-\u0020\u007f]/.test(target)) return;
  const path = target.split('?', 1)[0];
  const segments = path.split('/');
  try {
    for (let index = 1; index < segments.length; index++) {
      const segment = segments[index];
      if (!segment && index !== segments.length - 1) return;
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || /[%/\\\u0000-\u0020\u007f]/.test(decoded)) return;
      if (encodeURIComponent(decoded) !== segment) return;
    }
  } catch { return; }
  return path;
}
function loopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function rawHeadersValid(req: IncomingMessage): boolean {
  const seen = new Set<string>();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index].toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
  }
  return seen.has('host');
}
function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createLocalWebAccess(options: LocalWebAccessOptions) {
  const webOrigin = exactHttpsOrigin(options.webOrigin);
  function allowedHosts() {
    const host = typeof options.localHost === 'function' ? options.localHost() : options.localHost;
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):(?:[1-9]\d{0,4})$/.test(host)
        || Number(host.slice(host.lastIndexOf(':') + 1)) > 65535) throw new TypeError('INVALID_LOCAL_ACCESS_HOST');
    const port = host.slice(host.lastIndexOf(':') + 1);
    return new Set([host, `127.0.0.1:${port}`, `localhost:${port}`]);
  }
  if (typeof options.localHost === 'string') allowedHosts();
  if (canonicalPath(options.pairingPath) !== options.pairingPath) throw new TypeError('INVALID_LOCAL_ACCESS_PATH');
  if (options.revocationPath !== undefined && (canonicalPath(options.revocationPath) !== options.revocationPath
      || options.revocationPath === options.pairingPath)) throw new TypeError('INVALID_LOCAL_ACCESS_PATH');
  const revocationMethod = options.revocationMethod ?? 'DELETE';
  if (!['POST', 'DELETE'].includes(revocationMethod)) throw new TypeError('INVALID_LOCAL_ACCESS_METHOD');
  const methods = new Set(options.allowedMethods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  if ([...methods].some(method => !/^[A-Z]+$/.test(method) || ['OPTIONS', 'TRACE', 'CONNECT'].includes(method))) {
    throw new TypeError('INVALID_LOCAL_ACCESS_METHOD');
  }
  const sessionHeader = options.sessionHeader;
  const reservedHeaders = ['origin', 'host', 'cookie', 'authorization', 'content-length', 'transfer-encoding', 'connection', 'upgrade'];
  if (!/^[a-z][a-z0-9-]*$/.test(sessionHeader) || reservedHeaders.includes(sessionHeader)
      || sessionHeader === 'content-type' || sessionHeader.startsWith('sec-') || sessionHeader.startsWith('access-control-')) {
    throw new TypeError('INVALID_LOCAL_ACCESS_HEADER');
  }
  const allowedHeaders = new Set(['content-type', sessionHeader, ...(options.allowedHeaders ?? []).map(name => name.toLowerCase())]);
  if ([...allowedHeaders].some(name => !/^[a-z0-9-]+$/.test(name)
      || reservedHeaders.includes(name) || name.startsWith('sec-') || name.startsWith('access-control-'))) {
    throw new TypeError('INVALID_LOCAL_ACCESS_HEADER');
  }
  const now = options.now ?? Date.now;
  const codeTtl = positive(options.codeTtlMs, 60_000);
  const sessionTtl = positive(options.sessionTtlMs, 30 * 60_000);
  const maxAttempts = positive(options.maxPairingAttempts, 5);
  const maxSessions = positive(options.maxSessions, 16);
  const bodyLimit = positive(options.maxPairingBodyBytes, 1024);
  const scope = () => {
    const value = typeof options.runtimeScope === 'function' ? options.runtimeScope() : options.runtimeScope;
    if (typeof value !== 'string' || !value || value.length > 1024) throw new TypeError('INVALID_LOCAL_ACCESS_SCOPE');
    return value;
  };
  scope();
  let closed = false;
  let pairingCode: PairingCode | undefined;
  const tokens = new Map<string, SessionRecord>();
  const sessions = new Map<string, SessionRecord>();
  const authorized = new WeakMap<IncomingMessage, LocalWebSession | null>();

  function isSessionActive(id: string): boolean {
    const record = sessions.get(id);
    if (!record) return false;
    let valid = false;
    try { valid = !closed && record.context.expiresAt > now() && record.context.runtimeScope === scope(); } catch { /* fail closed */ }
    if (!valid) { sessions.delete(id); tokens.delete(record.token); }
    return valid;
  }
  function prune() { for (const id of sessions.keys()) isSessionActive(id); }
  function revokeAll() { pairingCode = undefined; sessions.clear(); tokens.clear(); }
  function close() { closed = true; revokeAll(); }
  function issuePairingCode(): string {
    if (closed || !webOrigin) throw new Error('LOCAL_WEB_ACCESS_DISABLED');
    pairingCode = { value: opaque(), expiresAt: now() + codeTtl, attempts: 0, scope: scope() };
    return pairingCode.value;
  }
  function sessionFor(req: IncomingMessage): LocalWebSession | undefined {
    const context = authorized.get(req);
    return context && isSessionActive(context.id) ? context : undefined;
  }
  function isRequestActive(req: IncomingMessage): boolean {
    if (!authorized.has(req)) return false;
    const context = authorized.get(req);
    return context === null || (context !== undefined && isSessionActive(context.id));
  }
  function cors(res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', webOrigin!);
    res.setHeader('Vary', 'Origin');
  }
  function permittedPath(path: string, method: string) {
    if (path === options.pairingPath) return method === 'POST';
    if (path === options.revocationPath) return method === revocationMethod;
    return options.allowPath(path, method);
  }
  function reply(res: ServerResponse, status: number, code: string) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Pragma': 'no-cache' });
    res.end(JSON.stringify({ error: code }));
    return true;
  }
  async function readPairingCode(req: IncomingMessage): Promise<string> {
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('PAIRING_JSON_REQUIRED');
    const declared = req.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > bodyLimit)) throw new Error('PAIRING_BODY_LIMIT');
    const body = await new Promise<Buffer>((resolve, reject) => {
      let bytes = 0;
      const chunks: Buffer[] = [];
      function clean() { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort); }
      function fail(message: string) { clean(); req.resume(); reject(new Error(message)); }
      function onData(chunk: Buffer) {
        bytes += chunk.length;
        if (bytes > bodyLimit) return fail('PAIRING_BODY_LIMIT');
        chunks.push(chunk);
      }
      function onEnd() { clean(); resolve(Buffer.concat(chunks)); }
      function onError() { fail('PAIRING_BODY_INVALID'); }
      function onAbort() { fail('PAIRING_BODY_INVALID'); }
      req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAbort);
    });
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { throw new Error('PAIRING_BODY_INVALID'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'code')
        || typeof (parsed as {code: unknown}).code !== 'string'
        || !/^[A-Za-z0-9_-]{43}$/.test((parsed as {code: string}).code)) throw new Error('PAIRING_BODY_INVALID');
    return (parsed as {code: string}).code;
  }
  async function exchange(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const candidate = pairingCode;
    let supplied: string;
    try { supplied = await readPairingCode(req); }
    catch (error) {
      req.resume();
      const code = error instanceof Error ? error.message : 'PAIRING_BODY_INVALID';
      return reply(res, code === 'PAIRING_BODY_LIMIT' ? 413 : code === 'PAIRING_JSON_REQUIRED' ? 415 : 400, code);
    }
    // Check the same pending code after asynchronous body consumption; a newer issue cancels it.
    let currentScope: string;
    try { currentScope = scope(); } catch { return reply(res, 503, 'LOCAL_WEB_ACCESS_UNAVAILABLE'); }
    if (closed || !candidate || candidate !== pairingCode || candidate.expiresAt <= now()
        || candidate.scope !== currentScope || candidate.attempts >= maxAttempts) {
      if (candidate === pairingCode) pairingCode = undefined;
      return reply(res, 401, 'PAIRING_REJECTED');
    }
    candidate.attempts += 1;
    if (!equalSecret(supplied, candidate.value)) {
      if (candidate.attempts >= maxAttempts) pairingCode = undefined;
      return reply(res, 401, 'PAIRING_REJECTED');
    }
    pairingCode = undefined;
    prune();
    if (sessions.size >= maxSessions) return reply(res, 429, 'LOCAL_WEB_SESSION_LIMIT');
    const token = opaque();
    const context = Object.freeze({ id: opaque(), origin: webOrigin!, runtimeScope: currentScope, expiresAt: now() + sessionTtl });
    const record = { token, context };
    sessions.set(context.id, record); tokens.set(token, record);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Pragma': 'no-cache' });
    res.end(JSON.stringify({ token, expiresAt: context.expiresAt }));
    return true;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    authorized.delete(req);
    const path = canonicalPath(req.url);
    let hosts: Set<string>;
    try { hosts = allowedHosts(); } catch { return reply(res, 503, 'LOCAL_WEB_ACCESS_UNAVAILABLE'); }
    if (!loopback(req.socket.remoteAddress) || !rawHeadersValid(req) || !hosts.has(req.headers.host ?? '') || !path) {
      return reply(res, 400, 'LOCAL_REQUEST_REJECTED');
    }
    const origin = req.headers.origin;
    const localOrigin = `http://${req.headers.host}`;
    const site = req.headers['sec-fetch-site'];
    const crossSite = site !== undefined && !['same-origin', 'none'].includes(String(site));
    if ((origin === undefined || origin === localOrigin) && !crossSite) {
      authorized.set(req, null);
      return false;
    }
    if (origin === undefined && req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate'
        && options.allowNavigation?.(req) === true) {
      authorized.set(req, null);
      return false;
    }
    if (closed || !webOrigin || origin !== webOrigin) return reply(res, 403, 'WEB_ORIGIN_REJECTED');
    cors(res);
    const method = req.method ?? '';
    if (method === 'OPTIONS') {
      const requestedMethod = req.headers['access-control-request-method'];
      const requestedHeaders = req.headers['access-control-request-headers'];
      const privateNetwork = req.headers['access-control-request-private-network'];
      const headerNames = requestedHeaders === undefined ? [] : String(requestedHeaders).split(',').map(name => name.trim().toLowerCase());
      const permittedMethod = typeof requestedMethod === 'string' && methods.has(requestedMethod);
      const pathAllowed = permittedMethod && permittedPath(path, requestedMethod);
      if (!pathAllowed || headerNames.some(name => !allowedHeaders.has(name)) || new Set(headerNames).size !== headerNames.length
          || (privateNetwork !== undefined && privateNetwork !== 'true')) {
        return reply(res, 403, 'WEB_PREFLIGHT_REJECTED');
      }
      res.writeHead(204, {
        'Access-Control-Allow-Methods': requestedMethod!,
        ...(headerNames.length ? { 'Access-Control-Allow-Headers': headerNames.join(', ') } : {}),
        ...(privateNetwork === 'true' ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
        'Access-Control-Max-Age': '60',
        'Cache-Control': 'no-store',
        'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      });
      res.end(); return true;
    }
    if (!methods.has(method) || !permittedPath(path, method)) {
      return reply(res, 403, 'WEB_PATH_REJECTED');
    }
    if (path === options.pairingPath) return exchange(req, res);
    const token = req.headers[sessionHeader];
    const record = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? tokens.get(token) : undefined;
    if (!record || !isSessionActive(record.context.id)) return reply(res, 401, 'LOCAL_WEB_SESSION_REQUIRED');
    if (path === options.revocationPath) {
      sessions.delete(record.context.id); tokens.delete(record.token);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ disconnected: true }));
      return true;
    }
    authorized.set(req, record.context);
    return false;
  }

  return Object.freeze({ handle, sessionFor, isRequestActive, issuePairingCode, revokeAll, close, isSessionActive });
}
