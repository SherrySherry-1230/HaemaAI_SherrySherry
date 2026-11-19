// @editedBy SherrySherry 2026-11-18
const CODE = /^[A-Za-z0-9_-]{43}$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RESERVED = new Set(['authorization', 'cookie', 'host', 'origin', 'content-type', 'content-length', 'connection', 'transfer-encoding', 'upgrade']);
const DESCRIPTOR_FIELDS = ['version', 'baseUrl', 'webOrigin', 'pairingPath', 'revocationPath', 'revocationMethod', 'sessionHeader'];
const REMEMBER_PATHS = ['rememberPath', 'challengePath', 'resumePath', 'forgetPath'];
const OPTIONAL_FIELDS = ['requestPath', 'eventsPath', ...REMEMBER_PATHS, 'serverIdentity'];
const STAGES = new Set(['fragment', 'permission', 'pairing', 'settings-status', 'events-connect', 'events-read', 'operation', 'disconnect',
  'remember', 'challenge', 'resume', 'forget', 'remembered-store']);
const ERROR_CODES = new Set([
  'INVALID_LOCAL_PATH', 'INVALID_CONNECTION_DESCRIPTOR', 'INVALID_LOCAL_ADDRESS', 'INVALID_WEB_ORIGIN',
  'INVALID_CONNECTION_HEADER', 'CONNECTION_LOCATION_UNAVAILABLE', 'CONNECTION_FRAGMENT_NOT_CLEARED',
  'INVALID_CONNECTION_FRAGMENT', 'CONNECTION_TRANSPORT_UNAVAILABLE', 'CONNECTION_CLOSED',
  'CONNECTION_EXPIRED', 'CONNECTION_REQUIRED', 'CONNECTION_ABORTED', 'INVALID_CONNECTION_SIGNAL',
  'INVALID_CONNECTION_RESPONSE', 'CONNECTION_UNAVAILABLE', 'CONNECTION_BUSY', 'CONNECTION_ALREADY_ACTIVE',
  'INVALID_CONNECTION_CODE', 'CONNECTION_REJECTED', 'INVALID_CONNECTION_REQUEST', 'INVALID_CONNECTION_OPERATION',
  'CONNECTION_STREAM_REJECTED', 'CONNECTION_STREAM_LIMIT', 'CONNECTION_STREAM_FAILED', 'CONNECTION_STREAM_ENDED',
  'CONNECTION_DISCONNECT_UNCONFIRMED', 'CONNECTION_PERMISSION_REQUIRED', 'CONNECTION_PERMISSION_DENIED',
  'SETTINGS_UNCONFIRMED', 'CONNECTION_SETUP_REQUIRED',
  'REMEMBERED_CONNECTION_UNSUPPORTED', 'REMEMBERED_CONNECTION_REJECTED', 'REMEMBERED_CONNECTION_IDENTITY_MISMATCH',
  'REMEMBERED_CONNECTION_GRANT_EXPIRED', 'REMEMBERED_CONNECTION_KEY_INVALID', 'REMEMBERED_CONNECTION_STORE_UNAVAILABLE',
  'REMEMBERED_CONNECTION_INVALID', 'REMEMBERED_CONNECTION_FORGET_UNCONFIRMED', 'CONNECTION_CRYPTO_UNAVAILABLE',
]);
const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

export class LocalConnectionError extends Error {
  constructor(code, status, stage) {
    const safeCode = ERROR_CODES.has(code) ? code : 'CONNECTION_UNAVAILABLE';
    super(safeCode);
    this.name = 'LocalConnectionError';
    this.code = safeCode;
    this.status = httpStatus(status);
    this.stage = STAGES.has(stage) ? stage : null;
  }
}
const fail = (code, status, stage) => new LocalConnectionError(code, status, stage);
const atStage = (error, stage, status) => fail(error instanceof LocalConnectionError ? error.code : 'CONNECTION_UNAVAILABLE',
  error instanceof LocalConnectionError ? error.status ?? status : status, error instanceof LocalConnectionError ? error.stage ?? stage : stage);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length
  && fields.every(key => Object.hasOwn(value, key));
