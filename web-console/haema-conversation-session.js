// @editedBy YAONG1230 2026-10-10
// Pending requests live only in this tab. A retry reuses the original request.
(function (global) {
    'use strict';
    const KEY = 'haema_conversation_pending_v1';
    const recordError = () => Object.assign(new Error('이 탭에 보관한 전송 기록을 확인할 수 없어 전송을 멈췄어요. 기존 기록은 그대로 두었습니다.'), { code: 'CONVERSATION_SESSION' });
    const validId = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512;
    const validTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const sameScope = (a, b) => !!a && !!b && a.ownerId === b.ownerId && a.storageRoot === b.storageRoot;
    const validScope = scope => scope && validId(scope.ownerId) && typeof scope.storageRoot === 'string' && scope.storageRoot.trim().length > 0;
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
        function read() {
            try {
                const raw = storage().getItem(KEY);
                if (raw === null) return { version: 1, sessions: [] };
                const data = JSON.parse(raw);
                if (data?.version !== 1 || !Array.isArray(data.sessions)) throw recordError();
                const scopes = new Set();
                for (const session of data.sessions) {
                    if (!validScope(session?.scope) || !validId(session.conversationId) || !Array.isArray(session.pending)) throw recordError();
                    const scopeKey = JSON.stringify([session.scope.ownerId, session.scope.storageRoot]);
                    if (scopes.has(scopeKey)) throw recordError();
                    scopes.add(scopeKey);
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
            prepare(scope, text) {
                if (!validScope(scope) || typeof text !== 'string' || !text.trim()) throw recordError();
                const data = read();
                const session = data.sessions.find(item => sameScope(item.scope, scope));
                const scopeKey = JSON.stringify([scope.ownerId, scope.storageRoot]);
                let conversationId, utteranceId;
                try {
                    conversationId = session?.conversationId || preparedConversations.get(scopeKey) || uuid();
                    utteranceId = uuid();
                } catch { throw recordError(); }
                const at = now();
                if (!validId(conversationId) || !validId(utteranceId) || !validTime(at)) throw recordError();
                preparedConversations.set(scopeKey, conversationId);
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
            },
            pending(scope) {
                return clone(read().sessions.find(item => sameScope(item.scope, scope))?.pending || []);
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
    global.HAEMA_CONVERSATION_SESSION = { create, sameScope, key: KEY };
})(window);
