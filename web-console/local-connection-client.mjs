// @editedBy SherrySherry 2026-11-10
const CODE = /^[A-Za-z0-9_-]{43}$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RESERVED = new Set(['authorization', 'cookie', 'host', 'origin', 'content-type', 'content-length', 'connection', 'transfer-encoding', 'upgrade']);
const DESCRIPTOR_FIELDS = ['version', 'baseUrl', 'webOrigin', 'pairingPath', 'revocationPath', 'revocationMethod', 'sessionHeader'];
const OPTIONAL_FIELDS = ['requestPath', 'eventsPath'];

export class LocalConnectionError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'LocalConnectionError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}
const fail = (code, status) => new LocalConnectionError(code, status);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function pathAndQuery(value, queryAllowed = false) {
  if (typeof value !== 'string' || value.length > 16_384 || !value.startsWith('/') || value.startsWith('//')
      || /[\\#\u0000-\u0020\u007f]/.test(value) || (!queryAllowed && value.includes('?'))) throw fail('INVALID_LOCAL_PATH');
  const path = value.split('?', 1)[0];
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index];
    if (!part && index !== parts.length - 1) throw fail('INVALID_LOCAL_PATH');
    let decoded;
    try { decoded = decodeURIComponent(part); } catch { throw fail('INVALID_LOCAL_PATH'); }
    if (decoded === '.' || decoded === '..' || /[%/\\\u0000-\u0020\u007f]/.test(decoded)
        || encodeURIComponent(decoded) !== part) throw fail('INVALID_LOCAL_PATH');
  }
  if (queryAllowed && value.includes('?')) {
    const query = value.slice(value.indexOf('?') + 1);
    try {
      if (/[\u0000-\u001f\u007f]/.test(decodeURIComponent(query))) throw new Error();
    } catch { throw fail('INVALID_LOCAL_PATH'); }
  }
  return value;
}

export function validateConnectionDescriptor(value, currentOrigin = globalThis.location?.origin) {
  if (!object(value) || DESCRIPTOR_FIELDS.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => ![...DESCRIPTOR_FIELDS, ...OPTIONAL_FIELDS].includes(key)) || value.version !== 1) {
    throw fail('INVALID_CONNECTION_DESCRIPTOR');
  }
  let base, web;
  try { base = new URL(value.baseUrl); web = new URL(value.webOrigin); } catch { throw fail('INVALID_CONNECTION_DESCRIPTOR'); }
  if (typeof value.baseUrl !== 'string' || base.origin !== value.baseUrl
      || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value.baseUrl) || !base.port || Number(base.port) > 65535
      || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw fail('INVALID_LOCAL_ADDRESS');
  if (web.protocol !== 'https:' || web.origin !== value.webOrigin || web.username || web.password
      || currentOrigin !== value.webOrigin) throw fail('INVALID_WEB_ORIGIN');
  for (const key of ['pairingPath', 'revocationPath', ...OPTIONAL_FIELDS]) {
    if (Object.hasOwn(value, key)) pathAndQuery(value[key]);
  }
  const paths = ['pairingPath', 'revocationPath', ...OPTIONAL_FIELDS].filter(key => Object.hasOwn(value, key)).map(key => value[key]);
  if (new Set(paths).size !== paths.length || !['POST', 'DELETE'].includes(value.revocationMethod)) throw fail('INVALID_CONNECTION_DESCRIPTOR');
  if (typeof value.sessionHeader !== 'string' || !/^[a-z][a-z0-9-]{0,127}$/.test(value.sessionHeader)
      || RESERVED.has(value.sessionHeader) || value.sessionHeader.startsWith('sec-') || value.sessionHeader.startsWith('access-control-')) {
    throw fail('INVALID_CONNECTION_HEADER');
  }
  return Object.freeze({ ...value });
}

