// @editedBy YAONG1230 2026-10-18
// @editedBy YAONG1230 2026-10-22: select restored input metadata without adding measured usage
// TOKEN_USAGE v2 receiver. Server snapshots are authoritative conversation totals.
// This cache contains identifiers/measurements only, never prompts or API keys.
(function (global) {
    'use strict';
    const KEY = 'haema_token_usage_v2';
    const clone = value => JSON.parse(JSON.stringify(value));
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const validId = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512;
    const error = (code, message) => Object.assign(new Error(message), { code });
    const invalid = () => error('TOKEN_USAGE_INVALID', '토큰 계량 정보의 형식을 확인할 수 없어 기존 기록을 유지했어요.');
    const conflict = () => error('TOKEN_USAGE_CONFLICT', '같은 처리의 토큰 계량 정보가 달라 기존 기록을 유지했어요.');
    const scopeError = () => error('TOKEN_USAGE_SCOPE', '저장소 식별자를 확인하지 못해 토큰 기록 표시를 보류했어요. 기존 기록은 그대로 두었습니다.');
    const storageError = () => error('TOKEN_USAGE_STORAGE', '이 탭의 토큰 계량 기록을 읽거나 보관하지 못했어요. 기존 기록은 그대로 두었습니다.');
    function count(value) {
        if (value === null) return null;
        if (!Number.isSafeInteger(value) || value < 0) throw invalid();
        return value;
    }
    function sum(values) {
        let total = 0;
        for (const value of values) {
            if (value === null || !Number.isSafeInteger(total + value)) return null;
            total += value;
        }
        return total;
    }
    function checkScope(scope) {
        if (!scope || !validId(scope.ownerId) || typeof scope.storageRoot !== 'string' || !scope.storageRoot.trim() ||
            (scope.storageId !== undefined && !validId(scope.storageId))) throw invalid();
        return { ownerId: scope.ownerId, storageRoot: scope.storageRoot, ...(scope.storageId === undefined ? {} : { storageId: scope.storageId }) };
    }
    const sameScope = (a, b) => a.ownerId === b.ownerId && a.storageRoot === b.storageRoot;
    function requestIds(request, scope) {
        if (!validId(request?.conversationId) || !Array.isArray(request.turns) || !request.turns.length ||
            (request.ownerId !== undefined && request.ownerId !== scope.ownerId)) throw invalid();
        const utteranceIds = [...new Set(request.turns.map(turn => turn?.utteranceId))];
        if (!utteranceIds.every(validId)) throw invalid();
        return { conversationId: request.conversationId, utteranceIds };
    }
    function identity(raw) {
        if (!raw || raw.schemaVersion !== 2 || raw.scope !== 'haema' || raw.unit !== 'tokens' ||
            ![raw.ownerId, raw.storageId, raw.conversationId].every(validId)) throw invalid();
        return { schemaVersion: 2, scope: 'haema', unit: 'tokens', ownerId: raw.ownerId, storageId: raw.storageId, conversationId: raw.conversationId };
    }
    const sameIdentity = (a, b) => a.ownerId === b.ownerId && a.storageId === b.storageId && a.conversationId === b.conversationId;
    function normalizeCall(raw) {
        if (!raw || raw.scope !== 'haema' || !['pending', 'complete'].includes(raw.state) ||
            !['extract', 'summarize', 'judgeMerge', 'scoreRecall', 'review'].includes(raw.task) ||
            !['provider', 'unreported'].includes(raw.source) || !['response', 'requested'].includes(raw.modelSource) ||
            ![null, 'openai.usage', 'anthropic.usage', 'google.usageMetadata', 'ollama.counts'].includes(raw.usageSource) ||
            ![raw.callId, raw.provider, raw.model, raw.requestedModel].every(validId)) throw invalid();
        const inputTokens = count(raw.inputTokens), outputTokens = count(raw.outputTokens), totalTokens = count(raw.totalTokens);
        const parts = sum([inputTokens ?? 0, outputTokens ?? 0]);
        if (totalTokens !== null && (parts === null || totalTokens < parts)) throw invalid();
        if (raw.state === 'pending' && [inputTokens, outputTokens, totalTokens].some(value => value !== null)) throw invalid();
        return { callId: raw.callId, scope: 'haema', state: raw.state, provider: raw.provider, model: raw.model,
            requestedModel: raw.requestedModel, modelSource: raw.modelSource, usageSource: raw.usageSource,
            task: raw.task, source: raw.source, inputTokens, outputTokens, totalTokens };
    }
    // Recheck public normalized counts. Partial input/output remain visible;
    // arithmetic overflow stays unknown rather than becoming an exact number.
    function totals(calls, pending = false) {
        const input = calls.map(call => call.inputTokens), output = calls.map(call => call.outputTokens);
        const all = calls.map(call => call.totalTokens);
        const other = calls.map(call => call.totalTokens === null ? null : call.totalTokens - (call.inputTokens ?? 0) - (call.outputTokens ?? 0));
        const segments = { input: sum(input.filter(value => value !== null)), output: sum(output.filter(value => value !== null)), unclassified: sum(other.filter(value => value !== null)) };
        const anyKnown = calls.some(call => [call.inputTokens, call.outputTokens, call.totalTokens].some(value => value !== null));
        const anyParts = calls.some(call => call.inputTokens !== null || call.outputTokens !== null);
        const totalTokens = sum(all), inputTokens = sum(input), outputTokens = sum(output), unclassifiedTokens = sum(other);
        const totalStatus = totalTokens !== null ? 'complete' : anyKnown ? 'partial' : 'unreported';
        const breakdownStatus = inputTokens !== null && outputTokens !== null && segments.unclassified === 0 ? 'complete' : anyParts ? 'partial' : 'unreported';
        return { status: pending ? (anyKnown ? 'partial' : 'unreported') : totalStatus,
            totalStatus: pending ? (anyKnown ? 'partial' : 'unreported') : totalStatus,
            breakdownStatus: pending ? (calls.length && breakdownStatus !== 'unreported' ? 'partial' : 'unreported') : breakdownStatus,
            inputTokens: pending ? null : inputTokens, outputTokens: pending ? null : outputTokens, totalTokens: pending ? null : totalTokens,
            reportedTotalTokens: sum(calls.map(call => call.totalTokens ?? sum([call.inputTokens ?? 0, call.outputTokens ?? 0]))),
            unclassifiedTokens: pending ? null : unclassifiedTokens, segments, callCount: calls.length,
            unreportedCallCount: calls.filter(call => [call.inputTokens, call.outputTokens, call.totalTokens].every(value => value === null)).length,
            incompleteCallCount: calls.filter(call => [call.inputTokens, call.outputTokens, call.totalTokens].includes(null)).length };
    }
    function verifyTotals(raw, expected) {
        for (const key of Object.keys(expected)) {
            if (key === 'segments') {
                if (!raw.segments || !['input', 'output', 'unclassified'].every(part => raw.segments[part] === expected.segments[part])) throw invalid();
            } else if (raw[key] !== expected[key]) throw invalid();
        }
    }
    function normalizeReport(raw) {
        const ids = identity(raw);
        if (!validId(raw.usageId) || !['pending', 'complete'].includes(raw.phase) || !Array.isArray(raw.calls) ||
            !Array.isArray(raw.utteranceIds) || !raw.utteranceIds.length || !raw.utteranceIds.every(validId)) throw invalid();
        const utteranceIds = [...new Set(raw.utteranceIds)], calls = [];
        for (const value of raw.calls) {
            const call = normalizeCall(value), previous = calls.find(item => item.callId === call.callId);
            if (previous && !equal(previous, call)) throw conflict();
            if (!previous) calls.push(call);
        }
        if (raw.phase === 'complete' && calls.some(call => call.state === 'pending')) throw invalid();
        const values = totals(calls, raw.phase === 'pending');
        const coverage = values.totalStatus === 'complete' && raw.phase === 'complete' ? 'complete' : 'partial';
        const attribution = utteranceIds.length === 1 ? 'single' : 'shared';
        if (raw.coverage !== coverage || raw.attribution !== attribution) throw invalid();
        verifyTotals(raw, values);
        return { ...ids, usageId: raw.usageId, utteranceIds, attribution, phase: raw.phase, coverage, ...values, calls };
    }
    function reconcile(previous, incoming) {
        if (!sameIdentity(previous, incoming) || previous.usageId !== incoming.usageId || !equal(previous.utteranceIds, incoming.utteranceIds)) throw conflict();
        if (equal(previous, incoming)) return previous;
        if (previous.phase === 'complete') throw conflict();
        for (const call of previous.calls) {
            const next = incoming.calls.find(item => item.callId === call.callId);
            if (!next) throw conflict();
            if (equal(call, next)) continue;
            if (call.state === 'complete' || next.state !== 'complete' ||
                ['callId', 'scope', 'provider', 'requestedModel', 'task'].some(key => call[key] !== next[key])) throw conflict();
        }
        return incoming;
    }
    function checkCallOwnership(reports) {
        const owners = new Map();
        for (const report of reports) for (const call of report.calls) {
            if (owners.has(call.callId) && owners.get(call.callId) !== report.usageId) throw conflict();
            owners.set(call.callId, report.usageId);
        }
    }
    function normalizeConversation(raw) {
        const ids = identity(raw);
        if (typeof raw.found !== 'boolean' || count(raw.revision) === null || !Array.isArray(raw.reports)) throw invalid();
        const reports = raw.reports.map(normalizeReport), usageIds = reports.map(report => report.usageId);
        if (new Set(usageIds).size !== usageIds.length || reports.some(report => !sameIdentity(report, ids))) throw conflict();
        if (!raw.found && (raw.revision !== 0 || reports.length)) throw invalid();
        checkCallOwnership(reports);
        const pendingUsageIds = reports.filter(report => report.phase === 'pending').map(report => report.usageId);
        if (!equal(raw.usageIds, usageIds) || raw.reportCount !== reports.length || !equal(raw.pendingUsageIds, pendingUsageIds)) throw invalid();
        const values = totals(reports.flatMap(report => report.calls), pendingUsageIds.length > 0);
        verifyTotals(raw, values);
        return { ...ids, found: raw.found, revision: raw.revision, reports, usageIds, reportCount: reports.length, pendingUsageIds, ...values };
    }
    function view(report) {
        const pending = report.phase === 'pending';
        const complete = !pending && report.totalStatus === 'complete';
        return { ...clone(report), utteranceId: report.utteranceIds[0], pending, complete,
            inputKnown: report.segments.input, outputKnown: report.segments.output,
            inputComplete: !pending && report.inputTokens !== null, outputComplete: !pending && report.outputTokens !== null,
            totalKnown: report.totalStatus === 'unreported' ? null : report.reportedTotalTokens,
            status: pending ? 'pending' : complete ? 'complete' : report.totalStatus === 'unreported' ? 'unavailable' : 'partial' };
    }
    function placeholder(conversationId, request) {
        return { conversationId, utteranceId: request.utteranceIds[0], utteranceIds: request.utteranceIds.slice(), usageId: null,
            attribution: request.utteranceIds.length > 1 ? 'shared' : 'single', pending: request.pending, accepted: request.accepted,
            totalKnown: null, inputKnown: null, outputKnown: null, inputComplete: false, outputComplete: false,
            complete: false, coverage: null, totalStatus: 'unreported', breakdownStatus: 'unreported',
            status: request.pending ? 'pending' : 'unavailable', callCount: 0, calls: [], segments: { input: 0, output: 0, unclassified: 0 } };
    }
    function reportView(conversation, report) {
        const saved = conversation.server?.reports.find(item => item.usageId === report.usageId);
        return { ...view(report), persistenceStatus: saved && equal(saved, report) ? 'saved' : conversation.persistenceStatus === 'failed' ? 'failed' : null };
    }
    function describe(conversation) {
        const server = conversation?.server, request = conversation?.latestRequest;
        const report = conversation?.reports.find(item => item.usageId === conversation.latestUsageId);
        const latest = report ? reportView(conversation, report) : request ? placeholder(conversation.conversationId, request) : null;
        const turns = (server?.reports || []).map(item => ({ ...view(item), persistenceStatus: 'saved' }));
        const knownTurnCount = turns.filter(turn => turn.complete).length;
        const found = server?.found ?? false;
        const totalKnown = found && server.totalStatus !== 'unreported' ? server.reportedTotalTokens : null;
        const complete = found && server.pendingUsageIds.length === 0 && server.totalStatus === 'complete';
        return { ok: true, conversationId: conversation?.conversationId || null, storageId: server?.storageId || report?.storageId || null,
            found, serverBacked: !!server, revision: server?.revision ?? null, persistenceStatus: conversation?.persistenceStatus || null,
            totalKnown, inputKnown: found ? server.segments.input : null, outputKnown: found ? server.segments.output : null,
            inputComplete: found && server.inputTokens !== null, outputComplete: found && server.outputTokens !== null,
            totalStatus: found ? server.totalStatus : 'unreported', breakdownStatus: found ? server.breakdownStatus : 'unreported',
            segments: found ? clone(server.segments) : { input: 0, output: 0, unclassified: 0 },
            pendingUsageIds: server?.pendingUsageIds.slice() || [], knownTurnCount, unknownTurnCount: turns.length - knownTurnCount,
            turnCount: Math.max(turns.length, latest ? 1 : 0), complete,
            status: server?.pendingUsageIds.length || (request?.pending && !report) ? 'pending' : complete ? 'complete' : totalKnown !== null ? 'partial' : latest ? 'unavailable' : 'empty',
            latest, turns };
    }
    function create(options = {}) {
        const storage = () => options.storage || global.sessionStorage;
        let lastValid = { version: 2, scopes: [] };
        function findGroup(data, scope, ensure = false) {
            const candidates = data.scopes.filter(item => sameScope(item.scope, scope));
            let group;
            if (scope.storageId !== undefined) {
                group = candidates.find(item => item.storageId === scope.storageId);
                // A legacy group with no observed report may be bound once. A
                // group already bound to another store is preserved separately.
                if (!group && ensure) {
                    group = candidates.find(item => item.storageId === null);
                    if (group) group.storageId = scope.storageId;
                }
            } else {
                // Keep the former single-store API, but never guess between two
                // actual stores that have used the same displayed path.
                if (candidates.length > 1) throw scopeError();
                group = candidates[0];
            }
            if (!group && ensure) {
                group = { scope: { ownerId: scope.ownerId, storageRoot: scope.storageRoot }, storageId: scope.storageId ?? null, currentConversationId: null, conversations: [] };
                data.scopes.push(group);
            }
            return group;
        }
        function locate(data, scope, conversationId, ensure = false) {
            const group = findGroup(data, scope, ensure);
            let conversation = group?.conversations.find(item => item.conversationId === conversationId);
            if (!conversation && ensure) {
                conversation = { conversationId, server: null, reports: [], latestRequest: null, latestUsageId: null, persistenceStatus: null };
                group.conversations.push(conversation);
            }
            return { group, conversation };
        }
        function bind(group, scope, ids, incoming) {
            if (incoming.ownerId !== scope.ownerId || incoming.conversationId !== ids.conversationId ||
                (scope.storageId && incoming.storageId !== scope.storageId) || (group.storageId && incoming.storageId !== group.storageId)) throw conflict();
            group.storageId = incoming.storageId;
        }
        function mergeReport(conversation, report, serverSnapshot = false) {
            const index = conversation.reports.findIndex(item => item.usageId === report.usageId);
            if (index < 0) conversation.reports.push(report);
            else {
                const previous = conversation.reports[index];
                try { conversation.reports[index] = reconcile(previous, report); }
                catch (cause) {
                    // A failed final save can leave a valid earlier snapshot on
                    // the server. Keep the newer observed delta independently.
                    if (!serverSnapshot) throw cause;
                    reconcile(report, previous);
                }
            }
            checkCallOwnership(conversation.reports);
        }
        function applyServer(conversation, server) {
            const previous = conversation.server;
            if (previous && server.revision < previous.revision) return false;
            if (previous && server.revision === previous.revision && !equal(previous, server)) throw conflict();
            if (previous) for (const report of previous.reports) {
                const incoming = server.reports.find(item => item.usageId === report.usageId);
                if (!incoming) throw conflict();
                reconcile(report, incoming);
            }
            for (const report of server.reports) mergeReport(conversation, report, true);
            conversation.server = server;
            return true;
        }
        function validateStored(data) {
            if (!data || data.version !== 2 || !Array.isArray(data.scopes)) throw invalid();
            const scopes = new Set();
            for (const group of data.scopes) {
                const scope = checkScope(group.scope);
                if ((group.storageId !== null && !validId(group.storageId)) || !Array.isArray(group.conversations)) throw invalid();
                const conversations = new Set();
                for (const conversation of group.conversations) {
                    if (!validId(conversation.conversationId) || conversations.has(conversation.conversationId) || !Array.isArray(conversation.reports) ||
                        ![null, 'saved', 'failed'].includes(conversation.persistenceStatus)) throw invalid();
                    conversations.add(conversation.conversationId);
                    const reports = conversation.reports.map(normalizeReport);
                    if (new Set(reports.map(report => report.usageId)).size !== reports.length) throw conflict();
                    for (const report of reports) bind(group, scope, conversation, report);
                    checkCallOwnership(reports);
                    if (conversation.server) {
                        const server = normalizeConversation(conversation.server);
                        bind(group, scope, conversation, server);
                        for (const report of server.reports) {
                            const saved = reports.find(item => item.usageId === report.usageId);
                            if (!saved) throw conflict();
                            reconcile(report, saved);
                        }
                    }
                    if (conversation.latestUsageId !== null && !reports.some(report => report.usageId === conversation.latestUsageId)) throw invalid();
                    const request = conversation.latestRequest;
                    if (request !== null && (!Array.isArray(request.utteranceIds) || !request.utteranceIds.length || !request.utteranceIds.every(validId) ||
                        !Array.isArray(request.previousUsageIds) || !request.previousUsageIds.every(validId) ||
                        typeof request.pending !== 'boolean' || typeof request.accepted !== 'boolean')) throw invalid();
                }
                if (group.currentConversationId !== null && !conversations.has(group.currentConversationId)) throw invalid();
                const key = JSON.stringify([scope.ownerId, scope.storageRoot, group.storageId]);
                if (scopes.has(key)) throw invalid();
                scopes.add(key);
            }
            return data;
        }
        function read() {
            try {
                const raw = storage().getItem(KEY);
                const data = raw === null ? { version: 2, scopes: [] } : validateStored(JSON.parse(raw));
                lastValid = clone(data);
                return data;
            } catch { throw storageError(); }
        }
        function safe(scope, conversationId, action) {
            try { return action(); }
            catch (cause) {
                let summary = null;
                try {
                    const checkedScope = checkScope(scope);
                    const group = findGroup(lastValid, checkedScope);
                    if (group) summary = describe(group.conversations.find(item => item.conversationId === (conversationId || group.currentConversationId)));
                } catch { /* Invalid caller scope cannot expose another conversation. */ }
                return { ok: false, code: cause?.code || 'TOKEN_USAGE_STORAGE', error: cause?.message || storageError().message, summary };
            }
        }
        function mutate(scope, conversationId, operation) {
            return safe(scope, conversationId, () => {
                scope = checkScope(scope);
                if (!validId(conversationId)) throw invalid();
                const data = read(), before = JSON.stringify(data);
                const located = locate(data, scope, conversationId, true);
                operation(located, scope);
                validateStored(data);
                const after = JSON.stringify(data);
                if (after !== before) { try { storage().setItem(KEY, after); } catch { throw storageError(); } }
                lastValid = clone(data);
                const summary = describe(located.conversation);
                return { ok: true, turn: summary.latest, summary };
            });
        }
        function requestAction(scope, request, action) {
            return mutate(scope, request?.conversationId, (located, checkedScope) => action(located, requestIds(request, checkedScope)));
        }
        return {
            focus(scope, request) {
                return requestAction(scope, request, ({ group, conversation }, ids) => {
                    // Restoring a selected input is not a new processing attempt.
                    // Keep every observed report and the authoritative total intact.
                    const matches = conversation.reports.filter(report => equal(report.utteranceIds, ids.utteranceIds));
                    conversation.latestRequest = { utteranceIds: ids.utteranceIds, pending: false, accepted: true, previousUsageIds: [] };
                    conversation.latestUsageId = matches.length ? matches[matches.length - 1].usageId : null;
                    group.currentConversationId = ids.conversationId;
                });
            },
            begin(scope, request) {
                return requestAction(scope, request, ({ group, conversation }, ids) => {
                    conversation.latestRequest = { utteranceIds: ids.utteranceIds, pending: true, accepted: false,
                        previousUsageIds: conversation.reports.filter(report => equal(report.utteranceIds, ids.utteranceIds)).map(report => report.usageId) };
                    conversation.latestUsageId = null;
                    group.currentConversationId = ids.conversationId;
                });
            },
            accept(scope, request) {
                return requestAction(scope, request, ({ conversation }, ids) => {
                    if (equal(conversation.latestRequest?.utteranceIds, ids.utteranceIds)) {
                        conversation.latestRequest.pending = false; conversation.latestRequest.accepted = true;
                    }
                });
            },
            fail(scope, request) {
                return requestAction(scope, request, ({ conversation }, ids) => {
                    if (equal(conversation.latestRequest?.utteranceIds, ids.utteranceIds)) conversation.latestRequest.pending = false;
                });
            },
            record(scope, request, measurement, envelope = {}) {
                return requestAction(scope, request, ({ group, conversation }, ids) => {
                    const report = normalizeReport(measurement);
                    bind(group, scope, ids, report);
                    if (!equal(ids.utteranceIds, report.utteranceIds)) throw conflict();
                    const server = envelope.conversationUsage == null ? null : normalizeConversation(envelope.conversationUsage);
                    if (server) {
                        bind(group, scope, ids, server);
                        // An old POST must not replace the latest delta either.
                        if (conversation.server && server.revision < conversation.server.revision) return;
                    }
                    mergeReport(conversation, report);
                    if (!conversation.latestRequest || equal(conversation.latestRequest.utteranceIds, ids.utteranceIds)) {
                        conversation.latestUsageId = report.usageId;
                        if (!conversation.latestRequest) conversation.latestRequest = { utteranceIds: ids.utteranceIds, pending: false, accepted: false, previousUsageIds: [] };
                    }
                    if (envelope.usagePersistence !== undefined) {
                        const status = envelope.usagePersistence?.status;
                        if (!['saved', 'failed'].includes(status)) throw invalid();
                        if (status === 'failed' && envelope.conversationUsage !== null) throw invalid();
                        if (status === 'saved' && !envelope.conversationUsage) throw invalid();
                        if (status === 'saved') {
                            const saved = server.reports.find(item => item.usageId === report.usageId);
                            if (!saved) throw conflict();
                            reconcile(report, saved);
                        }
                        conversation.persistenceStatus = status;
                    }
                    if (server) applyServer(conversation, server);
                    if (group.currentConversationId === null) group.currentConversationId = ids.conversationId;
                });
            },
            restore(scope, conversationId, measurement) {
                return mutate(scope, conversationId, ({ group, conversation }, checkedScope) => {
                    const server = normalizeConversation(measurement);
                    bind(group, checkedScope, { conversationId }, server);
                    if (applyServer(conversation, server)) {
                        const stillUnpersisted = conversation.reports.some(report => !server.reports.some(saved => equal(report, saved)));
                        if (conversation.persistenceStatus !== 'failed' || !stillUnpersisted) conversation.persistenceStatus = 'saved';
                        const request = conversation.latestRequest;
                        const matches = server.reports.filter(report => !request || (equal(report.utteranceIds, request.utteranceIds) &&
                            (conversation.latestUsageId || !request.previousUsageIds.includes(report.usageId))));
                        const latestIndex = server.reports.findIndex(report => report.usageId === conversation.latestUsageId);
                        // Never replace an unsaved local retry with an older
                        // saved attempt. GET can still recover a lost POST result.
                        if (matches.length && (!conversation.latestUsageId || latestIndex >= 0)) {
                            const candidate = matches[matches.length - 1];
                            if (!conversation.latestUsageId || server.reports.indexOf(candidate) >= latestIndex) conversation.latestUsageId = candidate.usageId;
                        }
                    }
                    // The caller guards the selected conversation/connection epoch
                    // before applying a GET response, including a restored session.
                    group.currentConversationId = conversationId;
                });
            },
            summary(scope, conversationId) {
                return safe(scope, conversationId, () => {
                    scope = checkScope(scope);
                    if (!validId(conversationId)) throw invalid();
                    return describe(locate(read(), scope, conversationId).conversation);
                });
            },
            current(scope) {
                return safe(scope, null, () => {
                    scope = checkScope(scope);
                    const data = read(), group = findGroup(data, scope);
                    return describe(group?.conversations.find(item => item.conversationId === group.currentConversationId));
                });
            },
            turn(scope, conversationId, utteranceId) {
                return safe(scope, conversationId, () => {
                    scope = checkScope(scope);
                    if (!validId(conversationId) || !validId(utteranceId)) throw invalid();
                    const conversation = locate(read(), scope, conversationId).conversation;
                    const reports = (conversation?.reports || []).filter(report => report.utteranceIds.includes(utteranceId));
                    const latestRequest = conversation?.latestRequest;
                    if (latestRequest?.utteranceIds.includes(utteranceId) && !conversation.latestUsageId) return { ok: true, found: true, ...placeholder(conversationId, latestRequest) };
                    return reports.length ? { ok: true, found: true, ...reportView(conversation, reports[reports.length - 1]) } : { ok: true, found: false };
                });
            }
        };
    }
    global.HAEMA_TOKEN_USAGE = { create, key: KEY };
})(window);
