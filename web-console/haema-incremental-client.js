// @editedBy YAONG1230 2026-10-22
// Transport for docs/INCREMENTAL_CONVERSATION.md. Acceptance is not processing completion.
// The caller owns scope verification, ordering, persistence, polling and explicit retries.
(function (global) {
    'use strict';
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value;
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    const time = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
    const ids = value => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
    const clone = value => JSON.parse(JSON.stringify(value));
    const failure = (code, message, status = 0, unsupported = false) =>
        ({ ok: false, code, message, status, ...(unsupported ? { unsupported: true } : {}) });
    const invalid = status => failure('INCREMENTAL_INVALID_RESPONSE', '연속 입력 응답을 확인하지 못했어요. 보관한 입력은 유지했어요.', status);
    const validScope = scope => object(scope) && id(scope.ownerId) && id(scope.storageId) &&
        typeof scope.storageRoot === 'string' && scope.storageRoot.trim().length > 0;

    function validRecord(record, sequence, preceding, submitted) {
        return object(record) && id(record.inputId) && record.sequence === sequence && integer(record.revision) &&
            typeof record.text === 'string' && (!submitted || !!record.text.trim()) && time(record.receivedAt) &&
            (record.at === undefined || time(record.at)) && id(record.meaningUnitId) && object(record.continuity) &&
            ['likely', 'undetermined'].includes(record.continuity.status) && record.continuity.provisional === true &&
            ids(record.continuity.precedingInputIds) && record.continuity.precedingInputIds.every(value => preceding.has(value)) &&
            strings(record.continuity.evidence);
    }
    function sameTurn(turn, record, final) {
        return object(turn) && turn.role === 'user' && turn.utteranceId === record.inputId && turn.text === record.text &&
            turn.receivedAt === record.receivedAt && turn.at === record.at && turn.final === final;
    }
    function validFragments(fragments, records, generation) {
        return Array.isArray(fragments) && ids(fragments.map(item => item?.fragmentId)) && fragments.every(item =>
            object(item) && id(item.inputId) && records.has(item.inputId) && integer(item.revision) &&
            item.revision <= records.get(item.inputId).revision && integer(item.generation) && item.generation <= generation &&
            typeof item.text === 'string' && !!item.text.trim() && ['observed', 'predicted'].includes(item.source));
    }
    function validReadiness(value, session, records) {
        if (value === undefined) return true;
        return object(value) && ['wait', 'ready', 'uncertain'].includes(value.status) && value.source === 'content_heuristic' &&
            value.provisional === true && value.executeHost === false && object(value.basis) &&
            value.basis.sessionId === session.sessionId && value.basis.processGeneration === session.processGeneration &&
            value.basis.analysisGeneration === session.analysisGeneration && ids(value.basis.inputIds) &&
            value.basis.inputIds.every(inputId => records.has(inputId)) &&
            (value.basis.meaningUnitId === undefined || id(value.basis.meaningUnitId)) && strings(value.reasons);
    }
    function validSession(session, expected, sessionId, closing) {
        if (!object(session) || session.ownerId !== expected.ownerId || session.storageId !== expected.storageId ||
            session.conversationId !== expected.conversationId || !id(session.sessionId) ||
            (sessionId !== undefined && session.sessionId !== sessionId) || typeof session.disposed !== 'boolean' ||
            (closing && !session.disposed) || !integer(session.submittedCount) || !integer(session.nextSequence) ||
            session.nextSequence !== session.submittedCount + 1 || !integer(session.analysisGeneration) ||
            !integer(session.processGeneration) || !Array.isArray(session.submissions) ||
            session.submissions.length !== session.submittedCount || !Array.isArray(session.turns) ||
            session.hostHandoff !== 'policy_pending' || !ids(session.retrievedIds)) return false;
        const records = new Map();
        for (let index = 0; index < session.submissions.length; index++) {
            const record = session.submissions[index];
            if (!validRecord(record, index + 1, records, true) || records.has(record.inputId) ||
                !object(record.processing) || !['pending', 'completed', 'failed', 'superseded'].includes(record.processing.status) ||
                (record.processing.error !== undefined && record.processing.error !== 'PROCESSING_FAILED') ||
                !sameTurn(session.turns[index], record, true)) return false;
            records.set(record.inputId, record);
        }
        if (session.draft !== null) {
            if (!validRecord(session.draft, session.nextSequence, records, false) || records.has(session.draft.inputId) ||
                !sameTurn(session.turns[session.submittedCount], session.draft, false)) return false;
            records.set(session.draft.inputId, session.draft);
        }
        if (session.turns.length !== session.submittedCount + (session.draft === null ? 0 : 1)) return false;
        const scores = session.recallScores;
        if (!object(scores) || !['uncomputed', 'pending', 'ready', 'error'].includes(scores.status) ||
            scores.generation !== session.analysisGeneration ||
            !((scores.inputId === null && scores.revision === null) ||
                (id(scores.inputId) && integer(scores.revision) && records.has(scores.inputId) &&
                    records.get(scores.inputId).revision === scores.revision))) return false;
        if (scores.status === 'ready') {
            if (!Array.isArray(scores.values) || !ids(scores.values.map(value => value?.jjumId)) ||
                !scores.values.every(value => object(value) && typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0)) return false;
        } else if (scores.values !== null) return false;
        return validFragments(session.candidates, records, session.analysisGeneration) &&
            validFragments(session.carryoverFragments, records, session.analysisGeneration) &&
            validReadiness(session.responseReadiness, session, records);
    }
    function validInput(input, action) {
        return object(input) && id(input.sessionId) && id(input.inputId) && integer(input.sequence) && input.sequence > 0 &&
            integer(input.revision) && typeof input.text === 'string' &&
            (action === 'snapshot' || !!input.text.trim()) && (input.at === undefined || time(input.at));
    }
    function matchesInput(record, input, compareRevision) {
        return !!record && record.inputId === input.inputId && record.sequence === input.sequence &&
            record.text === input.text && record.at === input.at && (!compareRevision || record.revision === input.revision);
    }
    function validAcceptance(payload, action, input, status) {
        if (![payload.accepted, payload.replayed, payload.stale].every(value => typeof value === 'boolean') ||
            [payload.accepted, payload.replayed, payload.stale].filter(Boolean).length !== 1) return false;
        if (action === 'snapshot') {
            return status === 200 && (payload.stale || matchesInput(payload.session.draft, input, true));
        }
        if (payload.stale || (status === 202 ? !payload.accepted : !payload.replayed)) return false;
        const record = payload.session.submissions.find(item => item.inputId === input.inputId);
        return matchesInput(record, input, action === 'submit' && payload.accepted);
    }
    const serverErrors = {
        INVALID_INCREMENTAL_INPUT: [400, '입력 형식을 확인하지 못했어요. 보관한 입력은 유지했어요.'],
        INPUT_CONFLICT: [409, '입력 순서나 내용이 서버 기록과 달라요. 현재 세션을 다시 확인해 주세요.'],
        SESSION_REQUIRED: [409, '기존 입력 세션을 확인하지 못했어요. 보관한 입력은 유지했어요.'],
        STORAGE_REQUIRED: [409, '연결된 저장소를 확인해 주세요. 보관한 입력은 유지했어요.'],
        SESSION_UNAVAILABLE: [503, '입력 세션을 사용할 수 없어요. 잠시 뒤 다시 확인해 주세요.']
    };
    function create(options = {}) {
        const requestFetch = options.fetch || ((...args) => global.fetch(...args));
        const rawBase = options.baseUrl ?? '';
        let baseUrl;
        try {
            if (typeof rawBase !== 'string' || rawBase !== rawBase.trim()) throw Error('base');
            if (rawBase) {
                const parsed = new URL(rawBase, 'http://haema.invalid');
                if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash ||
                    (!/^https?:\/\//i.test(rawBase) && (!rawBase.startsWith('/') || rawBase.startsWith('//')))) throw Error('base');
            }
            baseUrl = rawBase.replace(/\/+$/, '');
        } catch { baseUrl = null; }
        async function request(action, scope, conversationId, inputOrSessionId, retryId) {
            if (!validScope(scope) || !id(conversationId)) return failure('INCREMENTAL_SCOPE', '연결된 저장소와 대화를 확인해 주세요.');
            if (baseUrl === null) return failure('INCREMENTAL_CONFIG', '연속 입력 서버 주소를 확인해 주세요.');
            const isInput = ['snapshot', 'submit', 'retry'].includes(action);
            if ((isInput && !validInput(inputOrSessionId, action)) ||
                (!isInput && action !== 'open' && !id(inputOrSessionId)) || (action === 'retry' && !id(retryId))) {
                return failure('INVALID_INCREMENTAL_INPUT', '입력 형식을 확인하지 못했어요. 보관한 입력은 유지했어요.');
            }
            // Capture all identities and original input before the first await.
            const expected = { ownerId: scope.ownerId, storageRoot: scope.storageRoot, storageId: scope.storageId, conversationId };
            const input = isInput ? { sessionId: inputOrSessionId.sessionId, inputId: inputOrSessionId.inputId,
                sequence: inputOrSessionId.sequence, revision: inputOrSessionId.revision, text: inputOrSessionId.text,
                ...(inputOrSessionId.at === undefined ? {} : { at: inputOrSessionId.at }) } : null;
            const sessionId = input?.sessionId ?? inputOrSessionId;
            let url = baseUrl + '/api/conversation/' + (isInput ? action : 'session');
            const init = { method: action === 'read' ? 'GET' : action === 'close' ? 'DELETE' : 'POST',
                cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } };
            try {
                if (init.method === 'GET' || init.method === 'DELETE') {
                    url += '?ownerId=' + encodeURIComponent(expected.ownerId) + '&conversationId=' + encodeURIComponent(conversationId) +
                        '&sessionId=' + encodeURIComponent(sessionId);
                } else {
                    init.headers['Content-Type'] = 'application/json';
                    init.body = JSON.stringify({ ownerId: expected.ownerId, conversationId, ...(input || {}),
                        ...(action === 'retry' ? { retryId } : {}) });
                }
            } catch { return failure('INVALID_INCREMENTAL_INPUT', '입력 식별자를 확인하지 못했어요. 보관한 입력은 유지했어요.'); }
            let response;
            try { response = await requestFetch(url, init); }
            catch { return failure('INCREMENTAL_NETWORK', '서버 응답을 확인하지 못했어요. 보관한 입력과 식별자는 유지했어요.'); }
            const status = response?.status;
            if ([404, 405, 501].includes(status)) return failure('INCREMENTAL_UNSUPPORTED', '현재 서버에서 연속 입력 경로를 사용할 수 없어요.', status, true);
            if (!Number.isInteger(status) || status < 100 || status > 599 || typeof response?.ok !== 'boolean') return invalid(0);
            let payload;
            try { payload = await response.json(); } catch {
                return response.ok ? invalid(status) : failure('INCREMENTAL_HTTP', '연속 입력 요청을 확인하지 못했어요. 보관한 입력은 유지했어요.', status);
            }
            if (!response.ok) {
                const known = object(payload) && typeof payload.code === 'string' && Object.hasOwn(serverErrors, payload.code) ? serverErrors[payload.code] : null;
                return known?.[0] === status ? failure(payload.code, known[1], status) :
                    failure('INCREMENTAL_HTTP', '연속 입력 요청을 확인하지 못했어요. 보관한 입력은 유지했어요.', status);
            }
            if (!object(payload) || payload.success !== true || ![200, ...(['submit', 'retry'].includes(action) ? [202] : [])].includes(status)) return invalid(status);
            try {
                const identity = payload.session;
                if (object(identity) && [identity.ownerId, identity.storageId, identity.conversationId, identity.sessionId].every(id) &&
                    (identity.ownerId !== expected.ownerId || identity.storageId !== expected.storageId ||
                        identity.conversationId !== expected.conversationId || (action !== 'open' && identity.sessionId !== sessionId))) {
                    return failure('INCREMENTAL_SCOPE_MISMATCH', '응답의 저장소나 입력 세션이 달라 적용하지 않았어요. 보관한 입력은 유지했어요.', status);
                }
                if (!validSession(payload.session, expected, action === 'open' ? undefined : sessionId, action === 'close') ||
                    (isInput && !validAcceptance(payload, action, input, status))) return invalid(status);
                const session = clone(payload.session);
                // Do not pass additional HTTP envelope fields to the UI or token ledger.
                return { ok: true, session, ...(isInput ? { accepted: payload.accepted, replayed: payload.replayed, stale: payload.stale } : {}) };
            } catch { return invalid(status); }
        }
        return {
            open: (scope, conversationId) => request('open', scope, conversationId),
            read: (scope, conversationId, sessionId) => request('read', scope, conversationId, sessionId),
            close: (scope, conversationId, sessionId) => request('close', scope, conversationId, sessionId),
            snapshot: (scope, conversationId, input) => request('snapshot', scope, conversationId, input),
            submit: (scope, conversationId, input) => request('submit', scope, conversationId, input),
            retry: (scope, conversationId, input, retryId) => request('retry', scope, conversationId, input, retryId)
        };
    }
    global.HAEMA_INCREMENTAL_CLIENT = { create };
})(window);
