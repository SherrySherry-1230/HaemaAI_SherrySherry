// @editedBy SherrySherry 2026-11-18
import { LocalConnectionError, validateRememberedBinding } from './local-connection-client.mjs?v=20261119-recovery';

const STORE = 'connections';
const KEY = 'current';
const unavailable = () => new LocalConnectionError('REMEMBERED_CONNECTION_STORE_UNAVAILABLE', null, 'remembered-store');
const opaqueId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
const wrapped = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === 'binding,revision,storageVersion' && value.storageVersion === 1 && opaqueId(value.revision);
function metadata(value) {
  const seen = new Set();
  let count = 0, bytes = 0;
  function visit(item) {
    if (++count > 1024) throw new Error();
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') {
      bytes += item.length;
      if (bytes > 32_768) throw new Error();
      return item;
    }
    if (!item || typeof item !== 'object' || seen.has(item)) throw new Error();
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new Error();
      for (let index = 0; index < item.length; index++) if (!Object.hasOwn(item, index)) throw new Error();
      result = item.map(visit);
    }
    else if ([Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      result = Object.keys(item).sort().map(key => {
        bytes += key.length;
        if (bytes > 32_768) throw new Error();
        return [key, visit(item[key])];
      });
    } else throw new Error();
    seen.delete(item);
    return [Array.isArray(item) ? 'array' : 'object', result];
  }
  try { return JSON.stringify(visit(value)); } catch { return null; }
}
const canonical = binding => JSON.stringify([binding.version, binding.grantId, binding.expiresAt,
  Object.keys(binding.descriptor).sort().map(key => [key, binding.descriptor[key]]),
  binding.publicKey.kty, binding.publicKey.crv, binding.publicKey.x, binding.publicKey.y]);

export function createRememberedConnectionStore(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  const databaseName = options.databaseName ?? 'haema-local-connection';
  const settings = { currentOrigin: options.currentOrigin ?? globalThis.location?.origin, crypto: options.crypto, now: options.now };
  const observations = new WeakMap();
  let observation = null;
  if (typeof databaseName !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(databaseName)) throw unavailable();
  function observe(value) {
    const receipt = Object.freeze({});
    observations.set(receipt, wrapped(value) ? { revision: value.revision } : { metadata: metadata(value) });
    observation = receipt;
  }
  function revision() {
    try {
      const bytes = (options.crypto ?? globalThis.crypto).getRandomValues(new Uint8Array(32));
      return globalThis.btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    } catch { throw unavailable(); }
  }

  function open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB?.open !== 'function') { reject(unavailable()); return; }
      let request, finished = false;
      const failed = () => { if (!finished) { finished = true; reject(unavailable()); } };
      try {
        request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          try {
            if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
          } catch { try { request.transaction?.abort(); } catch { /* The failed open is reported below. */ } failed(); }
        };
        request.onerror = failed;
        request.onblocked = failed;
        request.onsuccess = () => {
          const database = request.result;
          if (finished) { database.close(); return; }
          try {
            if (!database.objectStoreNames.contains(STORE)) throw unavailable();
            database.onversionchange = () => database.close();
            finished = true; resolve(database);
          } catch { database.close(); failed(); }
        };
      } catch { failed(); }
    });
  }
  async function transaction(mode, perform) {
    const database = await open();
    try {
      return await new Promise((resolve, reject) => {
        let result;
        try {
          const pending = database.transaction(STORE, mode);
          pending.oncomplete = () => resolve(result);
          pending.onerror = pending.onabort = () => reject(unavailable());
          const request = perform(pending.objectStore(STORE));
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => reject(unavailable());
        } catch { reject(unavailable()); }
      });
    } catch { throw unavailable(); }
    finally { database.close(); }
  }
  async function load() {
    observation = null;
    let value;
    try { value = await transaction('readonly', store => store.get(KEY)); }
    catch (error) { observation = null; throw error; }
    observe(value);
    if (value === undefined) return null;
    return validateRememberedBinding(wrapped(value) ? value.binding : value, settings);
  }
  async function save(value) {
    const binding = await validateRememberedBinding(value, settings);
    await transaction('readwrite', store => store.put({ storageVersion: 1, revision: revision(), binding }, KEY));
    const saved = await load();
    if (!saved || canonical(saved) !== canonical(binding)) throw unavailable();
    return saved;
  }
  async function clear() { await transaction('readwrite', store => store.delete(KEY)); }
  async function clearIf(expectedGrantId) {
    if (!opaqueId(expectedGrantId)) {
      throw new LocalConnectionError('REMEMBERED_CONNECTION_INVALID', null, 'remembered-store');
    }
    const database = await open();
    try {
      return await new Promise((resolve, reject) => {
        let deleted = false;
        try {
          const pending = database.transaction(STORE, 'readwrite');
          pending.oncomplete = () => resolve(deleted);
          pending.onerror = pending.onabort = () => reject(unavailable());
          const store = pending.objectStore(STORE), request = store.get(KEY);
          request.onerror = () => reject(unavailable());
          request.onsuccess = () => {
            try {
              const binding = wrapped(request.result) ? request.result.binding : request.result;
              if (binding?.grantId !== expectedGrantId) return;
              const deletion = store.delete(KEY);
              deletion.onerror = () => reject(unavailable());
              deletion.onsuccess = () => { deleted = true; };
            } catch {
              try { pending.abort(); } catch { /* A failed transaction cannot confirm deletion. */ }
              reject(unavailable());
            }
          };
        } catch { reject(unavailable()); }
      });
    } catch { throw unavailable(); }
    finally { database.close(); }
  }
  async function clearSnapshot(receipt) {
    const expected = receipt && typeof receipt === 'object' ? observations.get(receipt) : null;
    if (!expected || (!expected.revision && expected.metadata === null)) return false;
    const database = await open();
    try {
      return await new Promise((resolve, reject) => {
        let deleted = false;
        try {
          const pending = database.transaction(STORE, 'readwrite');
          pending.oncomplete = () => resolve(deleted);
          pending.onerror = pending.onabort = () => reject(unavailable());
          const store = pending.objectStore(STORE), request = store.get(KEY);
          request.onerror = () => reject(unavailable());
          request.onsuccess = () => {
            try {
              const value = request.result;
              if (value === undefined || (expected.revision
                ? !wrapped(value) || value.revision !== expected.revision
                : wrapped(value) || metadata(value) !== expected.metadata)) return;
              const deletion = store.delete(KEY);
              deletion.onerror = () => reject(unavailable());
              deletion.onsuccess = () => { deleted = true; };
            } catch {
              try { pending.abort(); } catch { /* A failed transaction cannot confirm deletion. */ }
              reject(unavailable());
            }
          };
        } catch { reject(unavailable()); }
      });
    } catch { throw unavailable(); }
    finally { database.close(); }
  }
  return Object.freeze({ load, save, clear, clearIf, snapshot: () => observation, clearSnapshot });
}
