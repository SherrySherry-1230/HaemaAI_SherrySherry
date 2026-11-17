// @editedBy SherrySherry 2026-11-17
import { consumeConnectionFragment, createLocalConnectionClient, LocalConnectionError } from './local-connection-client.mjs?v=20261117-connection';

const connectionFailures = new Set([
  'CONNECTION_REQUIRED', 'CONNECTION_EXPIRED', 'CONNECTION_CLOSED', 'CONNECTION_REJECTED',
  'CONNECTION_UNAVAILABLE', 'CONNECTION_TRANSPORT_UNAVAILABLE', 'INVALID_CONNECTION_RESPONSE',
]);
const authFailures = new Set(['CONNECTION_REQUIRED', 'CONNECTION_EXPIRED', 'CONNECTION_CLOSED']);
const stages = new Set(['fragment', 'permission', 'pairing', 'settings-status', 'events-connect', 'events-read', 'operation', 'disconnect']);
const phases = Object.freeze({ fragment: '연결 정보 확인', pairing: '연결 인증', 'settings-status': '설정 상태 조회',
  'events-connect': '상태 알림 연결', 'events-read': '상태 알림 수신', operation: '작업 요청', disconnect: '연결 종료' });
const safeStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

export function createConsoleConnection(options = {}) {
  const location = options.location ?? globalThis.location;
  const history = options.history ?? globalThis.history;
  const permissions = options.permissions ?? globalThis.navigator?.permissions;
  const clientFactory = options.clientFactory ?? createLocalConnectionClient;
  const listeners = new Set(), calendarNavigations = new Set();
  const diagnosticEntries = [];
  let client = null, descriptor = null, generation = 0, starting = null, streamController = null;
  let pendingEnvelope = null, failureError = null, permissionChecked = false;
  let state = Object.freeze({ connection: 'disconnected', events: 'idle', permission: 'unknown', runtimeMode: 'unknown',
    apiConfigured: false, aiReady: false, noticeCode: 'CONNECTION_REQUIRED', firstFailure: null, eventFailure: null });

  function publish(next) {
    state = Object.freeze({ ...state, ...next });
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* A view cannot interrupt connection cleanup. */ }
    }
    return state;
  }
  function diagnostic(stage, status = null) {
    if (!stages.has(stage)) return;
    diagnosticEntries.push(Object.freeze({ stage, status: safeStatus(status) }));
    if (diagnosticEntries.length > 32) diagnosticEntries.shift();
  }
  function safeError(error, stage = 'operation', status) {
    return new LocalConnectionError(error instanceof LocalConnectionError ? error.code : 'CONNECTION_UNAVAILABLE',
      error instanceof LocalConnectionError ? error.status ?? status : status,
      error instanceof LocalConnectionError ? error.stage ?? stage : stage);
  }
  function failureValue(error) {
    return Object.freeze({ stage: error.stage, code: error.code, status: error.status });
  }
  function rememberFailure(error) {
    if (!failureError) {
      failureError = error;
      publish({ firstFailure: failureValue(error) });
    }
    return failureError;
  }
  function stopCurrent() {
    generation++;
    starting = null;
    streamController?.abort(); streamController = null;
    client?.close(); client = null; descriptor = null;
    calendarNavigations.clear();
  }
  function unavailable(error, stage) {
    const first = rememberFailure(safeError(error, stage));
    stopCurrent(); pendingEnvelope = null;
    publish({ connection: 'disconnected', events: 'disconnected', runtimeMode: 'unknown', apiConfigured: false,
      aiReady: false, noticeCode: first.code });
    return first;
  }
  function captureFragment() {
    if (!location?.hash?.startsWith('#local-connection=')) return false;
    // Consume and clear the URL before any asynchronous permission check.
    let envelope;
    try { envelope = consumeConnectionFragment({ location, history }); }
    finally {
      stopCurrent(); pendingEnvelope = null; failureError = null; permissionChecked = false;
      diagnosticEntries.length = 0;
      publish({ connection: 'disconnected', events: 'idle', permission: 'unknown', runtimeMode: 'unknown',
        apiConfigured: false, aiReady: false, noticeCode: '', firstFailure: null, eventFailure: null });
    }
    pendingEnvelope = envelope;
    return true;
  }
  async function permissionState() {
    if (typeof permissions?.query !== 'function') return 'unknown';
    try {
      const result = await permissions.query({ name: 'loopback-network' });
      return ['granted', 'prompt', 'denied'].includes(result?.state) ? result.state : 'unknown';
    } catch { return 'unknown'; }
  }
  function applySettings(value) {
    const valid = value && typeof value === 'object' && !Array.isArray(value) && typeof value.configured === 'boolean';
    if (!valid) {
      publish({ runtimeMode: 'unknown', apiConfigured: false, aiReady: false, noticeCode: 'SETTINGS_UNCONFIRMED' });
      return false;
    }
    const setupOnly = value.mode === 'setup-only' || value.aiReady === false;
    publish({ runtimeMode: setupOnly ? 'setup-only' : 'full', apiConfigured: value.configured,
      aiReady: !setupOnly && value.configured,
      noticeCode: setupOnly ? 'AI_SETUP_REQUIRED' : value.configured ? '' : 'API_SETTINGS_REQUIRED' });
    return true;
  }
  async function inspect(response, operation, activeGeneration) {
    if (generation !== activeGeneration) return;
    if (operation !== 'settings.status' && operation !== 'calendar.connect' && response.status !== 503) return;
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim();
    let value;
    if (contentType === 'application/json') {
      try { value = await response.clone().json(); } catch { /* Only validated fields are used below. */ }
    }
    if (generation !== activeGeneration) return;
    if (operation === 'settings.status') {
      if (!applySettings(response.ok ? value : null)) throw new LocalConnectionError('SETTINGS_UNCONFIRMED', response.status, 'settings-status');
    } else if (operation === 'calendar.connect' && response.ok && value?.success === true && isCurrentRuntimeUrl(value.authorizationUrl)) {
      calendarNavigations.clear(); calendarNavigations.add(value.authorizationUrl);
    } else if (value?.code === 'AI_SETUP_REQUIRED' && value?.aiReady === false) {
      publish({ runtimeMode: 'setup-only', aiReady: false, noticeCode: 'AI_SETUP_REQUIRED' });
    }
  }
  async function request(operation, input = {}, settings = {}) {
    if (starting) await starting;
    const selected = client, activeGeneration = generation;
    if (!selected || state.connection !== 'connected') {
      if (failureError) throw failureError;
      if (state.connection === 'awaiting-permission') throw new LocalConnectionError('CONNECTION_PERMISSION_REQUIRED', null, 'permission');
      if (state.connection === 'permission-denied') throw new LocalConnectionError('CONNECTION_PERMISSION_DENIED', null, 'permission');
      throw new LocalConnectionError('CONNECTION_REQUIRED', null, 'pairing');
    }
    const stage = operation === 'settings.status' ? 'settings-status' : 'operation';
    try {
      const response = await selected.invoke(operation, input, settings);
      if (generation !== activeGeneration || client !== selected) {
        await response.body?.cancel(); throw new LocalConnectionError('CONNECTION_CLOSED', null, stage);
      }
      await inspect(response, operation, activeGeneration);
      return response;
    } catch (caught) {
      const error = safeError(caught, stage);
      if (generation === activeGeneration && (connectionFailures.has(error.code) || error.code === 'SETTINGS_UNCONFIRMED')) {
        diagnostic(error.stage, error.status);
        throw unavailable(error, stage);
      }
      throw error;
    }
  }
  function watchEvents(selected, activeGeneration) {
    streamController?.abort();
    const controller = new AbortController(); streamController = controller;
    let streamStatus = null;
    publish({ events: 'connecting', eventFailure: null });
    const current = () => !controller.signal.aborted && client === selected && generation === activeGeneration;
    const streamFailed = caught => {
      if (!current()) return;
      const error = safeError(caught, 'events-read');
      diagnostic(error.stage, error.status);
      const sessionState = selected.status?.().state;
      if (authFailures.has(error.code) || sessionState === 'disconnected' || sessionState === 'closed') {
        unavailable(error, error.stage);
      } else {
        // A failed status stream does not invalidate a still-authenticated HTTP session.
        publish({ events: 'disconnected', eventFailure: failureValue(error) });
      }
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
    void pending.finally(() => { if (starting === pending) starting = null; });
    return pending;
  }
  function establish() {
    const envelope = pendingEnvelope;
    if (!envelope) return Promise.resolve(state);
    pendingEnvelope = null;
    const activeGeneration = generation;
    publish({ connection: 'connecting', events: 'idle', noticeCode: '' });
    const pending = (async () => {
      let stage = 'pairing';
      try {
        descriptor = envelope.descriptor;
        const selected = clientFactory(descriptor, { ...(options.clientOptions ?? {}), onDiagnostic: value => {
          if (generation === activeGeneration) diagnostic(value?.stage, value?.status);
        } });
        client = selected;
        await selected.pair(envelope.code);
        if (generation !== activeGeneration || client !== selected) return state;
        stage = 'settings-status';
        const response = await selected.invoke('settings.status', {});
        try { await inspect(response, 'settings.status', activeGeneration); }
        finally { await response.body?.cancel(); }
        if (generation !== activeGeneration || client !== selected) return state;
        publish({ connection: 'connected' });
        watchEvents(selected, activeGeneration);
      } catch (error) {
        if (generation === activeGeneration) {
          const safe = safeError(error, stage); diagnostic(safe.stage, safe.status); unavailable(safe, stage);
        }
      }
      return state;
    })();
    return track(pending);
  }
  function start() {
    try { captureFragment(); }
    catch (error) {
      diagnostic('fragment', null); unavailable(error, 'fragment'); return Promise.resolve(state);
    }
    if (starting) return starting;
    if (!pendingEnvelope) return Promise.resolve(state);
    const activeGeneration = generation;
    const pending = (async () => {
      const permission = await permissionState();
      if (generation !== activeGeneration) return state;
      permissionChecked = true; publish({ permission });
      if (permission === 'denied') {
        publish({ connection: 'permission-denied', noticeCode: 'CONNECTION_PERMISSION_DENIED' });
        diagnostic('permission', null);
        return state;
      }
      if (permission === 'granted') return establish();
      publish({ connection: 'awaiting-permission', noticeCode: 'CONNECTION_PERMISSION_REQUIRED' });
      return state;
    })();
    return track(pending);
  }
  function connect() {
    try { captureFragment(); }
    catch (error) { diagnostic('fragment', null); unavailable(error, 'fragment'); return Promise.resolve(state); }
    if (starting) return starting;
    if (!pendingEnvelope || state.connection === 'connected') return Promise.resolve(state);
    if (!permissionChecked) {
      // start() is safe to call on load; connect() must be called by a user action after it completes.
      return start();
    }
    if (state.permission === 'denied') return Promise.resolve(state);
    return establish();
  }
  async function recheck() {
    if (location?.hash?.startsWith('#local-connection=') || pendingEnvelope) return start();
    if (!client || state.connection !== 'connected') return state;
    try { const response = await request('settings.status'); await response.body?.cancel(); }
    catch { /* request has already published a safe connection state. */ }
    return state;
  }
  async function disconnect() {
    const selected = client;
    generation++; starting = null; streamController?.abort(); streamController = null;
    client = null; descriptor = null; pendingEnvelope = null; failureError = null;
    calendarNavigations.clear();
    publish({ connection: 'disconnected', events: 'idle', runtimeMode: 'unknown', apiConfigured: false,
      aiReady: false, noticeCode: 'CONNECTION_REQUIRED', firstFailure: null, eventFailure: null });
    if (!selected) return Object.freeze({ disconnected: true, confirmed: false });
    try { return await selected.disconnect(); }
    catch { publish({ noticeCode: 'CONNECTION_DISCONNECT_UNCONFIRMED' }); return Object.freeze({ disconnected: true, confirmed: false }); }
    finally { selected.close(); }
  }
  function isCurrentRuntimeUrl(value) {
    if (!client || state.connection !== 'connected' || !descriptor || typeof value !== 'string') return false;
    let url;
    try { url = new URL(value); } catch { return false; }
    return url.origin === descriptor.baseUrl && !url.username && !url.password && !url.hash;
  }
  function describeFailure(error) {
    if (arguments.length && !(error instanceof LocalConnectionError)) return null;
    const selected = arguments.length ? safeError(error) : failureError ?? (state.connection === 'permission-denied'
      ? new LocalConnectionError('CONNECTION_PERMISSION_DENIED', null, 'permission')
      : state.connection === 'awaiting-permission' ? new LocalConnectionError('CONNECTION_PERMISSION_REQUIRED', null, 'permission') : null);
    if (!selected) return null;
    if (selected.code === 'CONNECTION_PERMISSION_DENIED') return 'Chrome 주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 실행 프로그램에서 웹콘솔을 새로 열어 주세요.';
    if (selected.code === 'CONNECTION_PERMISSION_REQUIRED') return '실행 프로그램에서 웹콘솔을 새로 열고 연결 버튼을 눌러 주세요. Chrome이 로컬 네트워크 접근을 물으면 허용해 주세요.';
    const phase = phases[selected.stage];
    if (!phase) return null;
    const http = selected.status === null ? '' : `(HTTP ${selected.status})`;
    return `내 컴퓨터 실행 프로그램의 ${phase} 단계에서 실패했어요${http}. 실행 프로그램에서 웹콘솔을 새로 열어 주세요.`;
  }
  return Object.freeze({ start, connect, request, recheck, disconnect, describeFailure,
    acceptsLocalNavigation: value => calendarNavigations.has(value) && isCurrentRuntimeUrl(value),
    status: () => state,
    diagnostics: () => Object.freeze(diagnosticEntries.slice()),
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A connection listener is required.');
      listeners.add(listener); listener(state); return () => listeners.delete(listener);
    },
    close() { unavailable(new LocalConnectionError('CONNECTION_CLOSED', null, 'operation')); },
  });
}

export const connection = createConsoleConnection();
globalThis.HAEMA_LOCAL_CONNECTION = connection;