/** Consume the explicitly supplied fragment without writing credentials to persistent storage. */
export function consumeConnectionFragment({ location = globalThis.location, history = globalThis.history } = {}) {
  if (!location || !history || typeof history.replaceState !== 'function') throw fail('CONNECTION_LOCATION_UNAVAILABLE');
  const marker = '#local-connection=';
  if (!location.hash?.startsWith(marker)) return null;
  const encoded = location.hash.slice(marker.length);
  // Remove even malformed fragments before parsing; they may contain sensitive input.
  try { history.replaceState(history.state, '', location.pathname + location.search); }
  catch { throw fail('CONNECTION_FRAGMENT_NOT_CLEARED'); }
  if (!/^[A-Za-z0-9_-]{1,8192}$/.test(encoded)) throw fail('INVALID_CONNECTION_FRAGMENT');
  let envelope;
  try {
    const binary = globalThis.atob(encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encoded.length % 4) % 4));
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
  } catch { throw fail('INVALID_CONNECTION_FRAGMENT'); }
  if (!object(envelope) || Object.keys(envelope).sort().join(',') !== 'code,descriptor'
      || typeof envelope.code !== 'string' || !CODE.test(envelope.code)) {
    throw fail('INVALID_CONNECTION_FRAGMENT');
  }
  return { descriptor: validateConnectionDescriptor(envelope.descriptor, location.origin), code: envelope.code };
}

