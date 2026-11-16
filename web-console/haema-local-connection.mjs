// @editedBy YAONG1230 2026-11-16
import { consumeConnectionFragment, createLocalConnectionClient, LocalConnectionError } from './local-connection-client.mjs';

const connectionFailures = new Set([
  'CONNECTION_REQUIRED', 'CONNECTION_EXPIRED', 'CONNECTION_CLOSED',
  'CONNECTION_UNAVAILABLE', 'CONNECTION_STREAM_FAILED', 'CONNECTION_STREAM_REJECTED',
]);

export function createConsoleConnection(options = {}) {
  const location = options.location ?? globalThis.location;
  const history = options.history ?? globalThis.history;
  const clientFactory = options.clientFactory ?? createLocalConnectionClient;
  const listeners = new Set();
  const calendarNavigations = new Set();
  let client = null, descriptor = null, generation = 0, starting = null, streamController = null;
  let state = Object.freeze({ connection: 'disconnected', runtimeMode: 'unknown', apiConfigured: false,
    aiReady: false, noticeCode: 'CONNECTION_REQUIRED' });

  function publish(next) {
    state = Object.freeze({ ...state, ...next });
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* A view cannot interrupt connection cleanup. */ }
    }
    return state;
  }
  function stopCurrent() {
    generation++;
    streamController?.abort();
    streamController = null;
    client?.close();
    client = null;
    descriptor = null;
    calendarNavigations.clear();
  }
  function unavailable(code = 'CONNECTION_UNAVAILABLE') {
    stopCurrent();
    publish({ connection: 'disconnected', runtimeMode: 'unknown', apiConfigured: false,
      aiReady: false, noticeCode: code });
  }
  function safeError(error) {
    return error instanceof LocalConnectionError ? error : new LocalConnectionError('CONNECTION_UNAVAILABLE');
  }
  function applySettings(value) {
    const valid = value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.configured === 'boolean';
    if (!valid) {
      publish({ runtimeMode: 'unknown', apiConfigured: false, aiReady: false, noticeCode: 'SETTINGS_UNCONFIRMED' });
      return;
    }
    const setupOnly = value.mode === 'setup-only' || value.aiReady === false;
    publish({ runtimeMode: setupOnly ? 'setup-only' : 'full', apiConfigured: value.configured,
      aiReady: !setupOnly && value.configured,
      noticeCode: setupOnly ? 'AI_SETUP_REQUIRED' : value.configured ? '' : 'API_SETTINGS_REQUIRED' });
  }
  async function inspect(response, operation, activeGeneration) {
    if (generation !== activeGeneration) return;
    if (operation !== 'settings.status' && operation !== 'calendar.connect' && response.status !== 503) return;
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim();
    if (contentType !== 'application/json') {
      if (operation === 'settings.status') applySettings(null);
      return;
    }
    let value;
    try { value = await response.clone().json(); }
    catch { if (operation === 'settings.status') applySettings(null); return; }
    if (generation !== activeGeneration) return;
    if (operation === 'settings.status') applySettings(response.ok ? value : null);
    else if (operation === 'calendar.connect' && response.ok && value?.success === true && isCurrentRuntimeUrl(value.authorizationUrl)) {
      calendarNavigations.clear();
      calendarNavigations.add(value.authorizationUrl);
    }
    else if (value?.code === 'AI_SETUP_REQUIRED' && value?.aiReady === false) {
      publish({ runtimeMode: 'setup-only', aiReady: false, noticeCode: 'AI_SETUP_REQUIRED' });
    }
  }
  async function request(operation, input = {}, settings = {}) {
    if (starting) await starting;
    const selected = client;
    const activeGeneration = generation;
    if (!selected || state.connection !== 'connected') throw new LocalConnectionError('CONNECTION_REQUIRED');
    try {
      const response = await selected.invoke(operation, input, settings);
      if (generation !== activeGeneration || client !== selected) {
        await response.body?.cancel();
        throw new LocalConnectionError('CONNECTION_CLOSED');
      }
      await inspect(response, operation, activeGeneration);
      return response;
    } catch (caught) {
      const error = safeError(caught);
      if (generation === activeGeneration && connectionFailures.has(error.code)) unavailable(error.code);
      throw error;
    }
  }
  function watchEvents(selected, activeGeneration) {
    streamController?.abort();
    const controller = new AbortController();
    streamController = controller;
    void (async () => {
      try {
        for await (const event of selected.events({ signal: controller.signal })) {
          if (client !== selected || generation !== activeGeneration) return;
          let value;
          try { value = JSON.parse(event.data); } catch { continue; }
          if (value?.status === 'streaming' && Number.isFinite(value.timestamp)) continue;
        }
        if (!controller.signal.aborted && client === selected && generation === activeGeneration) unavailable();
      } catch (error) {
        if (!controller.signal.aborted && client === selected && generation === activeGeneration) {
          unavailable(safeError(error).code);
        }
      }
    })();
  }
  function start() {
    if (starting) return starting;
    let envelope;
    try { envelope = consumeConnectionFragment({ location, history }); }
    catch (error) {
      unavailable(safeError(error).code);
      return Promise.resolve(state);
    }
    if (!envelope) return Promise.resolve(state);
    stopCurrent();
    const activeGeneration = generation;
    publish({ connection: 'connecting', runtimeMode: 'unknown', apiConfigured: false, aiReady: false, noticeCode: '' });
    const pending = (async () => {
      try {
        descriptor = envelope.descriptor;
        const selected = clientFactory(descriptor, options.clientOptions ?? {});
        client = selected;
        await selected.pair(envelope.code);
        envelope = null;
        if (generation !== activeGeneration || client !== selected) return state;
        publish({ connection: 'connected', noticeCode: 'SETTINGS_UNCONFIRMED' });
        const response = await selected.invoke('settings.status', {});
        await inspect(response, 'settings.status', activeGeneration);
        await response.body?.cancel();
        if (generation === activeGeneration && client === selected) watchEvents(selected, activeGeneration);
      } catch (error) {
        if (generation === activeGeneration) unavailable(safeError(error).code);
      } finally {
        envelope = null;
      }
      return state;
    })();
    starting = pending;
    void pending.finally(() => { if (starting === pending) starting = null; });
    return pending;
  }
  async function recheck() {
    if (location?.hash?.startsWith('#local-connection=')) return start();
    if (!client || state.connection !== 'connected') return state;
    try { const response = await request('settings.status'); await response.body?.cancel(); }
    catch { /* request has already published a safe connection state. */ }
    return state;
  }
  async function disconnect() {
    const selected = client;
    generation++;
    streamController?.abort(); streamController = null;
    client = null; descriptor = null;
    calendarNavigations.clear();
    publish({ connection: 'disconnected', runtimeMode: 'unknown', apiConfigured: false,
      aiReady: false, noticeCode: 'CONNECTION_REQUIRED' });
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
  function acceptsLocalNavigation(value) {
    return calendarNavigations.has(value) && isCurrentRuntimeUrl(value);
  }
  return Object.freeze({ start, request, recheck, disconnect, acceptsLocalNavigation,
    status: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A connection listener is required.');
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    close() { unavailable('CONNECTION_CLOSED'); },
  });
}

export const connection = createConsoleConnection();
globalThis.HAEMA_LOCAL_CONNECTION = connection;
