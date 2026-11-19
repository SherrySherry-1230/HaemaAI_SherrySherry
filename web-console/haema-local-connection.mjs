// @editedBy SherrySherry 2026-11-19
import { consumeConnectionFragment, createLocalConnectionClient, createRememberedKey, LocalConnectionError } from './local-connection-client.mjs?v=20261119-recovery';
import { createRememberedConnectionStore } from './remembered-connection-store.mjs?v=20261119-recovery';

const connectionFailures = new Set(['CONNECTION_REQUIRED', 'CONNECTION_EXPIRED', 'CONNECTION_CLOSED', 'CONNECTION_REJECTED',
  'CONNECTION_UNAVAILABLE', 'CONNECTION_TRANSPORT_UNAVAILABLE', 'INVALID_CONNECTION_RESPONSE']);
const authFailures = new Set(['CONNECTION_REQUIRED', 'CONNECTION_EXPIRED', 'CONNECTION_CLOSED']);
const terminalFailures = new Set(['REMEMBERED_CONNECTION_REJECTED', 'REMEMBERED_CONNECTION_IDENTITY_MISMATCH',
  'REMEMBERED_CONNECTION_GRANT_EXPIRED', 'REMEMBERED_CONNECTION_KEY_INVALID', 'REMEMBERED_CONNECTION_INVALID']);
const stages = new Set(['fragment', 'permission', 'pairing', 'settings-status', 'events-connect', 'events-read', 'operation',
  'disconnect', 'remember', 'challenge', 'resume', 'forget', 'remembered-store']);
const phases = Object.freeze({ fragment: '연결 정보 확인', pairing: '연결 인증', 'settings-status': '설정 상태 조회',
  'events-connect': '상태 알림 연결', 'events-read': '상태 알림 수신', operation: '작업 요청', disconnect: '연결 종료',
  remember: '이 브라우저 연결 등록', challenge: '저장된 연결 확인', resume: '연결 복원', forget: '연결 등록 해제',
  'remembered-store': '브라우저 연결 정보 저장' });
const safeStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const supportsRemembering = value => Boolean(value?.rememberPath && value.challengePath && value.resumePath && value.forgetPath && value.serverIdentity);
const samePin = (a, b) => supportsRemembering(a) && supportsRemembering(b)
  && JSON.stringify([a.baseUrl, a.webOrigin, a.serverIdentity.serverId, a.serverIdentity.publicKey.kty,
    a.serverIdentity.publicKey.crv, a.serverIdentity.publicKey.x, a.serverIdentity.publicKey.y])
    === JSON.stringify([b.baseUrl, b.webOrigin, b.serverIdentity.serverId, b.serverIdentity.publicKey.kty,
      b.serverIdentity.publicKey.crv, b.serverIdentity.publicKey.x, b.serverIdentity.publicKey.y]);