const DAY = 86_400_000;
const CLOCK_ALLOWANCE = 60_000;
function unbase64(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length !== Math.ceil(bytes * 4 / 3)) return null;
  try {
    const raw = globalThis.atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
    const result = Uint8Array.from(raw, char => char.charCodeAt(0));
    return result.length === bytes && base64(result) === value ? result : null;
  } catch { return null; }
}
function base64(value) {
  return globalThis.btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
const opaque = value => unbase64(value, 32) !== null;
function publicJwk(value) {
  if (!exact(value, ['kty', 'crv', 'x', 'y']) || value.kty !== 'EC' || value.crv !== 'P-256'
      || !opaque(value.x) || !opaque(value.y)) throw fail('REMEMBERED_CONNECTION_KEY_INVALID');
  return Object.freeze({ kty: 'EC', crv: 'P-256', x: value.x, y: value.y });
}
const canonicalJwk = value => JSON.stringify([value.kty, value.crv, value.x, value.y]);
function cryptography(value = globalThis.crypto) {
  if (!value?.subtle || typeof value.getRandomValues !== 'function') throw fail('CONNECTION_CRYPTO_UNAVAILABLE');
  return value;
}
function privateKey(value) {
  if (Object.prototype.toString.call(value) !== '[object CryptoKey]' || value.type !== 'private' || value.extractable !== false
      || value.algorithm?.name !== 'ECDSA' || value.algorithm?.namedCurve !== 'P-256'
      || value.usages?.length !== 1 || value.usages[0] !== 'sign') throw fail('REMEMBERED_CONNECTION_KEY_INVALID');
  return value;
}
const transcript = values => new TextEncoder().encode(JSON.stringify(values));
function freshNonce(crypto) { return base64(crypto.getRandomValues(new Uint8Array(32))); }
function expiry(value, now, duration, code = 'REMEMBERED_CONNECTION_INVALID', allowExpired = false) {
  if (!Number.isSafeInteger(value) || value < 1 || (!allowExpired && value <= now) || value > now + duration + CLOCK_ALLOWANCE) throw fail(code);
  return value;
}
function descriptorIdentity(value) {
  return JSON.stringify([...DESCRIPTOR_FIELDS, ...OPTIONAL_FIELDS].map(key => key === 'serverIdentity'
    ? value[key] && [value[key].serverId, canonicalJwk(value[key].publicKey)] : value[key]));
}
async function validatedKeys(value, crypto) {
  if (!exact(value, ['privateKey', 'publicKey'])) throw fail('REMEMBERED_CONNECTION_KEY_INVALID');
  const secret = privateKey(value.privateKey), publicKey = publicJwk(value.publicKey);
  try {
    const imported = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const sample = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, secret, sample);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, signature, sample)) throw new Error();
  } catch { throw fail('REMEMBERED_CONNECTION_KEY_INVALID'); }
  return Object.freeze({ privateKey: secret, publicKey });
}

export async function createRememberedKey({ crypto: supplied } = {}) {
  const crypto = cryptography(supplied);
  try {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return Object.freeze({ privateKey: privateKey(pair.privateKey), publicKey: publicJwk({ kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y }) });
  } catch { throw fail('REMEMBERED_CONNECTION_KEY_INVALID'); }
}

