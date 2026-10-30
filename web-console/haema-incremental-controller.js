// @editedBy YAONG1230 2026-10-22
// Local queue for the published incremental API. It never runs a host reply.
(function (global) {
    'use strict';
    const PREFIX = 'haema_incremental_session_v1:';
    const copy = value => JSON.parse(JSON.stringify(value));
    const id = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512;
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    const sameScope = (a, b) => !!a && !!b && a.ownerId === b.ownerId && a.storageRoot === b.storageRoot && a.storageId === b.storageId;
    const validScope = value => value && id(value.ownerId) && id(value.storageId) && typeof value.storageRoot === 'string' && !!value.storageRoot.trim();
    const failure = (code, message) => ({ ok: false, code, message });
    const sameInput = (a, b) => a.inputId === b.inputId && a.sequence === b.sequence && a.text === b.text && a.at === b.at;

    function create(options) {
        const scope = copy(options.scope);
        const conversationId = options.conversationId;
        if (!validScope(scope) || !id(conversationId)) throw new TypeError('Invalid incremental scope');
        const client = options.client;
        const now = options.now || Date.now;
        const uuid = options.uuid || (() => global.crypto.randomUUID());
        const later = options.setTimeout || global.setTimeout.bind(global);
        const cancel = options.clearTimeout || global.clearTimeout.bind(global);
        const sampleMs = Math.max(500, options.sampleMs || 500);
        const pollMs = Math.max(250, options.pollMs || 1000);
        const key = PREFIX + JSON.stringify([scope.ownerId, scope.storageRoot, scope.storageId, conversationId]);
        let storage, raw = null, data = { version: 1, scope, conversationId, sessionId: null, nextSequence: 1, draft: null, entries: [], reported: {} };
        let session = null, status = 'idle', error = null, storageBlocked = false;
        let active = false, epoch = 0, busy = false, starting = null, pollTimer = null, sampleTimer = null, snapshotReady = false;

        function inputValid(input, sessionId) {
            return input && input.sessionId === sessionId && id(input.inputId) && integer(input.sequence) && input.sequence > 0 &&
                integer(input.revision) && typeof input.text === 'string' && (input.at === undefined || Number.isFinite(input.at));
        }
        function validStore(value) {
            return value && value.version === 1 && sameScope(value.scope, scope) && value.conversationId === conversationId &&
                (value.sessionId === null || id(value.sessionId)) && integer(value.nextSequence) && value.nextSequence > 0 &&
                (value.sessionId !== null || (value.draft === null && value.entries?.length === 0)) &&
                (value.draft === null || inputValid(value.draft, value.sessionId)) && Array.isArray(value.entries) &&
                value.entries.every(entry => inputValid(entry.input, value.sessionId) && entry.input.text.trim() &&
                    ['queued', 'sending', 'uncertain', 'accepted'].includes(entry.delivery) &&
                    (!entry.retry || (id(entry.retry.id) && integer(entry.retry.baseGeneration) && ['queued', 'sending', 'uncertain', 'accepted'].includes(entry.retry.delivery)))) &&
                new Set(value.entries.map(entry => entry.input.inputId)).size === value.entries.length &&
                new Set(value.entries.map(entry => entry.input.sequence)).size === value.entries.length &&
                value.entries.every(entry => entry.input.sequence < value.nextSequence) &&
                value.reported && typeof value.reported === 'object' && !Array.isArray(value.reported) &&
                Object.values(value.reported).every(value => typeof value === 'string');
        }
        try {
            storage = options.storage || global.sessionStorage;
            raw = storage.getItem(key);
            if (raw !== null) {
                const stored = JSON.parse(raw);
                if (!validStore(stored)) throw Error('Invalid queue');
                data = stored;
                for (const entry of data.entries) {
                    if (entry.delivery === 'sending') entry.delivery = 'uncertain';
                    if (entry.retry?.delivery === 'sending') entry.retry.delivery = 'uncertain';
                }
            }
        } catch {
            storageBlocked = true;
            status = 'storage-error';
            error = failure('INCREMENTAL_STORAGE', '보관된 입력을 확인하지 못했어요. 기존 기록은 그대로 두었습니다.');
        }

        function getState() {
            return copy({ scope, conversationId, status, error, storageBlocked, session, sessionId: data.sessionId,
                entries: data.entries, draft: data.draft, nextSequence: data.nextSequence, active });
        }
        function call(name, value) {
            try { options[name]?.(copy(value)); } catch { /* A view callback must not replay a request. */ }
        }
        function notify() { call('onChange', getState()); }
        function persist(next, received = false) {
            if (storageBlocked) return false;
            try {
                if (storage.getItem(key) !== raw) throw Error('Queue changed');
                const encoded = JSON.stringify(next);
                storage.setItem(key, encoded);
                raw = encoded;
                data = next;
                return true;
            } catch {
                // Keep the last stored bytes. A known remote acknowledgment may
                // remain visible in memory, but no further write request is sent.
                if (received) data = next;
                storageBlocked = true;
                status = 'storage-error';
                error = failure('INCREMENTAL_STORAGE', '입력을 이 탭에 보관하지 못했어요. 내용을 복사해 두신 뒤 다시 확인해 주세요.');
                notify();
                return false;
            }
        }
        function blocked() {
            return storageBlocked || ['session-lost', 'scope-invalid', 'unsupported', 'conflict', 'response-error'].includes(status);
        }
        function unavailable() {
            return error || failure('INCREMENTAL_NOT_READY', '연속 입력 연결을 확인하고 있어요. 입력한 내용은 유지했어요.');
        }
        function invalidSession(message) {
            status = 'session-lost';
            error = failure('INCREMENTAL_SESSION_LOST', message || '이전 연속 입력 세션을 확인하지 못했어요. 보관한 입력은 자동으로 다시 보내지 않습니다.');
            notify();
        }
        function remoteFailure(result) {
            error = { ok: false, code: result.code || 'INCREMENTAL_NETWORK', message: result.message || '연속 입력 응답을 확인하지 못했어요.', status: result.status || 0 };
            if (result.unsupported) status = 'unsupported';
            else if (['SESSION_REQUIRED', 'STORAGE_REQUIRED'].includes(result.code)) invalidSession();
            else if (['INCREMENTAL_SCOPE', 'INCREMENTAL_SCOPE_MISMATCH'].includes(result.code)) {
                status = 'scope-invalid';
                call('onScopeInvalid', { scope, conversationId, error });
            }
            else if (result.code === 'INCREMENTAL_INVALID_RESPONSE') status = 'response-error';
            notify();
        }
        async function invoke(method, args, token, mutation) {
            if (!active || token !== epoch) return null;
            if (mutation && options.verifyScope) {
                try {
                    const verified = await options.verifyScope(copy(scope));
                    if (verified === false || verified?.ok === false) throw Error('Scope changed');
                }
                catch {
                    if (!active || token !== epoch) return null;
                    status = 'scope-invalid';
                    error = failure('INCREMENTAL_SCOPE', '저장소 연결이 달라졌어요. 입력은 기존 범위에 보관했습니다.');
                    call('onScopeInvalid', { scope, conversationId, error });
                    notify();
                    return null;
                }
            }
            if (!active || token !== epoch || (mutation && blocked())) return null;
            let result;
            try { result = await client[method](copy(scope), conversationId, ...args.map(copy)); }
            catch { result = failure('INCREMENTAL_NETWORK', '연속 입력 응답을 확인하지 못했어요. 같은 입력으로 다시 보내기를 선택할 수 있어요.'); }
            return active && token === epoch ? result : null;
        }
        function applySession(view) {
            if (!view || view.ownerId !== scope.ownerId || view.storageId !== scope.storageId || view.conversationId !== conversationId ||
                !id(view.sessionId) || view.disposed || (data.sessionId && data.sessionId !== view.sessionId)) {
                invalidSession();
                return false;
            }
            if (session && (view.processGeneration < session.processGeneration || view.analysisGeneration < session.analysisGeneration)) return false;
            const next = copy(data);
            if (next.draft && (next.draft.sequence < view.nextSequence ||
                (next.draft.sequence === view.nextSequence && view.draft && next.draft.inputId !== view.draft.inputId))) {
                status = 'conflict';
                error = failure('INPUT_CONFLICT', '다른 입력이 같은 순서에 접수됐어요. 작성한 원문은 그대로 보관했습니다.');
                notify();
                return false;
            }
            if (!next.sessionId && !next.draft && !next.entries.length && view.draft) {
                const draft = view.draft;
                next.draft = { sessionId: view.sessionId, inputId: draft.inputId, sequence: draft.sequence,
                    revision: draft.revision, text: draft.text, ...(draft.at === undefined ? {} : { at: draft.at }) };
            }
            next.sessionId = view.sessionId;
            next.nextSequence = Math.max(next.nextSequence, view.nextSequence);
            for (const entry of next.entries) {
                const found = view.submissions.find(item => item.inputId === entry.input.inputId);
                if (found && !sameInput(found, entry.input)) {
                    status = 'conflict';
                    error = failure('INPUT_CONFLICT', '같은 입력 식별자의 원문이 달라요. 보관한 원문은 덮어쓰지 않았습니다.');
                    notify();
                    return false;
                }
                if (found) {
                    entry.delivery = 'accepted';
                    entry.processing = copy(found.processing);
                    entry.error = null;
                    if (entry.retry && entry.retry.delivery !== 'accepted' && view.processGeneration > entry.retry.baseGeneration && view.submissions.at(-1)?.inputId === entry.input.inputId) {
                        entry.retry.delivery = 'accepted';
                        delete next.reported[entry.input.inputId];
                    }
                } else if (entry.delivery === 'accepted' || entry.input.sequence < view.nextSequence) {
                    status = 'conflict';
                    error = failure('INPUT_CONFLICT', '서버의 제출 순서와 보관된 입력이 달라요. 누락된 선행 입력을 확인해 주세요.');
                    notify();
                    return false;
                }
            }
            session = copy(view);
            if (!persist(next, true)) return false;
            status = 'ready';
            error = null;
            for (const submission of view.submissions) {
                if (!active) break;
                if (!['completed', 'failed', 'superseded'].includes(submission.processing.status)) continue;
                const stamp = JSON.stringify(submission.processing);
                if (data.reported[submission.inputId] === stamp) continue;
                const recorded = copy(data);
                recorded.reported[submission.inputId] = stamp;
                if (!persist(recorded, true)) break;
                const input = { sessionId: view.sessionId, inputId: submission.inputId, sequence: submission.sequence,
                    revision: submission.revision, text: submission.text, ...(submission.at === undefined ? {} : { at: submission.at }) };
                call('onResult', { scope, conversationId, sessionId: view.sessionId, input,
                    processing: submission.processing, result: submission.processing.result ?? null,
                    isLatest: submission.inputId === view.submissions.at(-1)?.inputId && !data.entries.some(entry => entry.input.sequence > submission.sequence) });
            }
            notify();
            return true;
        }
        async function readSession(token) {
            const result = await invoke('read', [data.sessionId], token, false);
            if (!result) return false;
            if (!result.ok) { remoteFailure(result); return false; }
            return applySession(result.session);
        }
        function schedulePoll() {
            cancel(pollTimer);
            pollTimer = null;
            if (!active || blocked()) return;
            pollTimer = later(async () => {
                if (!active || blocked()) return;
                await refresh(); schedulePoll();
            }, pollMs);
        }
        async function refresh() {
            if (!active || busy || (blocked() && status !== 'response-error') || !data.sessionId) return unavailable();
            busy = true;
            const token = epoch;
            try { return { ok: await readSession(token) }; }
            finally { busy = false; if (active && token === epoch) void pump(); }
        }
        async function pump() {
            if (!active || busy || blocked() || !session) return;
            busy = true;
            const token = epoch;
            try {
                while (active && token === epoch && !blocked()) {
                    const first = data.entries.find(entry => entry.delivery !== 'accepted');
                    const retryEntry = data.entries.find(entry => entry.retry?.delivery === 'queued');
                    let method, input, retryId;
                    if (first) {
                        if (first.delivery !== 'queued') break;
                        method = 'submit'; input = copy(first.input);
                    } else if (retryEntry) {
                        method = 'retry'; input = copy(retryEntry.input); retryId = retryEntry.retry.id;
                    } else if (snapshotReady && data.draft) {
                        snapshotReady = false; method = 'snapshot'; input = copy(data.draft);
                    } else break;
                    if (method !== 'snapshot') {
                        const next = copy(data), entry = next.entries.find(item => item.input.inputId === input.inputId);
                        if (method === 'submit') entry.delivery = 'sending'; else entry.retry.delivery = 'sending';
                        if (!persist(next)) break;
                        notify();
                    }
                    const result = await invoke(method, method === 'retry' ? [input, retryId] : [input], token, true);
                    if (!result) break;
                    if (result.ok) {
                        if (method !== 'snapshot' && ((!result.accepted && !result.replayed) || !result.session.submissions.some(item => sameInput(item, input)))) {
                            const next = copy(data), entry = next.entries.find(item => item.input.inputId === input.inputId);
                            if (method === 'submit') entry.delivery = 'uncertain'; else entry.retry.delivery = 'uncertain';
                            persist(next);
                            remoteFailure(failure('INCREMENTAL_INVALID_RESPONSE', '이 입력의 접수를 확인하지 못했어요. 보관된 입력을 다시 확인해 주세요.'));
                            break;
                        }
                        if (!applySession(result.session)) break;
                    } else {
                        if (method !== 'snapshot') {
                            const next = copy(data), entry = next.entries.find(item => item.input.inputId === input.inputId);
                            if (method === 'submit') entry.delivery = 'uncertain'; else entry.retry.delivery = 'uncertain';
                            entry.error = { code: result.code, message: result.message };
                            persist(next);
                        }
                        remoteFailure(result);
                        if (result.status === 409 && !blocked()) await readSession(token);
                        if (method !== 'snapshot') break;
                    }
                }
            } finally { busy = false; schedulePoll(); }
        }
        async function start() {
            if (starting) return starting;
            if (active) return { ok: !blocked(), state: getState() };
            if (blocked()) return unavailable();
            if (data.entries.some(entry => entry.delivery === 'sending' || entry.retry?.delivery === 'sending')) {
                const next = copy(data);
                for (const entry of next.entries) {
                    if (entry.delivery === 'sending') entry.delivery = 'uncertain';
                    if (entry.retry?.delivery === 'sending') entry.retry.delivery = 'uncertain';
                }
                if (!persist(next)) return unavailable();
            }
            active = true;
            const token = ++epoch;
            status = 'connecting'; notify();
            starting = (async () => {
                const result = await invoke(data.sessionId ? 'read' : 'open', data.sessionId ? [data.sessionId] : [], token, !data.sessionId);
                if (!result) return unavailable();
                if (!result.ok) {
                    remoteFailure(result);
                    if (!blocked()) { active = false; status = 'connection-error'; notify(); }
                    return result;
                }
                if (!applySession(result.session)) return unavailable();
                void pump(); schedulePoll();
                return { ok: true, state: getState() };
            })();
            try { return await starting; } finally { starting = null; }
        }
        function stop() {
            active = false; ++epoch;
            cancel(pollTimer); cancel(sampleTimer);
            pollTimer = sampleTimer = null; snapshotReady = false;
            if (!blocked()) status = 'stopped';
            notify();
        }
        function draftFor(text, at) {
            const draft = data.draft ? copy(data.draft) : { sessionId: data.sessionId, inputId: uuid(), sequence: data.nextSequence, revision: 0, text, at: at ?? now() };
            if (draft.text !== text || (at !== undefined && draft.at !== at)) {
                draft.revision++; draft.text = text;
                if (at !== undefined) draft.at = at;
            }
            return draft;
        }
        function sample(text) {
            if (!active || !session || blocked()) return unavailable();
            if (typeof text !== 'string') return failure('INVALID_INCREMENTAL_INPUT', '입력 내용을 확인해 주세요.');
            if ((!data.draft && text === '') || data.draft?.text === text) return { ok: true, changed: false };
            const next = copy(data);
            next.draft = draftFor(text);
            if (!persist(next)) return unavailable();
            if (sampleTimer === null) sampleTimer = later(() => { sampleTimer = null; snapshotReady = true; void pump(); }, sampleMs);
            return { ok: true, changed: true, input: copy(data.draft) };
        }
        function enqueue(text, at) {
            if (!active || !session || blocked()) return unavailable();
            if (typeof text !== 'string' || !text.trim() || (at !== undefined && !Number.isFinite(at))) return failure('INVALID_INCREMENTAL_INPUT', '보낼 내용을 입력해 주세요.');
            const input = draftFor(text, at);
            const next = copy(data);
            next.entries.push({ input, delivery: 'queued', processing: null, retry: null, error: null });
            next.nextSequence++; next.draft = null;
            if (!persist(next)) return unavailable();
            cancel(sampleTimer); sampleTimer = null; snapshotReady = false;
            notify(); void pump();
            return { ok: true, input: copy(input) };
        }
        function retryDelivery(inputId) {
            if (!active || !session || blocked()) return unavailable();
            const next = copy(data), entry = next.entries.find(item => item.input.inputId === inputId);
            if (!entry || (entry.delivery !== 'uncertain' && entry.retry?.delivery !== 'uncertain')) return failure('INPUT_CONFLICT', '다시 보낼 미확인 입력이 없습니다.');
            if (entry.delivery === 'uncertain') entry.delivery = 'queued'; else entry.retry.delivery = 'queued';
            if (!persist(next)) return unavailable();
            notify(); void pump();
            return { ok: true, input: copy(entry.input) };
        }
        function retry(inputId) {
            if (!active || !session || blocked()) return unavailable();
            const latest = session.submissions.at(-1);
            if (latest?.inputId !== inputId || latest.processing.status !== 'failed' || data.entries.some(item => item.delivery !== 'accepted')) return failure('INPUT_CONFLICT', '가장 최근 실패한 입력만 다시 처리할 수 있어요.');
            const next = copy(data);
            let entry = next.entries.find(item => item.input.inputId === inputId);
            if (!entry) {
                entry = { input: { sessionId: data.sessionId, inputId, sequence: latest.sequence, revision: latest.revision, text: latest.text,
                    ...(latest.at === undefined ? {} : { at: latest.at }) }, delivery: 'accepted', processing: copy(latest.processing), retry: null, error: null };
                next.entries.push(entry);
            }
            if (entry.retry && entry.retry.delivery !== 'accepted') return failure('INPUT_CONFLICT', '이전 재처리 요청을 먼저 확인해 주세요.');
            entry.retry = { id: uuid(), delivery: 'queued', baseGeneration: session.processGeneration };
            if (!persist(next)) return unavailable();
            notify(); void pump();
            return { ok: true, input: copy(entry.input), retryId: entry.retry.id };
        }
        return { start, stop, enqueue, sample, retry, retryDelivery, refresh, getState };
    }
    global.HAEMA_INCREMENTAL_CONTROLLER = { create, sameScope, key: PREFIX };
})(window);