export function createConsoleConnection(options = {}) {
  const location = options.location ?? globalThis.location;
  const history = options.history ?? globalThis.history;
  const permissions = options.permissions ?? globalThis.navigator?.permissions;
  const document = options.document ?? globalThis.document;
  const clientFactory = options.clientFactory ?? createLocalConnectionClient;
  const keyFactory = options.createRememberedKey ?? createRememberedKey;
  const now = options.now ?? options.clientOptions?.now ?? Date.now;
  const setTimer = options.setTimeout ?? globalThis.setTimeout, clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
  const listeners = new Set(), calendarNavigations = new Set(), clients = new Set(), diagnosticEntries = [];
  let client = null, descriptor = null, generation = 0, starting = null, recovering = null, streamController = null;
  let pendingEnvelope = null, binding = null, failureError = null, permissionChecked = false, storeLoaded = false;
  let store, storeQueue = Promise.resolve(), renewalTimer = null, sessionExpiresAt = null, deferRenewalUntil = 0;
  let enrollmentGrant = null, storeObservation = null, blocked = false, closed = false, settingsRevision = 0;
  let state = Object.freeze({ connection: 'disconnected', events: 'idle', permission: 'unknown', runtimeMode: 'unknown',
    apiConfigured: false, aiReady: false, noticeCode: 'CONNECTION_REQUIRED', firstFailure: null, eventFailure: null,
    remembered: false, rememberNoticeCode: '', recovering: false });

  function publish(next) {
    if (Object.keys(next).every(key => Object.is(next[key], state[key]))) return state;
    state = Object.freeze({ ...state, ...next });
    for (const listener of [...listeners]) { try { listener(state); } catch { /* A view cannot interrupt cleanup. */ } }
    return state;
  }
  function diagnostic(stage, status = null) {
    if (!stages.has(stage)) return;
    diagnosticEntries.push(Object.freeze({ stage, status: safeStatus(status) }));
    if (diagnosticEntries.length > 32) diagnosticEntries.shift();
  }
  function safeError(error, stage = 'operation', status) {
    return new LocalConnectionError(error instanceof LocalConnectionError ? error.code : 'CONNECTION_UNAVAILABLE',
      error instanceof LocalConnectionError && error.code === 'CONNECTION_EXPIRED' ? null
        : error instanceof LocalConnectionError ? error.status ?? status : status,
      error instanceof LocalConnectionError ? error.stage ?? stage : stage);
  }
  const failureValue = error => Object.freeze({ stage: error.stage, code: error.code, status: error.status });
  function rememberFailure(error) {
    if (!failureError) { failureError = error; publish({ firstFailure: failureValue(error) }); }
    return failureError;
  }
  function clearFailure() { failureError = null; publish({ firstFailure: null }); }
  function stopTimer() { if (renewalTimer !== null) clearTimer(renewalTimer); renewalTimer = null; }
  function stopCurrent() {
    generation++; starting = null; recovering = null; stopTimer();
    streamController?.abort(); streamController = null;
    client?.close(); clients.delete(client); client = null; descriptor = null; sessionExpiresAt = null;
    deferRenewalUntil = 0; calendarNavigations.clear();
  }
  function unavailable(error, stage, { setup = false } = {}) {
    const first = rememberFailure(safeError(error, stage));
    stopTimer(); streamController?.abort(); streamController = null; calendarNavigations.clear();
    // Recovery does not close another already-dispatched operation or response.
    // Only explicit disconnect, a new official fragment, and close() own cancellation.
    if (setup) blocked = true;
    publish({ connection: setup ? 'setup-required' : 'disconnected', events: 'disconnected', runtimeMode: 'unknown',
      apiConfigured: false, aiReady: false, recovering: false, noticeCode: setup ? 'CONNECTION_SETUP_REQUIRED' : first.code });
    return first;
  }
  function getStore() {
    if (!store) store = options.rememberedStore ?? createRememberedConnectionStore({ ...(options.storeOptions ?? {}), currentOrigin: location?.origin, now });
    return store;
  }
  function mutateStore(task) {
    const pending = storeQueue.then(task); storeQueue = pending.catch(() => {}); return pending;
  }
  const storedFailure = error => error instanceof LocalConnectionError ? error
    : new LocalConnectionError('REMEMBERED_CONNECTION_STORE_UNAVAILABLE', null, 'remembered-store');
  function captureFragment() {
    if (!location?.hash?.startsWith('#local-connection=')) return false;
    let envelope;
    try { envelope = consumeConnectionFragment({ location, history }); }
    finally {
      stopCurrent(); pendingEnvelope = null; binding = null; failureError = null; permissionChecked = false;
      blocked = false; storeLoaded = false; enrollmentGrant = null; storeObservation = null; diagnosticEntries.length = 0;
      publish({ connection: 'disconnected', events: 'idle', permission: 'unknown', runtimeMode: 'unknown', apiConfigured: false,
        aiReady: false, noticeCode: '', firstFailure: null, eventFailure: null, remembered: false, rememberNoticeCode: '', recovering: false });
    }
    pendingEnvelope = envelope; return true;
  }
  async function permissionState() {
    if (typeof permissions?.query !== 'function') return 'unknown';
    try {
      const value = await permissions.query({ name: 'loopback-network' });
      return ['granted', 'prompt', 'denied'].includes(value?.state) ? value.state : 'unknown';
    } catch { return 'unknown'; }
  }
  function permissionGate(permission) {
    permissionChecked = true; publish({ permission });
    if (permission === 'denied') {
      stopTimer(); publish({ connection: 'permission-denied', recovering: false, noticeCode: 'CONNECTION_PERMISSION_DENIED' });
      diagnostic('permission', null); return false;
    }
    if (permission !== 'granted') {
      stopTimer(); publish({ connection: 'awaiting-permission', recovering: false, noticeCode: 'CONNECTION_PERMISSION_REQUIRED' }); return false;
    }
    return true;
  }
  function settingsNotice(mode, configured, ready) {
    if (mode === 'setup-only') return 'AI_SETUP_REQUIRED';
    if (!configured) return 'API_SETTINGS_REQUIRED';
    return ready ? '' : 'AI_SETUP_REQUIRED';
  }
  function applySettings(value) {
    if (!value || typeof value.configured !== 'boolean' ||
        (value.mode !== undefined && !['setup-only', 'full'].includes(value.mode)) ||
        (value.aiReady !== undefined && typeof value.aiReady !== 'boolean') ||
        (value.providerConfigured !== undefined && typeof value.providerConfigured !== 'boolean')) {
      publish({ runtimeMode: 'unknown', apiConfigured: false, aiReady: false, noticeCode: 'SETTINGS_UNCONFIRMED' }); return false;
    }
    const setupOnly = value.mode === 'setup-only' || (!value.mode && value.aiReady === false);
    const apiConfigured = typeof value.providerConfigured === 'boolean' ? value.providerConfigured : value.configured;
    const aiReady = !setupOnly && apiConfigured && value.configured && value.aiReady !== false;
    const runtimeMode = setupOnly ? 'setup-only' : 'full';
    publish({ runtimeMode, apiConfigured, aiReady, noticeCode: settingsNotice(runtimeMode, apiConfigured, aiReady) });
    return true;
  }
  async function inspect(response, operation, activeGeneration, readRevision = null) {
    if (generation !== activeGeneration || operation !== 'settings.status' && operation !== 'calendar.connect' && response.status !== 503) return;
    let value;
    if (response.headers.get('content-type')?.split(';', 1)[0].trim() === 'application/json') {
      try { value = await response.clone().json(); } catch { /* Use validated fields only. */ }
    }
    if (generation !== activeGeneration || (readRevision !== null && readRevision !== settingsRevision)) return;
    if (operation === 'settings.status') {
      if (!applySettings(response.ok ? value : null)) throw new LocalConnectionError('SETTINGS_UNCONFIRMED', response.status, 'settings-status');
    } else if (operation === 'calendar.connect' && response.ok && value?.success === true && isCurrentRuntimeUrl(value.authorizationUrl)) {
      calendarNavigations.clear(); calendarNavigations.add(value.authorizationUrl);
    } else if (value?.code === 'AI_SETUP_REQUIRED' && value?.aiReady === false) {
      publish({ runtimeMode: 'setup-only', aiReady: false, noticeCode: 'AI_SETUP_REQUIRED' });
    }
  }
  function expiry() {
    const value = client?.status?.();
    if (Number.isSafeInteger(value?.expiresAt)) sessionExpiresAt = value.expiresAt;
    return { expiresAt: sessionExpiresAt, state: value?.state };
  }
  function needsRecovery() {
    const value = expiry();
    return value.state === 'disconnected' || value.state === 'closed'
      || Number.isSafeInteger(value.expiresAt) && value.expiresAt <= now() + 60_000 && now() >= deferRenewalUntil;
  }
  function scheduleRenewal() {
    stopTimer();
    if (!binding || blocked || closed || !client || state.connection !== 'connected') return;
    const expiresAt = expiry().expiresAt;
    if (!Number.isSafeInteger(expiresAt)) return;
    const due = deferRenewalUntil > now() ? deferRenewalUntil : expiresAt - 60_000;
    renewalTimer = setTimer(() => { renewalTimer = null; void recover('timer'); }, Math.max(1_000, due - now()));
    renewalTimer?.unref?.();
  }
  function watchEvents(selected, activeGeneration) {
    streamController?.abort();
    const controller = new AbortController(); streamController = controller;
    let streamStatus = null;
    publish({ events: 'connecting', eventFailure: null });
    const current = () => !controller.signal.aborted && client === selected && generation === activeGeneration && !closed;
    const streamFailed = caught => {
      if (!current()) return;
      let error = safeError(caught, 'events-read');
      const session = expiry();
      if (session.expiresAt !== null && session.expiresAt <= now()) error = new LocalConnectionError('CONNECTION_EXPIRED', null, 'events-read');
      diagnostic(error.stage, error.status);
      if (authFailures.has(error.code) || session.state === 'disconnected' || session.state === 'closed') {
        if (binding && !blocked) void recover('events'); else unavailable(error, error.stage);
      } else publish({ events: 'disconnected', eventFailure: failureValue(error) });
    };
    void (async () => {
      try {
        for await (const event of selected.events({ signal: controller.signal, onOpen(status) {
          if (current()) { streamStatus = safeStatus(status); publish({ events: 'connected' }); }
        } })) {
          if (!current()) return;
          publish({ events: 'connected' });
          let value;
          try { value = JSON.parse(event.data); } catch { continue; }
          if (value?.status === 'streaming' && Number.isFinite(value.timestamp)) continue;
        }
        streamFailed(new LocalConnectionError('CONNECTION_STREAM_ENDED', streamStatus, 'events-read'));
      } catch (error) { streamFailed(error); }
    })();
  }
  function track(pending) {
    starting = pending;
    void pending.then(() => { if (starting === pending) starting = null; }, () => { if (starting === pending) starting = null; });
    return pending;
  }
  function reservedFlight(kind, next, work) {
    let resolve, reject;
    const flight = new Promise((yes, no) => { resolve = yes; reject = no; });
    if (kind === 'start') starting = flight; else recovering = flight;
    // Subscribers can call connect/request synchronously while state is published.
    // Install the flight first, while retaining the user action's immediate first fetch.
    publish(next);
    const finish = () => {
      if (kind === 'start' && starting === flight) starting = null;
      if (kind === 'recover' && recovering === flight) recovering = null;
    };
    try { Promise.resolve(work()).then(value => { finish(); resolve(value); }, error => { finish(); reject(error); }); }
    catch (error) { finish(); reject(error); }
    return flight;
  }
  function makeClient(activeGeneration) {
    const selected = clientFactory(descriptor, { ...(options.clientOptions ?? {}), onDiagnostic: value => {
      if (generation === activeGeneration && !closed) diagnostic(value?.stage, value?.status);
    } });
    clients.add(selected); client = selected; return selected;
  }
  async function enroll(selected, activeGeneration) {
    if (!supportsRemembering(descriptor)) return;
    try {
      const key = binding && samePin(binding.descriptor, descriptor)
        ? { privateKey: binding.privateKey, publicKey: binding.publicKey } : await keyFactory();
      if (generation !== activeGeneration || client !== selected) return;
      const candidate = await selected.remember(key);
      if (generation !== activeGeneration || client !== selected) return;
      enrollmentGrant = { generation: activeGeneration, grantId: candidate.grantId };
      const verified = await mutateStore(async () => {
        if (generation !== activeGeneration || client !== selected) return null;
        // save() commits, reloads, verifies the CryptoKey/public key pair and full binding.
        return getStore().save(candidate);
      });
      if (generation !== activeGeneration || client !== selected || !verified) return;
      binding = verified; publish({ remembered: true, rememberNoticeCode: '' });
    } catch (caught) {
      if (generation !== activeGeneration || client !== selected) return;
      const error = caught instanceof LocalConnectionError ? caught : storedFailure(caught);
      if (terminalFailures.has(error.code)) throw error;
      binding = null; publish({ remembered: false, rememberNoticeCode: error.code });
      diagnostic(error.stage ?? 'remembered-store', error.status);
    }
  }
  function establish() {
    const envelope = pendingEnvelope;
    if (!envelope && (!binding || blocked)) return Promise.resolve(state);
    pendingEnvelope = null;
    const activeGeneration = generation;
    return reservedFlight('start', { connection: 'connecting', events: 'idle', noticeCode: '', recovering: false }, async () => {
      let stage = envelope ? 'pairing' : 'resume';
      try {
        if (generation !== activeGeneration || closed) return state;
        descriptor = envelope ? envelope.descriptor : binding.descriptor;
        const selected = makeClient(activeGeneration);
        let result;
        if (envelope) result = await selected.pair(envelope.code);
        else {
          if (binding.expiresAt <= now()) throw new LocalConnectionError('REMEMBERED_CONNECTION_GRANT_EXPIRED', null, 'resume');
          result = await selected.resume(binding);
        }
        if (generation !== activeGeneration || client !== selected) return state;
        sessionExpiresAt = result?.expiresAt ?? selected.status?.().expiresAt ?? null;
        if (envelope) { stage = 'remember'; await enroll(selected, activeGeneration); }
        if (generation !== activeGeneration || client !== selected) return state;
        stage = 'settings-status';
        const response = await selected.invoke('settings.status', {});
        try { await inspect(response, 'settings.status', activeGeneration); } finally { await response.body?.cancel(); }
        if (generation !== activeGeneration || client !== selected) return state;
        clearFailure(); publish({ connection: 'connected', remembered: Boolean(binding), recovering: false });
        watchEvents(selected, activeGeneration); scheduleRenewal();
      } catch (caught) {
        if (generation === activeGeneration && !closed) {
          const error = safeError(caught, stage); diagnostic(error.stage, error.status);
          unavailable(error, stage, { setup: terminalFailures.has(error.code) });
        }
      }
      return state;
    });
  }
  function recover(reason = 'explicit') {
    if (recovering) return recovering;
    if (closed || blocked || !binding || !client) return Promise.resolve(state);
    const selected = client, activeGeneration = generation;
    stopTimer();
    const stillConnected = state.connection === 'connected' && selected.status?.().state === 'connected';
    return reservedFlight('recover', { connection: stillConnected ? 'connected' : 'reconnecting', recovering: true }, async () => {
      try {
        if (generation !== activeGeneration || client !== selected || closed) return state;
        if (binding.expiresAt <= now()) throw new LocalConnectionError('REMEMBERED_CONNECTION_GRANT_EXPIRED', null, 'resume');
        if (reason !== 'explicit') {
          const permission = await permissionState();
          if (generation !== activeGeneration || client !== selected) return state;
          if (!permissionGate(permission)) return state;
        }
        const previousExpiry = sessionExpiresAt;
        const result = await selected.resume(binding);
        if (generation !== activeGeneration || client !== selected || closed) return state;
        sessionExpiresAt = result?.expiresAt ?? selected.status?.().expiresAt ?? null;
        deferRenewalUntil = sessionExpiresAt === previousExpiry && sessionExpiresAt > now() ? sessionExpiresAt + 1 : 0;
        // A resumed launcher may be serving a different mode for the same store.
        const revision = ++settingsRevision;
        const response = await selected.invoke('settings.status', {});
        try { await inspect(response, 'settings.status', activeGeneration, revision); } finally { await response.body?.cancel(); }
        if (generation !== activeGeneration || client !== selected || closed) return state;
        clearFailure(); publish({ connection: 'connected', recovering: false, noticeCode: settingsNotice(state.runtimeMode, state.apiConfigured, state.aiReady) });
        watchEvents(selected, activeGeneration); scheduleRenewal();
      } catch (caught) {
        if (generation === activeGeneration && client === selected && !closed) {
          const error = safeError(caught, 'resume'); diagnostic(error.stage, error.status);
          unavailable(error, 'resume', { setup: terminalFailures.has(error.code) });
        }
      }
      return state;
    });
  }
  function notConnected() {
    if (failureError) return failureError;
    if (state.connection === 'awaiting-permission') return new LocalConnectionError('CONNECTION_PERMISSION_REQUIRED', null, 'permission');
    if (state.connection === 'permission-denied') return new LocalConnectionError('CONNECTION_PERMISSION_DENIED', null, 'permission');
    return new LocalConnectionError(state.connection === 'setup-required' ? 'CONNECTION_SETUP_REQUIRED' : 'CONNECTION_REQUIRED', null, 'pairing');
  }
  async function request(operation, input = {}, settings = {}) {
    const activeGeneration = generation;
    const current = () => {
      if (settings.signal?.aborted) throw new LocalConnectionError('CONNECTION_ABORTED', null, 'operation');
      if (generation !== activeGeneration || closed) throw new LocalConnectionError('CONNECTION_CLOSED', null, 'operation');
    };
    current();
    if (starting) { await starting; current(); }
    if (recovering) { await recovering; current(); }
    if (client && state.connection === 'connected' && needsRecovery()) {
      if (binding && !blocked) { await recover('preflight'); current(); }
      else if (sessionExpiresAt !== null && sessionExpiresAt <= now()) unavailable(new LocalConnectionError('CONNECTION_EXPIRED', null, 'operation'));
    }
    current();
    const selected = client;
    if (!selected || state.connection !== 'connected') throw notConnected();
    const stage = operation === 'settings.status' ? 'settings-status' : 'operation';
    const readRevision = operation === 'settings.status' ? ++settingsRevision : null;
    try {
      // Each invocation is dispatched once. Authentication recovery never replays it.
      const response = await selected.invoke(operation, input, settings);
      if (generation !== activeGeneration || client !== selected || closed) {
        await response.body?.cancel(); throw new LocalConnectionError('CONNECTION_CLOSED', null, stage);
      }
      if (response.ok && (operation === 'settings.save' || operation === 'settings.clear')) settingsRevision++;
      await inspect(response, operation, activeGeneration, readRevision); return response;
    } catch (caught) {
      const error = safeError(caught, stage);
      if (generation === activeGeneration && client === selected && !closed && (readRevision === null || readRevision === settingsRevision)
          && (connectionFailures.has(error.code) || error.code === 'SETTINGS_UNCONFIRMED')) {
        diagnostic(error.stage, error.status);
        if (authFailures.has(error.code) && binding && !blocked) {
          rememberFailure(error); void recover('operation'); throw error;
        }
        throw unavailable(error, stage);
      }
      throw error;
    }
  }
  function start() {
    if (closed) return Promise.resolve(state);
    try { captureFragment(); }
    catch (error) { diagnostic('fragment', null); unavailable(error, 'fragment'); return Promise.resolve(state); }
    if (starting) return starting;
    if (recovering) return recovering;
    if (state.connection === 'connected') return needsRecovery() && binding ? recover('start') : Promise.resolve(state);
    if (blocked) return Promise.resolve(state);
    const activeGeneration = generation;
    const pending = (async () => {
      // The first-run app may have registered this browser in another tab.
      if (!storeLoaded || (state.connection === 'setup-required' && !binding && !pendingEnvelope)) {
        let selectedStore = null;
        try {
          await storeQueue;
          if (generation !== activeGeneration || closed) return state;
          selectedStore = getStore();
          storeObservation = null;
          const loaded = await selectedStore.load();
          if (generation !== activeGeneration || closed) return state;
          storeObservation = selectedStore.snapshot?.() ?? null;
          if (pendingEnvelope && loaded && !samePin(loaded.descriptor, pendingEnvelope.descriptor)) {
            throw new LocalConnectionError('REMEMBERED_CONNECTION_IDENTITY_MISMATCH', null, 'fragment');
          }
          binding = loaded; storeLoaded = true; publish({ remembered: Boolean(binding) });
        } catch (caught) {
          if (generation !== activeGeneration || closed) return state;
          // Validation can fail after a successful read. Retain only that read's
          // opaque receipt so explicit reset cannot erase a newer tab's record.
          storeObservation = selectedStore?.snapshot?.() ?? null;
          storeLoaded = true; blocked = true;
          const error = storedFailure(caught); diagnostic(error.stage ?? 'remembered-store', error.status);
          if (terminalFailures.has(error.code)) rememberFailure(error);
          publish({ connection: 'setup-required', noticeCode: 'CONNECTION_SETUP_REQUIRED', rememberNoticeCode: error.code }); return state;
        }
      }
      if (!pendingEnvelope && !binding) return publish({ connection: 'setup-required', noticeCode: 'CONNECTION_SETUP_REQUIRED' });
      const permission = await permissionState();
      if (generation !== activeGeneration || closed) return state;
      if (!permissionGate(permission)) return state;
      return establish();
    })();
    return track(pending);
  }
  function connect() {
    if (closed) return Promise.resolve(state);
    try { captureFragment(); }
    catch (error) { diagnostic('fragment', null); unavailable(error, 'fragment'); return Promise.resolve(state); }
    if (starting) return starting;
    if (recovering) return recovering;
    if (blocked) return Promise.resolve(state);
    if (!storeLoaded) return start();
    if (!pendingEnvelope && !binding) return start();
    if (state.connection === 'connected') return needsRecovery() && binding ? recover('explicit') : Promise.resolve(state);
    if (!permissionChecked || state.permission === 'denied') return start();
    // The explicit user action makes the first loopback request for prompt/unknown.
    if (client && binding) return recover('explicit');
    return establish();
  }
  async function recheck() {
    if (closed) return state;
    if (location?.hash?.startsWith('#local-connection=') || pendingEnvelope || ['awaiting-permission', 'permission-denied'].includes(state.connection)) return start();
    if (!client || state.connection !== 'connected') return start();
    try { const response = await request('settings.status'); await response.body?.cancel(); } catch { /* A safe state is already published. */ }
    return state;
  }
  async function disconnect() {
    const selected = client, selectedBinding = binding, selectedObservation = storeObservation;
    const grantId = selectedBinding?.grantId ?? (enrollmentGrant?.generation === generation ? enrollmentGrant.grantId : null);
    generation++; starting = null; recovering = null; stopTimer(); streamController?.abort(); streamController = null;
    client = null; descriptor = null; pendingEnvelope = null; binding = null; failureError = null;
    blocked = false; storeLoaded = true; sessionExpiresAt = null; deferRenewalUntil = 0; enrollmentGrant = null; storeObservation = null; calendarNavigations.clear();
    const activeGeneration = generation;
    publish({ connection: 'disconnected', events: 'idle', runtimeMode: 'unknown', apiConfigured: false, aiReady: false,
      noticeCode: 'CONNECTION_REQUIRED', firstFailure: null, eventFailure: null, remembered: false, rememberNoticeCode: '', recovering: false });
    let confirmed = false, cleared = true;
    const clearing = mutateStore(async () => {
      const selectedStore = getStore();
      if (grantId) {
        if (typeof selectedStore.clearIf === 'function') await selectedStore.clearIf(grantId);
        else cleared = false;
      } else if (selectedObservation && typeof selectedStore.clearSnapshot === 'function') {
        await selectedStore.clearSnapshot(selectedObservation);
      }
    }).catch(() => { cleared = false; });
    try {
      if (selectedBinding && selected) confirmed = (await selected.forget(selectedBinding))?.forgotten === true;
      else if (selected) confirmed = (await selected.disconnect())?.confirmed === true;
    } catch { /* Local removal still runs if remote revocation is not confirmed. */ }
    finally { await clearing; selected?.close(); }
    if (generation === activeGeneration && !closed) {
      if (!cleared) publish({ rememberNoticeCode: 'REMEMBERED_CONNECTION_STORE_UNAVAILABLE' });
      if (!confirmed && selected) publish({ noticeCode: 'CONNECTION_DISCONNECT_UNCONFIRMED' });
    }
    return Object.freeze({ disconnected: true, confirmed: confirmed && cleared });
  }
  function isCurrentRuntimeUrl(value) {
    if (!client || state.connection !== 'connected' || !descriptor || typeof value !== 'string') return false;
    let url;
    try { url = new URL(value); } catch { return false; }
    return url.origin === descriptor.baseUrl && !url.username && !url.password && !url.hash;
  }
  function describeFailure(error) {
    if (arguments.length && !(error instanceof LocalConnectionError)) return null;
    const rememberedMessage = code => {
      if (code === 'REMEMBERED_CONNECTION_STORE_UNAVAILABLE') return state.connection === 'connected'
        ? '현재 연결은 사용할 수 있지만 브라우저에 연결 정보를 저장하지 못했어요. 이 사이트의 저장소 접근 설정을 확인해 주세요. 새로고침 후에는 자동 연결되지 않을 수 있어요.'
        : '이 브라우저의 연결 저장소에 접근할 수 없어요. 브라우저에서 이 사이트의 저장소 접근 설정을 확인해 주세요.';
      if (code === 'CONNECTION_CRYPTO_UNAVAILABLE') return '이 브라우저의 보안 키 기능을 사용할 수 없어요. 브라우저에서 보안 키 기능을 사용할 수 있는지 확인해 주세요.';
      if (code === 'REMEMBERED_CONNECTION_KEY_INVALID') return '이 브라우저에 저장된 연결 인증 키를 확인할 수 없어요. 연결 기억을 재설정한 뒤 쩜통 버튼의 안내에 따라 해마.ai 실행 프로그램의 시작 파일을 다시 열어 주세요.';
      if (code === 'REMEMBERED_CONNECTION_INVALID') return '이 브라우저에 저장된 연결 정보의 형식을 확인할 수 없어요. 연결 기억을 재설정한 뒤 쩜통 버튼의 안내에 따라 해마.ai 실행 프로그램의 시작 파일을 다시 열어 주세요.';
      return null;
    };
    if (!arguments.length) {
      const message = rememberedMessage(state.rememberNoticeCode);
      if (message) return message;
    }
    const selected = arguments.length ? safeError(error) : failureError ?? (state.connection === 'permission-denied'
      ? new LocalConnectionError('CONNECTION_PERMISSION_DENIED', null, 'permission')
      : state.connection === 'awaiting-permission' ? new LocalConnectionError('CONNECTION_PERMISSION_REQUIRED', null, 'permission')
      : state.connection === 'setup-required' ? new LocalConnectionError('CONNECTION_SETUP_REQUIRED', null, 'pairing') : null);
    if (!selected) return null;
    const message = rememberedMessage(selected.code);
    if (message) return message;
    if (selected.code === 'CONNECTION_SETUP_REQUIRED' || terminalFailures.has(selected.code)) return '쩜통 버튼에서 이 컴퓨터에 맞는 설치·연결 안내를 확인해 주세요. 이미 등록한 Windows 쩜통은 웹콘솔의 Start로 준비 모드를 열 수 있어요.';
    if (selected.code === 'CONNECTION_PERMISSION_DENIED') return 'Chrome 주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 연결 버튼을 눌러 주세요.';
    if (selected.code === 'CONNECTION_PERMISSION_REQUIRED') return '연결 버튼을 눌러 주세요. Chrome이 로컬 네트워크 접근을 물으면 허용해 주세요.';
    if (selected.code === 'CONNECTION_EXPIRED') return '내 컴퓨터 연결의 인증 시간이 끝났어요. 연결 버튼을 눌러 다시 연결해 주세요.';
    const phase = phases[selected.stage];
    if (!phase) return null;
    const http = selected.status === null ? '' : `(HTTP ${selected.status})`;
    return `내 컴퓨터 해마.ai 실행 프로그램의 ${phase} 단계에서 실패했어요${http}. 연결 버튼을 눌러 다시 연결해 주세요.`;
  }
  const onVisibility = () => {
    if (closed || document?.visibilityState !== 'visible') return;
    if (state.connection === 'setup-required' && !blocked && !binding) void start();
    else if (state.connection === 'connected' && binding && needsRecovery()) void recover('visibility');
    else if (state.connection === 'disconnected' && binding && !blocked) void recover('visibility');
  };
  document?.addEventListener?.('visibilitychange', onVisibility);
  return Object.freeze({ start, connect, request, recheck, disconnect, describeFailure,
    acceptsLocalNavigation: value => calendarNavigations.has(value) && isCurrentRuntimeUrl(value),
    status: () => state,
    diagnostics: () => Object.freeze(diagnosticEntries.slice()),
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A connection listener is required.');
      listeners.add(listener); listener(state); return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true; document?.removeEventListener?.('visibilitychange', onVisibility); stopCurrent();
      for (const selected of clients) selected.close(); clients.clear();
      publish({ connection: 'disconnected', events: 'idle', recovering: false, noticeCode: 'CONNECTION_CLOSED' });
    },
  });
}

export const connection = createConsoleConnection();
globalThis.HAEMA_LOCAL_CONNECTION = connection;