export async function validateRememberedBinding(value, options = {}) {
  try {
    if (!exact(value, ['version', 'descriptor', 'grantId', 'expiresAt', 'privateKey', 'publicKey']) || value.version !== 1 || !opaque(value.grantId)) {
      throw fail('REMEMBERED_CONNECTION_INVALID');
    }
    const descriptor = validateConnectionDescriptor(value.descriptor, options.currentOrigin ?? globalThis.location?.origin);
    if (!descriptor.serverIdentity) throw fail('REMEMBERED_CONNECTION_INVALID');
    expiry(value.expiresAt, (options.now ?? Date.now)(), 30 * DAY, 'REMEMBERED_CONNECTION_GRANT_EXPIRED', options.allowExpired === true);
    const keys = await validatedKeys({ privateKey: value.privateKey, publicKey: value.publicKey }, cryptography(options.crypto));
    return Object.freeze({ version: 1, descriptor, grantId: value.grantId, expiresAt: value.expiresAt, ...keys });
  } catch (error) {
    throw atStage(error, options.stage ?? 'remembered-store');
  }
}

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
  for (const key of ['pairingPath', 'revocationPath', ...OPTIONAL_FIELDS.filter(key => key !== 'serverIdentity')]) {
    if (Object.hasOwn(value, key)) pathAndQuery(value[key]);
  }
  const paths = ['pairingPath', 'revocationPath', ...OPTIONAL_FIELDS.filter(key => key !== 'serverIdentity')].filter(key => Object.hasOwn(value, key)).map(key => value[key]);
  if (new Set(paths).size !== paths.length || !['POST', 'DELETE'].includes(value.revocationMethod)) throw fail('INVALID_CONNECTION_DESCRIPTOR');
  if (typeof value.sessionHeader !== 'string' || !/^[a-z][a-z0-9-]{0,127}$/.test(value.sessionHeader)
      || RESERVED.has(value.sessionHeader) || value.sessionHeader.startsWith('sec-') || value.sessionHeader.startsWith('access-control-')) {
    throw fail('INVALID_CONNECTION_HEADER');
  }
  const rememberedFields = [...REMEMBER_PATHS, 'serverIdentity'];
  if (rememberedFields.some(key => Object.hasOwn(value, key))) {
    if (!rememberedFields.every(key => Object.hasOwn(value, key)) || !exact(value.serverIdentity, ['serverId', 'publicKey'])
        || !opaque(value.serverIdentity.serverId)) throw fail('INVALID_CONNECTION_DESCRIPTOR');
    let key;
    try { key = publicJwk(value.serverIdentity.publicKey); } catch { throw fail('INVALID_CONNECTION_DESCRIPTOR'); }
    return Object.freeze({ ...value, serverIdentity: Object.freeze({ serverId: value.serverIdentity.serverId, publicKey: key }) });
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
  let session = null, pairing = false, remembering = false, resuming = false, forgetting = false, closed = false, epoch = 0, expiryTimer;
  const pending = new Set();
  function diagnose(stage, status) {
    if (!STAGES.has(stage) || typeof options.onDiagnostic !== 'function') return;
    try { options.onDiagnostic(Object.freeze({ stage, status: httpStatus(status) })); } catch { /* Diagnostics cannot affect transport. */ }
  }

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
  async function send(path, { method, body, token, signal, accept, stage = 'operation' }) {
    pathAndQuery(path, true);
    const tracked = control(signal);
    const headers = { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(accept ? { Accept: accept } : {}) };
    if (token) headers[descriptor.sessionHeader] = token;
    try {
      if (tracked.controller.signal.aborted) throw fail('CONNECTION_ABORTED');
      const response = await fetcher(descriptor.baseUrl + path, {
        method, headers, ...(body === undefined ? {} : { body }), signal: tracked.controller.signal,
        mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
        targetAddressSpace: 'loopback',
      });
      if (!(response instanceof Response) || response.type === 'opaque' || response.type === 'opaqueredirect') throw fail('INVALID_CONNECTION_RESPONSE');
      diagnose(stage, response.status);
      return { response, ...tracked };
    } catch {
      diagnose(stage, null);
      tracked.cleanup();
      if (tracked.controller.signal.aborted) throw atStage(tracked.controller.signal.reason instanceof LocalConnectionError
        ? tracked.controller.signal.reason : fail('CONNECTION_ABORTED'), stage);
      throw fail('CONNECTION_UNAVAILABLE', null, stage);
    }
  }
  async function limitedJson(response, limit = 4096) {
    const reader = response.body?.getReader();
    if (!reader) throw fail('INVALID_CONNECTION_RESPONSE');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', bytes = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > limit) throw fail('INVALID_CONNECTION_RESPONSE');
        text += decoder.decode(item.value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    } catch { await reader.cancel().catch(() => {}); throw fail('INVALID_CONNECTION_RESPONSE'); }
    finally { reader.releaseLock(); }
  }

  async function pair(code, { signal } = {}) {
    if (closed) throw fail('CONNECTION_CLOSED');
    if (pairing || remembering || resuming || forgetting) throw fail('CONNECTION_BUSY');
    if (session?.expiresAt <= now()) clear('CONNECTION_EXPIRED');
    if (session) throw fail('CONNECTION_ALREADY_ACTIVE');
    if (typeof code !== 'string' || !CODE.test(code)) throw fail('INVALID_CONNECTION_CODE');
    pairing = true;
    const started = epoch;
    let tracked;
    try {
      tracked = await send(descriptor.pairingPath, { method: 'POST', body: JSON.stringify({ code }), signal, stage: 'pairing' });
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
      if (tracked?.controller.signal.aborted) throw atStage(tracked.controller.signal.reason ?? fail('CONNECTION_ABORTED'), 'pairing', tracked?.response.status);
      throw atStage(error, 'pairing', tracked?.response.status);
    } finally { pairing = false; tracked?.cleanup(); }
  }

  function rememberedSupport() {
    if (closed) throw fail('CONNECTION_CLOSED');
    if (!descriptor.serverIdentity) throw fail('REMEMBERED_CONNECTION_UNSUPPORTED');
    if (pairing || remembering || resuming || forgetting) throw fail('CONNECTION_BUSY');
    return cryptography(options.crypto);
  }
  async function bindingFor(value, stage, allowExpired = false) {
    const binding = await validateRememberedBinding(value, { currentOrigin: descriptor.webOrigin, now, crypto: options.crypto, stage, allowExpired });
    if (descriptorIdentity(binding.descriptor) !== descriptorIdentity(descriptor)) throw fail('REMEMBERED_CONNECTION_IDENTITY_MISMATCH', null, stage);
    return binding;
  }
  async function proof(crypto, signature, values, stage) {
    const bytes = unbase64(signature, 64);
    if (!bytes) throw fail('REMEMBERED_CONNECTION_INVALID', null, stage);
    try {
      const key = await crypto.subtle.importKey('jwk', descriptor.serverIdentity.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes, transcript(values))) throw new Error();
    } catch { throw fail('REMEMBERED_CONNECTION_IDENTITY_MISMATCH', null, stage); }
  }
  function current(started, tracked, stage) {
    if (closed || epoch !== started || tracked.controller.signal.aborted) throw fail('CONNECTION_ABORTED', null, stage);
  }
  async function exchange(path, body, stage, signal, token) {
    const encoded = JSON.stringify(body);
    if (new TextEncoder().encode(encoded).length > 8192) throw fail('REMEMBERED_CONNECTION_INVALID', null, stage);
    const tracked = await send(path, { method: 'POST', body: encoded, signal, token, stage });
    try {
      if (tracked.response.status !== 200) {
        await tracked.response.body?.cancel();
        const status = tracked.response.status;
        if (stage === 'forget') throw fail('REMEMBERED_CONNECTION_FORGET_UNCONFIRMED', status, stage);
        if (status === 408 || status === 429 || status >= 500) throw fail('CONNECTION_UNAVAILABLE', status, stage);
        throw fail('REMEMBERED_CONNECTION_REJECTED', status, stage);
      }
      if (tracked.response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json') throw fail('REMEMBERED_CONNECTION_INVALID', tracked.response.status, stage);
      const value = await limitedJson(tracked.response, 8192);
      return { ...tracked, value };
    } catch (error) {
      await tracked.response.body?.cancel().catch(() => {}); tracked.cleanup();
      throw atStage(error, stage, tracked.response.status);
    }
  }
  async function remember(keyPair, { signal } = {}) {
    const crypto = rememberedSupport(), selected = active(), started = epoch;
    remembering = true;
    let tracked;
    try {
      const keys = await validatedKeys(keyPair, crypto), clientNonce = freshNonce(crypto);
      if (closed || epoch !== started) throw fail('CONNECTION_ABORTED');
      tracked = await exchange(descriptor.rememberPath, { clientNonce, publicKey: keys.publicKey }, 'remember', signal, selected.token);
      const result = tracked.value;
      current(started, tracked, 'remember');
      if (!exact(result, ['version', 'grantId', 'expiresAt', 'runtimeScope', 'proof']) || result.version !== 1
          || !opaque(result.grantId) || !opaque(result.runtimeScope)) throw fail('REMEMBERED_CONNECTION_INVALID');
      expiry(result.expiresAt, now(), 30 * DAY);
      await proof(crypto, result.proof, ['haema-local/v1', 'enroll', descriptor.serverIdentity.serverId, result.grantId,
        descriptor.webOrigin, descriptor.baseUrl, result.runtimeScope, clientNonce, result.expiresAt, canonicalJwk(keys.publicKey)], 'remember');
      current(started, tracked, 'remember');
      return Object.freeze({ version: 1, descriptor, grantId: result.grantId, expiresAt: result.expiresAt, ...keys });
    } catch (error) { throw atStage(error, 'remember', tracked?.response.status); }
    finally { remembering = false; tracked?.cleanup(); }
  }
  async function resume(value, { signal } = {}) {
    const crypto = rememberedSupport(), started = epoch;
    resuming = true;
    let challenged, resumed;
    let stage = 'challenge';
    try {
      const binding = await bindingFor(value, stage), clientNonce = freshNonce(crypto);
      if (closed || epoch !== started) throw fail('CONNECTION_ABORTED');
      challenged = await exchange(descriptor.challengePath, { grantId: binding.grantId, clientNonce }, stage, signal);
      const challenge = challenged.value;
      current(started, challenged, stage);
      if (!exact(challenge, ['version', 'runtimeScope', 'serverNonce', 'expiresAt', 'proof']) || challenge.version !== 1
          || !opaque(challenge.runtimeScope) || !opaque(challenge.serverNonce)) throw fail('REMEMBERED_CONNECTION_INVALID');
      expiry(challenge.expiresAt, now(), 30_000);
      if (challenge.expiresAt > binding.expiresAt) throw fail('REMEMBERED_CONNECTION_INVALID');
      const fields = [descriptor.serverIdentity.serverId, binding.grantId, descriptor.webOrigin, descriptor.baseUrl,
        challenge.runtimeScope, clientNonce, challenge.serverNonce, challenge.expiresAt];
      await proof(crypto, challenge.proof, ['haema-local/v1', 'challenge', ...fields], stage);
      current(started, challenged, stage);
      expiry(challenge.expiresAt, now(), 30_000);
      let signature;
      try { signature = base64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, binding.privateKey,
        transcript(['haema-local/v1', 'resume', ...fields])))); }
      catch { throw fail('REMEMBERED_CONNECTION_KEY_INVALID'); }
      current(started, challenged, stage);
      challenged.cleanup();
      stage = 'resume';
      resumed = await exchange(descriptor.resumePath, { grantId: binding.grantId, clientNonce, serverNonce: challenge.serverNonce,
        runtimeScope: challenge.runtimeScope, expiresAt: challenge.expiresAt, signature }, stage, signal);
      const result = resumed.value;
      current(started, resumed, stage);
      if (!exact(result, ['version', 'token', 'expiresAt', 'runtimeScope', 'proof']) || result.version !== 1 || !opaque(result.token)
          || result.runtimeScope !== challenge.runtimeScope) throw fail('REMEMBERED_CONNECTION_INVALID');
      expiry(result.expiresAt, now(), 30 * 60_000);
      if (result.expiresAt > binding.expiresAt) throw fail('REMEMBERED_CONNECTION_INVALID');
      await proof(crypto, result.proof, ['haema-local/v1', 'session', descriptor.serverIdentity.serverId, binding.grantId,
        descriptor.webOrigin, descriptor.baseUrl, challenge.runtimeScope, clientNonce, challenge.serverNonce, result.token, result.expiresAt], stage);
      current(started, resumed, stage);
      expiry(result.expiresAt, now(), 30 * 60_000);
      session = { token: result.token, expiresAt: result.expiresAt };
      scheduleExpiry();
      return Object.freeze({ expiresAt: session.expiresAt });
    } catch (error) { throw atStage(error, stage, (resumed ?? challenged)?.response.status); }
    finally { resuming = false; challenged?.cleanup(); resumed?.cleanup(); }
  }
  async function forget(value, { signal } = {}) {
    rememberedSupport();
    const selected = active(), started = epoch;
    forgetting = true;
    let tracked;
    try {
      const binding = await bindingFor(value, 'forget', true);
      if (closed || epoch !== started) throw fail('CONNECTION_ABORTED');
      tracked = await exchange(descriptor.forgetPath, { grantId: binding.grantId }, 'forget', signal, selected.token);
      current(started, tracked, 'forget');
      if (!exact(tracked.value, ['forgotten']) || tracked.value.forgotten !== true) throw fail('REMEMBERED_CONNECTION_FORGET_UNCONFIRMED');
      clear('CONNECTION_CLOSED');
      return Object.freeze({ forgotten: true });
    } catch (error) {
      if (error instanceof LocalConnectionError && ['REMEMBERED_CONNECTION_IDENTITY_MISMATCH', 'REMEMBERED_CONNECTION_KEY_INVALID',
        'REMEMBERED_CONNECTION_INVALID', 'CONNECTION_ABORTED'].includes(error.code)) throw atStage(error, 'forget', tracked?.response.status);
      throw fail('REMEMBERED_CONNECTION_FORGET_UNCONFIRMED', error instanceof LocalConnectionError ? error.status : null, 'forget');
    } finally { forgetting = false; tracked?.cleanup(); }
  }

  function wrappedResponse(tracked, stage) {
    const original = tracked.response;
    if (!original.body) { tracked.cleanup(); return original; }
    const reader = original.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) { tracked.cleanup(); reader.releaseLock(); controller.close(); }
          else controller.enqueue(result.value);
        } catch { tracked.cleanup(); controller.error(atStage(tracked.controller.signal.aborted
          ? (tracked.controller.signal.reason ?? fail('CONNECTION_ABORTED')) : fail('CONNECTION_UNAVAILABLE'), stage, original.status)); }
      },
      async cancel(reason) { tracked.controller.abort(fail('CONNECTION_ABORTED')); tracked.cleanup(); await reader.cancel(reason).catch(() => {}); },
    });
    return new Response(stream, { status: original.status, statusText: original.statusText, headers: original.headers });
  }

  async function request(path, { method = 'GET', json, body, signal, accept, stage = 'operation' } = {}) {
    if (!METHODS.has(method) || (json !== undefined && body !== undefined)
        || (body !== undefined && typeof body !== 'string') || (['GET', 'DELETE'].includes(method) && (body !== undefined || json !== undefined))
        || (accept !== undefined && accept !== 'application/json' && accept !== 'text/event-stream')) throw fail('INVALID_CONNECTION_REQUEST');
    pathAndQuery(path, true);
    if ([descriptor.pairingPath, descriptor.revocationPath, ...REMEMBER_PATHS.map(key => descriptor[key])].includes(path.split('?', 1)[0])) throw fail('INVALID_CONNECTION_REQUEST');
    const selected = active();
    const started = epoch;
    let data = body;
    if (json !== undefined) {
      try { data = JSON.stringify(json); } catch { throw fail('INVALID_CONNECTION_REQUEST'); }
      if (typeof data !== 'string') throw fail('INVALID_CONNECTION_REQUEST');
    }
    const tracked = await send(path, { method, body: data, token: selected.token, signal, accept, stage });
    if (closed || epoch !== started || tracked.controller.signal.aborted || selected.expiresAt <= now()) {
      await tracked.response.body?.cancel(); tracked.cleanup(); throw fail('CONNECTION_EXPIRED', tracked.response.status, stage);
    }
    if (tracked.response.status === 401) {
      try {
        if (path === descriptor.requestPath && tracked.response.headers.get('content-type')?.split(';', 1)[0].trim() === 'application/json') {
          // A provider can deny an operation while the local session remains valid.
          const result = await limitedJson(tracked.response, 8192).catch(() => null);
          current(started, tracked, stage);
          if (result?.success === false && ['AUTH_REQUIRED', 'REAUTH_REQUIRED'].includes(result.code)) {
            return Response.json(result, { status: 401 });
          }
        }
        if (session === selected) clear('CONNECTION_REQUIRED');
        throw fail('CONNECTION_REQUIRED', 401, stage);
      } finally { await tracked.response.body?.cancel().catch(() => {}); tracked.cleanup(); }
    }
    return wrappedResponse(tracked, stage);
  }

  function invoke(operation, input = {}, { signal } = {}) {
    if (!descriptor.requestPath || typeof operation !== 'string' || operation.length > 128
        || !/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,3}$/.test(operation)) throw fail('INVALID_CONNECTION_OPERATION');
    return request(descriptor.requestPath, { method: 'POST', json: { operation, input }, signal, accept: 'application/json',
      stage: operation === 'settings.status' ? 'settings-status' : 'operation' });
  }

  async function* events(pathOrOptions, options = {}) {
    const path = typeof pathOrOptions === 'string' ? pathOrOptions : descriptor.eventsPath;
    const settings = typeof pathOrOptions === 'string' ? options : (pathOrOptions ?? {});
    if (!path) throw fail('INVALID_LOCAL_PATH');
    const response = await request(path, { signal: settings.signal, accept: 'text/event-stream', stage: 'events-connect' });
    if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'text/event-stream' || !response.body) {
      await response.body?.cancel(); throw fail('CONNECTION_STREAM_REJECTED', response.status, 'events-connect');
    }
    try { settings.onOpen?.(response.status); } catch { /* A view cannot interrupt the stream. */ }
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
      diagnose('events-read', response.status);
      throw fail(error instanceof LocalConnectionError ? error.code : 'CONNECTION_STREAM_FAILED', response.status, 'events-read');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  async function disconnect({ signal } = {}) {
    const selected = session;
    clear('CONNECTION_CLOSED');
    if (!selected || selected.expiresAt <= now()) return Object.freeze({ disconnected: true, confirmed: false });
    let tracked;
    try {
      tracked = await send(descriptor.revocationPath, { method: descriptor.revocationMethod, token: selected.token, signal, stage: 'disconnect' });
      const confirmed = tracked.response.ok;
      await tracked.response.body?.cancel();
      if (!confirmed) throw fail('CONNECTION_DISCONNECT_UNCONFIRMED', tracked.response.status);
      return Object.freeze({ disconnected: true, confirmed: true });
    } finally { tracked?.cleanup(); }
  }

  return Object.freeze({ pair, remember, resume, forget, request, invoke, events, disconnect,
    status() {
      if (session?.expiresAt <= now()) clear('CONNECTION_EXPIRED');
      return Object.freeze({ state: closed ? 'closed' : session ? 'connected' : pairing ? 'connecting' : 'disconnected',
        ...(session ? { expiresAt: session.expiresAt } : {}) });
    },
    close() { closed = true; clear(); },
  });
}
