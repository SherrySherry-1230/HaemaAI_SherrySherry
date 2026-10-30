// @editedBy YAONG1230 2026-10-18
// @editedBy YAONG1230 2026-10-22: share conversation identity with incremental delivery
// Pending requests live only in this tab. A retry reuses the original request.
(function (global) {
    'use strict';
    const KEY = 'haema_conversation_pending_v1';
    const IDENTITY_KEY = 'haema_conversation_identity_v1';
    const recordError = () => Object.assign(new Error('이 탭에 보관한 전송 기록을 확인할 수 없어 전송을 멈췄어요. 기존 기록은 그대로 두었습니다.'), { code: 'CONVERSATION_SESSION' });
    const validId = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512;
    const validTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const samePath = (a, b) => !!a && !!b && a.ownerId === b.ownerId && a.storageRoot === b.storageRoot;
    const sameScope = (a, b) => samePath(a, b) && a.storageId === b.storageId;
    const validScope = scope => scope && validId(scope.ownerId) && typeof scope.storageRoot === 'string' && scope.storageRoot.trim().length > 0 &&
        (scope.storageId === undefined || validId(scope.storageId));
    const scopeKey = scope => JSON.stringify([scope.ownerId, scope.storageRoot, scope.storageId ?? null]);
    const clone = value => JSON.parse(JSON.stringify(value));

    function validRequest(request, session) {
        const turn = request?.turns?.[0];
        return request && request.ownerId === session.scope.ownerId && validId(request.conversationId) && request.conversationId === session.conversationId &&
            Array.isArray(request.turns) && request.turns.length === 1 && turn && validId(turn.utteranceId) &&
            turn.role === 'user' && typeof turn.text === 'string' && turn.text.trim().length > 0 &&
            validTime(turn.at) && validTime(turn.receivedAt) && turn.final === true;
    }

    function create(options = {}) {
        const storage = () => options.storage || global.sessionStorage;
        const uuid = options.uuid || (() => global.crypto.randomUUID());
        const now = options.now || Date.now;
        const preparedConversations = new Map();
        // Only conversation identifiers survive a browser restart. Unsent text
        // stays in this tab; token amounts are restored from the server ledger.
        function identities() {
            try {
                const raw = (options.identityStorage || global.localStorage).getItem(IDENTITY_KEY);
                const data = raw === null ? { version: 1, sessions: [] } : JSON.parse(raw);
                if (data?.version !== 1 || !Array.isArray(data.sessions)) throw recordError();
                const seen = new Set();
                for (const item of data.sessions) {
                    if (!validScope(item?.scope) || !validId(item.conversationId)) throw recordError();
                    const key = scopeKey(item.scope);
                    if (seen.has(key)) throw recordError();
                    seen.add(key);
                }
                return data;
            } catch { throw recordError(); }
        }
        function rememberIdentity(scope, conversationId) {
            try {
                const data = identities();
                const item = data.sessions.find(entry => sameScope(entry.scope, scope));
                if (item?.conversationId === conversationId) return;
                if (item) item.conversationId = conversationId;
                else data.sessions.push({ scope: clone(scope), conversationId });
                (options.identityStorage || global.localStorage).setItem(IDENTITY_KEY, JSON.stringify(data));
            } catch { throw recordError(); }
        }
        function current(scope) {
            if (!validScope(scope)) throw recordError();
            const session = read().sessions.find(item => sameScope(item.scope, scope));
            if (session) {
                rememberIdentity(scope, session.conversationId);
                return session.conversationId;
            }
            const directory = identities().sessions;
            const known = directory.find(item => sameScope(item.scope, scope));
            // A legacy conversation ID can locate its server ledger. Its pending
            // text is never rebound to a newly identified physical store.
            const legacy = scope.storageId === undefined ? null : directory.find(item =>
                item.scope.storageId === undefined && samePath(item.scope, scope));
            return known?.conversationId || legacy?.conversationId || null;
        }
        function read() {
            try {
                const raw = storage().getItem(KEY);
                if (raw === null) return { version: 1, sessions: [] };
                const data = JSON.parse(raw);
                if (data?.version !== 1 || !Array.isArray(data.sessions)) throw recordError();
                const scopes = new Set();
                for (const session of data.sessions) {
                    if (!validScope(session?.scope) || !validId(session.conversationId) || !Array.isArray(session.pending)) throw recordError();
                    const key = scopeKey(session.scope);
                    if (scopes.has(key)) throw recordError();
                    scopes.add(key);
                    const ids = new Set();
                    for (const request of session.pending) {
                        if (!validRequest(request, session) || ids.has(request.turns[0].utteranceId)) throw recordError();
                        ids.add(request.turns[0].utteranceId);
                    }
                }
                return data;
            } catch { throw recordError(); }
        }
        function write(data) {
            try { storage().setItem(KEY, JSON.stringify(data)); }
            catch { throw Object.assign(new Error('전송 기록을 이 탭에 보관하지 못해 전송을 멈췄어요. 입력과 기존 기록을 유지했습니다. 다시 보내기로 재시도해 주세요.'), { code: 'CONVERSATION_SESSION' }); }
        }
        return {
            current,
            ensure(scope) {
                if (!validScope(scope)) throw recordError();
                const conversationId = current(scope) || uuid();
                if (!validId(conversationId)) throw recordError();
                rememberIdentity(scope, conversationId);
                return conversationId;
            },
            prepare(scope, text) {
                if (!validScope(scope) || typeof text !== 'string' || !text.trim()) throw recordError();
                const data = read();
                const session = data.sessions.find(item => sameScope(item.scope, scope));
                const key = scopeKey(scope);
                let conversationId, utteranceId;
                try {
                    conversationId = session?.conversationId || current(scope) || preparedConversations.get(key) || uuid();
                    utteranceId = uuid();
                } catch { throw recordError(); }
                const at = now();
                if (!validId(conversationId) || !validId(utteranceId) || !validTime(at)) throw recordError();
                preparedConversations.set(key, conversationId);
                return { ownerId: scope.ownerId, conversationId, turns: [{ utteranceId, role: 'user', text, at, receivedAt: at, final: true }] };
            },
            savePending(scope, request) {
                const data = read();
                let session = data.sessions.find(item => sameScope(item.scope, scope));
                if (!session) {
                    session = { scope: clone(scope), conversationId: request.conversationId, pending: [] };
                    data.sessions.push(session);
                }
                if (!validScope(scope) || !validRequest(request, session)) throw recordError();
                const previous = session.pending.find(item => item.turns[0].utteranceId === request.turns[0].utteranceId);
                if (previous && JSON.stringify(previous) !== JSON.stringify(request)) throw recordError();
                if (!previous) session.pending.push(clone(request));
                write(data);
                rememberIdentity(scope, session.conversationId);
            },
            pending(scope) {
                return clone(read().sessions.find(item => sameScope(item.scope, scope))?.pending || []);
            },
            unverifiedPendingCount(scope) {
                if (!validScope(scope)) throw recordError();
                if (scope.storageId === undefined) return 0;
                return read().sessions.filter(item => item.scope.storageId === undefined && samePath(item.scope, scope))
                    .reduce((total, item) => total + item.pending.length, 0);
            },
            complete(scope, utteranceId) {
                const data = read();
                const session = data.sessions.find(item => sameScope(item.scope, scope));
                if (!session) throw recordError();
                session.pending = session.pending.filter(item => item.turns[0].utteranceId !== utteranceId);
                write(data);
            },
            validateReceipt(request, receipt) {
                if (receipt === undefined || receipt === null) return;
                const expected = request.turns[0];
                const actual = receipt?.turns?.[0];
                if (receipt.conversationId !== request.conversationId || !Array.isArray(receipt.turns) || receipt.turns.length !== 1 ||
                    !actual || actual.utteranceId !== expected.utteranceId || actual.receivedAt !== expected.receivedAt ||
                    actual.at !== expected.at || actual.final !== expected.final) {
                    throw Object.assign(new Error('보낸 대화와 처리 확인 정보가 맞지 않아 결과를 확인하지 못했어요. 같은 대화를 다시 보내기로 확인해 주세요.'), { code: 'CONVERSATION_RECEIPT' });
                }
            }
        };
    }
    global.HAEMA_CONVERSATION_SESSION = { create, sameScope, key: KEY, identityKey: IDENTITY_KEY };
})(window);