export function createLocalConnectionClient(input, options = {}) {
  const descriptor = validateConnectionDescriptor(input, options.currentOrigin ?? globalThis.location?.origin);
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const now = options.now ?? Date.now;
  if (typeof fetcher !== 'function' || typeof now !== 'function') throw fail('CONNECTION_TRANSPORT_UNAVAILABLE');
  let session = null, pairing = false, closed = false, epoch = 0, expiryTimer;
  const pending = new Set();

  function clear(reason = 'CONNECTION_CLOSED') {
    epoch++;
    session = null;
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    for (const controller of pending) controller.abort(fail(reason));
    pending.clear();
  }
  function active() {
    if (closed) throw fail('CONNECTION_CLOSED');
    if (session && session.expiresAt <= now()) clear('CONNECTION_EXPIRED');
    if (!session) throw fail('CONNECTION_REQUIRED');
    return session;
  }
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (!session) return;
    const delay = Math.min(2_147_483_647, Math.max(1, session.expiresAt - now()));
    expiryTimer = setTimeout(() => {
      if (session?.expiresAt <= now()) clear('CONNECTION_EXPIRED');
      else scheduleExpiry();
    }, delay);
    expiryTimer?.unref?.();
  }
  function control(signal) {
    const controller = new AbortController();
    const externalAbort = () => controller.abort(fail('CONNECTION_ABORTED'));
    if (signal) {
      if (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'
          || typeof signal.aborted !== 'boolean') throw fail('INVALID_CONNECTION_SIGNAL');
      if (signal.aborted) externalAbort();
      else signal.addEventListener('abort', externalAbort, { once: true });
    }
    pending.add(controller);
    return { controller, cleanup() { pending.delete(controller); signal?.removeEventListener('abort', externalAbort); } };
  }
  async function send(path, { method, body, token, signal, accept }) {
    pathAndQuery(path, true);
    const tracked = control(signal);
    const headers = { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(accept ? { Accept: accept } : {}) };
    if (token) headers[descriptor.sessionHeader] = token;
    try {
      if (tracked.controller.signal.aborted) throw fail('CONNECTION_ABORTED');
      const response = await fetcher(descriptor.baseUrl + path, {
        method, headers, ...(body === undefined ? {} : { body }), signal: tracked.controller.signal,
        mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      });
      if (!(response instanceof Response) || response.type === 'opaque' || response.type === 'opaqueredirect') throw fail('INVALID_CONNECTION_RESPONSE');
      return { response, ...tracked };
    } catch {
      tracked.cleanup();
      if (tracked.controller.signal.aborted) throw tracked.controller.signal.reason instanceof LocalConnectionError
        ? tracked.controller.signal.reason : fail('CONNECTION_ABORTED');
      throw fail('CONNECTION_UNAVAILABLE');
    }
  }
  async function limitedJson(response) {
    const reader = response.body?.getReader();
    if (!reader) throw fail('INVALID_CONNECTION_RESPONSE');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', bytes = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 4096) throw fail('INVALID_CONNECTION_RESPONSE');
        text += decoder.decode(item.value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    } catch { await reader.cancel().catch(() => {}); throw fail('INVALID_CONNECTION_RESPONSE'); }
    finally { reader.releaseLock(); }
  }

  async function pair(code, { signal } = {}) {
    if (closed) throw fail('CONNECTION_CLOSED');
    if (pairing) throw fail('CONNECTION_BUSY');
    if (session?.expiresAt <= now()) clear('CONNECTION_EXPIRED');
    if (session) throw fail('CONNECTION_ALREADY_ACTIVE');
    if (typeof code !== 'string' || !CODE.test(code)) throw fail('INVALID_CONNECTION_CODE');
    pairing = true;
    const started = epoch;
    let tracked;
    try {
      tracked = await send(descriptor.pairingPath, { method: 'POST', body: JSON.stringify({ code }), signal });
      if (tracked.response.status !== 200) {
        await tracked.response.body?.cancel();
        throw fail('CONNECTION_REJECTED', tracked.response.status);
      }
      if (tracked.response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json') {
        await tracked.response.body?.cancel(); throw fail('INVALID_CONNECTION_RESPONSE');
      }
      const result = await limitedJson(tracked.response);
      if (closed || epoch !== started || tracked.controller.signal.aborted) throw fail('CONNECTION_ABORTED');
      if (!object(result) || Object.keys(result).sort().join(',') !== 'expiresAt,token'
          || typeof result.token !== 'string' || !CODE.test(result.token)
          || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= now()) throw fail('INVALID_CONNECTION_RESPONSE');
      session = { token: result.token, expiresAt: result.expiresAt };
      scheduleExpiry();
      return Object.freeze({ expiresAt: session.expiresAt });
    } catch (error) {
      if (tracked?.controller.signal.aborted) throw tracked.controller.signal.reason ?? fail('CONNECTION_ABORTED');
      throw error;
    } finally { pairing = false; tracked?.cleanup(); }
  }

  function wrappedResponse(tracked) {
    const original = tracked.response;
    if (!original.body) { tracked.cleanup(); return original; }
    const reader = original.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) { tracked.cleanup(); reader.releaseLock(); controller.close(); }
          else controller.enqueue(result.value);
        } catch { tracked.cleanup(); controller.error(tracked.controller.signal.aborted
          ? (tracked.controller.signal.reason ?? fail('CONNECTION_ABORTED')) : fail('CONNECTION_UNAVAILABLE')); }
      },
      async cancel(reason) { tracked.controller.abort(fail('CONNECTION_ABORTED')); tracked.cleanup(); await reader.cancel(reason).catch(() => {}); },
    });
    return new Response(stream, { status: original.status, statusText: original.statusText, headers: original.headers });
  }

  async function request(path, { method = 'GET', json, body, signal, accept } = {}) {
    if (!METHODS.has(method) || (json !== undefined && body !== undefined)
        || (body !== undefined && typeof body !== 'string') || (['GET', 'DELETE'].includes(method) && (body !== undefined || json !== undefined))
        || (accept !== undefined && accept !== 'application/json' && accept !== 'text/event-stream')) throw fail('INVALID_CONNECTION_REQUEST');
    pathAndQuery(path, true);
    if ([descriptor.pairingPath, descriptor.revocationPath].includes(path.split('?', 1)[0])) throw fail('INVALID_CONNECTION_REQUEST');
    const selected = active();
    let data = body;
    if (json !== undefined) {
      try { data = JSON.stringify(json); } catch { throw fail('INVALID_CONNECTION_REQUEST'); }
      if (typeof data !== 'string') throw fail('INVALID_CONNECTION_REQUEST');
    }
    const tracked = await send(path, { method, body: data, token: selected.token, signal, accept });
    if (closed || session !== selected || tracked.controller.signal.aborted || selected.expiresAt <= now()) {
      await tracked.response.body?.cancel(); tracked.cleanup(); throw fail('CONNECTION_EXPIRED');
    }
    if (tracked.response.status === 401) { await tracked.response.body?.cancel(); tracked.cleanup(); clear('CONNECTION_REQUIRED'); throw fail('CONNECTION_REQUIRED', 401); }
    return wrappedResponse(tracked);
  }

  function invoke(operation, input = {}, { signal } = {}) {
    if (!descriptor.requestPath || typeof operation !== 'string' || operation.length > 128
        || !/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,3}$/.test(operation)) throw fail('INVALID_CONNECTION_OPERATION');
    return request(descriptor.requestPath, { method: 'POST', json: { operation, input }, signal, accept: 'application/json' });
  }

  async function* events(pathOrOptions, options = {}) {
    const path = typeof pathOrOptions === 'string' ? pathOrOptions : descriptor.eventsPath;
    const settings = typeof pathOrOptions === 'string' ? options : (pathOrOptions ?? {});
    if (!path) throw fail('INVALID_LOCAL_PATH');
    const response = await request(path, { signal: settings.signal, accept: 'text/event-stream' });
    if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'text/event-stream' || !response.body) {
      await response.body?.cancel(); throw fail('CONNECTION_STREAM_REJECTED', response.status);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '', data = [], type = 'message', id, eventSize = 0;
    const queue = [];
    function line(value) {
      if (value.length > 1_048_576) throw fail('CONNECTION_STREAM_LIMIT');
      if (value === '') {
        if (data.length) queue.push(Object.freeze({ type: type || 'message', data: data.join('\n'), ...(id !== undefined ? { id } : {}) }));
        data = []; type = 'message'; eventSize = 0; return;
      }
      if (value.startsWith(':')) return;
      const colon = value.indexOf(':');
      const field = colon === -1 ? value : value.slice(0, colon);
      const raw = colon === -1 ? '' : value.slice(colon + 1);
      const content = raw.startsWith(' ') ? raw.slice(1) : raw;
      if (field === 'data') { eventSize += content.length + 1; if (eventSize > 1_048_576) throw fail('CONNECTION_STREAM_LIMIT'); data.push(content); }
      else if (field === 'event') type = content;
      else if (field === 'id' && !content.includes('\0')) id = content;
      // retry is deliberately not implemented: reconnection must be explicit.
    }
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        buffer += decoder.decode(item.value, { stream: true });
        let match;
        while ((match = /\r\n|\r|\n/.exec(buffer))) {
          if (match[0] === '\r' && match.index === buffer.length - 1) break;
          line(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length);
          while (queue.length) yield queue.shift();
        }
        if (buffer.length > 1_048_576) throw fail('CONNECTION_STREAM_LIMIT');
      }
      buffer += decoder.decode();
      if (buffer.endsWith('\r')) {
        line(buffer.slice(0, -1));
        while (queue.length) yield queue.shift();
      }
    } catch (error) {
      if (error instanceof LocalConnectionError) throw error;
      throw fail('CONNECTION_STREAM_FAILED');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  async function disconnect({ signal } = {}) {
    const selected = session;
    clear('CONNECTION_CLOSED');
    if (!selected || selected.expiresAt <= now()) return Object.freeze({ disconnected: true, confirmed: false });
    let tracked;
    try {
      tracked = await send(descriptor.revocationPath, { method: descriptor.revocationMethod, token: selected.token, signal });
      const confirmed = tracked.response.ok;
      await tracked.response.body?.cancel();
      if (!confirmed) throw fail('CONNECTION_DISCONNECT_UNCONFIRMED', tracked.response.status);
      return Object.freeze({ disconnected: true, confirmed: true });
    } finally { tracked?.cleanup(); }
  }

  return Object.freeze({ pair, request, invoke, events, disconnect,
    status() {
      if (session?.expiresAt <= now()) clear('CONNECTION_EXPIRED');
      return Object.freeze({ state: closed ? 'closed' : session ? 'connected' : pairing ? 'connecting' : 'disconnected',
        ...(session ? { expiresAt: session.expiresAt } : {}) });
    },
    close() { closed = true; clear(); },
  });
}
