// @editedBy YAONG1230 2026-10-16
// Frontend measurement model only. No backend response field is assumed here.
// Each callId identifies one actual provider call within this conversation.
(function (global) {
    'use strict';
    const KEY = 'haema_token_usage_v1';
    const MAX = Number.MAX_SAFE_INTEGER;
    const clone = value => JSON.parse(JSON.stringify(value));
    const validId = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512;
    const sameScope = (a, b) => a.ownerId === b.ownerId && a.storageRoot === b.storageRoot;
    const keysOnly = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
    const error = (code, message) => Object.assign(new Error(message), { code });
    const invalid = () => error('TOKEN_USAGE_INVALID', '토큰 계량 정보의 형식을 확인할 수 없어 기존 기록을 유지했어요.');
    const conflict = () => error('TOKEN_USAGE_CONFLICT', '같은 호출의 토큰 계량 정보가 달라 기존 기록을 유지했어요.');
    const storageError = () => error('TOKEN_USAGE_STORAGE', '이 탭의 토큰 계량 기록을 읽거나 보관하지 못했어요. 기존 기록은 그대로 두었습니다.');
    function checkScope(scope) {
        if (!scope || !validId(scope.ownerId) || typeof scope.storageRoot !== 'string' || !scope.storageRoot.trim()) throw invalid();
        return { ownerId: scope.ownerId, storageRoot: scope.storageRoot };
    }
    function requestIds(request) {
        const turn = request?.turns?.[0];
        if (!validId(request?.conversationId) || !Array.isArray(request.turns) || request.turns.length !== 1 || !validId(turn?.utteranceId)) throw invalid();
        return { conversationId: request.conversationId, utteranceId: turn.utteranceId };
    }
    function add(a, b) {
        if (a > MAX - b) throw invalid();
        return a + b;
    }
    function count(value) {
        if (value === undefined || value === null) return null;
        if (!Number.isSafeInteger(value) || value < 0) throw invalid();
        return value;
    }
    function normalizeCall(call) {
        if (!call || !validId(call.callId) || !validId(call.provider) || !validId(call.model)) throw invalid();
        const inputTokens = count(call.inputTokens), outputTokens = count(call.outputTokens);
        let totalTokens = count(call.totalTokens);
        const parts = add(inputTokens ?? 0, outputTokens ?? 0);
        if (totalTokens !== null && totalTokens < parts) throw invalid();
        if (totalTokens === null && inputTokens !== null && outputTokens !== null) totalTokens = parts;
        return { callId: call.callId, provider: call.provider, model: call.model, inputTokens, outputTokens, totalTokens };
    }
    const sameCall = (a, b) => Object.keys(a).every(key => a[key] === b[key]);
    function sumKnown(calls, key, explicitlyEmpty) {
        const values = calls.map(call => call[key]).filter(value => value !== null);
        return values.length ? values.reduce(add, 0) : explicitlyEmpty ? 0 : null;
    }
    function describeTurn(conversationId, turn) {
        const explicitlyEmpty = turn.coverage === 'complete' && turn.calls.length === 0;
        const knownCallCount = turn.calls.filter(call => call.totalTokens !== null).length;
        const complete = turn.accepted && !turn.pending && turn.coverage === 'complete' && knownCallCount === turn.calls.length;
        const totalKnown = sumKnown(turn.calls, 'totalTokens', explicitlyEmpty);
        const inputKnown = sumKnown(turn.calls, 'inputTokens', explicitlyEmpty);
        const outputKnown = sumKnown(turn.calls, 'outputTokens', explicitlyEmpty);
        const inputComplete = complete && turn.calls.every(call => call.inputTokens !== null);
        const outputComplete = complete && turn.calls.every(call => call.outputTokens !== null);
        return { conversationId, utteranceId: turn.utteranceId, pending: turn.pending, accepted: turn.accepted,
            coverage: turn.coverage, inputKnown, outputKnown, totalKnown, inputComplete, outputComplete, complete,
            status: turn.pending ? 'pending' : complete ? 'complete' : turn.coverage !== null ? 'partial' : 'unavailable',
            callCount: turn.calls.length, knownCallCount, unknownCallCount: turn.calls.length - knownCallCount, calls: clone(turn.calls) };
    }
    function describeConversation(conversation) {
        const conversationId = conversation?.conversationId || null;
        const turns = (conversation?.turns || []).map(turn => describeTurn(conversationId, turn));
        const knownTurnCount = turns.filter(turn => turn.complete).length;
        const known = turns.map(turn => turn.totalKnown).filter(value => value !== null);
        const totalKnown = known.length ? known.reduce(add, 0) : null;
        const complete = turns.length > 0 && knownTurnCount === turns.length;
        return { ok: true, conversationId, totalKnown, knownTurnCount, unknownTurnCount: turns.length - knownTurnCount,
            turnCount: turns.length, complete,
            status: !turns.length ? 'empty' : complete ? 'complete' : turns.some(turn => turn.pending) ? 'pending' : totalKnown !== null ? 'partial' : 'unavailable',
            latest: turns.length ? turns[turns.length - 1] : null, turns };
    }
    function validateStored(data) {
        if (!keysOnly(data, ['version', 'scopes']) || data.version !== 1 || !Array.isArray(data.scopes)) throw invalid();
        const scopeIds = new Set();
        for (const group of data.scopes) {
            if (!keysOnly(group, ['scope', 'currentConversationId', 'conversations']) || !keysOnly(group.scope, ['ownerId', 'storageRoot']) || !Array.isArray(group.conversations)) throw invalid();
            const scope = checkScope(group.scope), scopeId = JSON.stringify([scope.ownerId, scope.storageRoot]);
            if (scopeIds.has(scopeId)) throw invalid();
            scopeIds.add(scopeId);
            const conversationIds = new Set();
            for (const conversation of group.conversations) {
                if (!keysOnly(conversation, ['conversationId', 'turns']) || !validId(conversation.conversationId) || !Array.isArray(conversation.turns) || conversationIds.has(conversation.conversationId)) throw invalid();
                conversationIds.add(conversation.conversationId);
                const utteranceIds = new Set(), callIds = new Set();
                for (const turn of conversation.turns) {
                    if (!keysOnly(turn, ['utteranceId', 'pending', 'accepted', 'coverage', 'calls']) || !validId(turn.utteranceId) || utteranceIds.has(turn.utteranceId) ||
                        typeof turn.pending !== 'boolean' || typeof turn.accepted !== 'boolean' || (turn.pending && turn.accepted) ||
                        ![null, 'complete', 'partial'].includes(turn.coverage) || !Array.isArray(turn.calls) || (turn.coverage === null && turn.calls.length)) throw invalid();
                    utteranceIds.add(turn.utteranceId);
                    for (const call of turn.calls) {
                        if (!keysOnly(call, ['callId', 'provider', 'model', 'inputTokens', 'outputTokens', 'totalTokens']) || callIds.has(call.callId)) throw invalid();
                        const normalized = normalizeCall(call);
                        if (!sameCall(normalized, call)) throw invalid();
                        callIds.add(call.callId);
                    }
                }
                describeConversation(conversation); // Also reject unsafe aggregate sums.
            }
            if (group.currentConversationId !== null && !conversationIds.has(group.currentConversationId)) throw invalid();
        }
        return data;
    }
    function create(options = {}) {
        const storage = () => options.storage || global.sessionStorage;
        function read() {
            try {
                const raw = storage().getItem(KEY);
                return raw === null ? { version: 1, scopes: [] } : validateStored(JSON.parse(raw));
            } catch { throw storageError(); }
        }
        function safe(action) {
            try { return action(); }
            catch (cause) { return { ok: false, code: cause?.code || 'TOKEN_USAGE_STORAGE', error: cause?.message || storageError().message }; }
        }
        function locate(data, scope, ids, ensure = false) {
            let group = data.scopes.find(item => sameScope(item.scope, scope));
            if (!group && ensure) { group = { scope, currentConversationId: null, conversations: [] }; data.scopes.push(group); }
            let conversation = group?.conversations.find(item => item.conversationId === ids.conversationId);
            if (!conversation && ensure) { conversation = { conversationId: ids.conversationId, turns: [] }; group.conversations.push(conversation); }
            let turn = conversation?.turns.find(item => item.utteranceId === ids.utteranceId);
            const createdTurn = !turn && ensure;
            if (!turn && ensure) { turn = { utteranceId: ids.utteranceId, pending: true, accepted: false, coverage: null, calls: [] }; conversation.turns.push(turn); }
            if (group && ensure && group.currentConversationId === null) group.currentConversationId = ids.conversationId;
            return { group, conversation, turn, createdTurn };
        }
        function mutate(scope, request, operation) {
            return safe(() => {
                scope = checkScope(scope);
                const ids = requestIds(request);
                if (request.ownerId !== undefined && request.ownerId !== scope.ownerId) throw invalid();
                const data = read(), before = JSON.stringify(data);
                const located = locate(data, scope, ids, true);
                operation(located, ids);
                validateStored(data);
                const summary = describeConversation(located.conversation), after = JSON.stringify(data);
                if (after !== before) {
                    try { storage().setItem(KEY, after); } catch { throw storageError(); }
                }
                return { ok: true, turn: describeTurn(ids.conversationId, located.turn), summary };
            });
        }
        return {
            begin(scope, request) {
                return mutate(scope, request, ({ group, turn, createdTurn }, ids) => {
                    if (!turn.accepted) {
                        // A real retry can consume more tokens even with the same
                        // utterance ID. Unmeasured earlier attempts remain unknown.
                        if (!createdTurn) turn.coverage = 'partial';
                        turn.pending = true;
                    }
                    group.currentConversationId = ids.conversationId;
                });
            },
            accept(scope, request) {
                return mutate(scope, request, ({ turn }) => { turn.accepted = true; turn.pending = false; });
            },
            fail(scope, request) {
                return mutate(scope, request, ({ turn }) => { turn.pending = false; });
            },
            record(scope, request, measurement) {
                return mutate(scope, request, ({ conversation, turn }) => {
                    if (!measurement || !['complete', 'partial'].includes(measurement.coverage) || !Array.isArray(measurement.calls)) throw invalid();
                    const incoming = measurement.calls.map(normalizeCall);
                    for (const call of incoming) {
                        const owner = conversation.turns.find(item => item.calls.some(saved => saved.callId === call.callId));
                        const previous = owner?.calls.find(saved => saved.callId === call.callId);
                        if (previous && (owner !== turn || !sameCall(previous, call))) throw conflict();
                        if (!previous) turn.calls.push(call);
                    }
                    // No replacement/reconciliation contract exists: an earlier
                    // partial observation cannot be silently promoted to complete.
                    turn.coverage = turn.coverage === 'partial' || measurement.coverage === 'partial' ? 'partial' : 'complete';
                });
            },
            summary(scope, conversationId) {
                return safe(() => {
                    scope = checkScope(scope);
                    if (!validId(conversationId)) throw invalid();
                    return describeConversation(locate(read(), scope, { conversationId }).conversation);
                });
            },
            turn(scope, conversationId, utteranceId) {
                return safe(() => {
                    scope = checkScope(scope);
                    if (!validId(conversationId) || !validId(utteranceId)) throw invalid();
                    const found = locate(read(), scope, { conversationId, utteranceId }).turn;
                    return found ? { ok: true, found: true, ...describeTurn(conversationId, found) } : { ok: true, found: false };
                });
            },
            current(scope) {
                return safe(() => {
                    scope = checkScope(scope);
                    const group = read().scopes.find(item => sameScope(item.scope, scope));
                    return describeConversation(group?.conversations.find(item => item.conversationId === group.currentConversationId));
                });
            }
        };
    }
    global.HAEMA_TOKEN_USAGE = { create, key: KEY };
})(window);
