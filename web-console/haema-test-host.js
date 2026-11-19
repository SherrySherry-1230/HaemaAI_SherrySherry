// @editedBy SherrySherry 2026-11-19
// @editedBy YAONG1230 2026-11-16
window.HAEMA_TEST_HOST = (() => {
    'use strict';
    const hosts = [
        { id: 'friend', name: '친구친구이야기해,마' }, { id: 'schedule', name: '일정기억해,마' },
        { id: 'mindfulness', name: '마음챙김해,마' }, { id: 'diet', name: '다이어트해,마' },
        { id: 'creative', name: '창작해,마' }, { id: 'pet', name: '해마해,마' }
    ];
    const sessions = new Map();
    const unconnectedDrafts = new Map();
    const unconnectedNotice = '연결 전 초안을 이 탭에 보관하고 있어요. 저장소를 연결해도 자동으로 옮기거나 보내지 않아요.';
    const empty = () => ({ turns: [], draft: '', status: '', loading: false, sending: false, ready: false, uncertain: false,
        historyReady: false, hostReady: false, readinessNotice: '', calendar: null,
        calendarLoading: false, calendarError: '', calendarNotice: '', calendarBusy: false });
    const idle = empty();
    let active = null, notify = null, catalogReady = false, catalogNotice = '', catalogRequest = null;
    const httpStatus = Symbol('httpStatus');
    const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const valid = value => typeof value === 'string' && value.trim() === value && !!value && value.length <= 512;
    const changed = session => { if (session === active) notify?.(); };
    const scopeFields = ['storageId', 'ownerId', 'hostId', 'conversationId'];
    const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
    const message = code => code === 'AI_SETUP_REQUIRED'
        ? globalThis.HAEMA_CONSOLE.setupModeNotice()
        : ({
        HOST_RESPONSE_INVALID: '호스트 응답 형식을 확인하지 못했어요. 대화 상태 확인으로 다시 확인해 주세요.',
        HOST_HTTP_NOT_FOUND: '호스트 연결 기능을 찾지 못했어요. 실행 프로그램을 확인한 뒤 대화 상태 확인을 눌러 주세요.',
        UNAVAILABLE: '호스트 대화 준비를 확인하지 못했어요. 연결 상태를 다시 확인해 주세요.',
        SERVICE_PREPARATION_UNAVAILABLE: '대화 서비스 연결을 확인하지 못했어요. 이 PC에서 대화용 실행 파일을 열고 서비스 연결 코드를 확인해 주세요.',
        HOST_MEMORY_PROCESSING_FAILED: '이 메시지의 기억 처리를 완료하지 못했어요. 대화 기록은 쩜통에 남아 있어요.',
        MEMORY_RESPONSE_INVALID: '기억 추출 결과의 형식이 맞지 않아 답변을 만들지 못했어요. 메시지는 쩜통에 남아 있어요.',
        MODEL_ACCESS_DENIED: '모델 요청 권한을 확인하지 못했어요. API 키의 모델 사용 권한과 실행 프로그램의 서비스 연결을 확인해 주세요.',
        MODEL_REQUEST_REJECTED: '모델이 대화 요청을 거절했어요. API 설정에서 대화에 사용할 수 있는 모델을 선택해 주세요.',
        MODEL_LIMIT_REACHED: '모델 요청 한도에 도달했어요. 서비스의 사용 가능량을 확인해 주세요.',
        MODEL_UNAVAILABLE: '모델 서비스의 응답을 받지 못했어요. 네트워크와 서비스 상태를 확인해 주세요.',
        HOST_MODEL_FAILED: '호스트가 이 메시지에 대한 답변을 만들지 못했어요. 모델 설정을 확인해 주세요.',
        HOST_MODEL_EMPTY_RESPONSE: '모델이 빈 답변을 반환했어요. 메시지는 쩜통에 남아 있어요.',
        HOST_MODEL_INCOMPLETE_RESPONSE: '모델 답변이 끝나기 전에 출력이 중단됐어요. 메시지는 쩜통에 남아 있어요.',
        HOST_MODEL_CANCELLED: '모델 응답 대기가 끝났어요. 메시지는 쩜통에 남아 있어요.',
        AI_NOT_CONFIGURED: 'API 설정을 확인한 뒤 다시 보내 주세요.',
        CONNECTION_REQUIRED: '이 컴퓨터의 실행 프로그램을 연결해 주세요. 작성한 내용은 보존했어요.',
        HOST_STORAGE_CHANGED: '저장소가 바뀌었어요. 원래 저장소를 다시 연결해 주세요.',
        HOST_CONVERSATION_BUSY: '이 호스트의 이전 메시지를 처리하고 있어요. 상태를 확인해 주세요.',
        HOST_TURN_INTERRUPTED: '이전 실행이 중단됐어요. 기록은 유지하며 자동으로 다시 보내지 않아요.',
        HOST_CONTEXT_LIMIT: '이 대화의 처리 한도에 도달했어요. 기록을 보존하고 서버 설정을 확인해 주세요.',
        CALENDAR_NOT_CONFIGURED: 'Google Calendar 연결 설정이 아직 준비되지 않았어요.',
        CALENDAR_REAUTH_REQUIRED: 'Google 계정을 다시 연결해 주세요.'
    }[code] || '처리 상태를 확인하지 못했어요. 기록을 보존했으니 상태를 다시 확인해 주세요.');
    function updateReady(session) {
        if (!session.scope) { session.ready = false; return; }
        session.ready = catalogReady && session.hostReady && session.historyReady && !session.persistenceFailed;
        if (!session.ready) session.status = catalogNotice || session.readinessNotice || session.status;
    }
    function persist(session) {
        if (session.unconnected && session.savedDraftUnreadable) throw new Error('saved draft unavailable');
        sessionStorage.setItem(session.key, JSON.stringify({ draft: session.draft, draftRevision: session.draftRevision, pending: session.pending || null }));
    }
    async function request(operation, input = {}, allowAccepted = false) {
        const fail = code => Object.assign(new Error('request failed'), { code });
        const connection = globalThis.HAEMA_LOCAL_CONNECTION;
        if (typeof connection?.request !== 'function') throw fail('CONNECTION_REQUIRED');
        const response = await connection.request(operation, input, { signal: AbortSignal.timeout(30000) });
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (contentType !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType || '')) {
            throw fail(response.status === 404 ? 'HOST_HTTP_NOT_FOUND' : 'HOST_RESPONSE_INVALID');
        }
        let result;
        try { result = await response.json(); } catch { throw fail('HOST_RESPONSE_INVALID'); }
        if (!object(result)) throw fail('HOST_RESPONSE_INVALID');
        if (!response.ok || result.success !== true) throw fail(response.status === 404 ? 'HOST_HTTP_NOT_FOUND' : result.error?.code || result.code);
        if (response.status !== 200 && !(allowAccepted && response.status === 202)) throw fail('HOST_RESPONSE_INVALID');
        Object.defineProperty(result, httpStatus, { value: response.status });
        return result;
    }
    function getUnconnectedDraft(hostId) {
        if (!hosts.some(host => host.id === hostId)) return null;
        if (unconnectedDrafts.has(hostId)) return unconnectedDrafts.get(hostId);
        const key = 'haema_host_unconnected_v1:' + hostId;
        const session = { ...empty(), key, scope: null, unconnected: true, draftRevision: 0,
            pending: null, records: [], persistenceFailed: false, status: unconnectedNotice };
        try {
            const saved = JSON.parse(sessionStorage.getItem(key) || '{"draft":"","draftRevision":0}');
            if (!object(saved) || typeof saved.draft !== 'string' || !Number.isSafeInteger(saved.draftRevision) || saved.draftRevision < 0) {
                throw new Error('invalid saved draft');
            }
            session.draft = saved.draft;
            session.draftRevision = saved.draftRevision;
        } catch {
            session.savedDraftUnreadable = true;
            session.persistenceFailed = true;
            session.status = '기존 초안을 읽지 못했어요. 기존 보관 내용은 유지하고 새 입력은 열린 화면에서만 보관해요.';
        }
        unconnectedDrafts.set(hostId, session);
        return session;
    }
    function getSession(scope, hostId) {
        if (!scope || !valid(scope.storageId) || !valid(scope.ownerId) || !hosts.some(host => host.id === hostId)) return null;
        const baseKey = 'haema_host_v1:' + JSON.stringify([scope.storageId, scope.ownerId, hostId]);
        const idKey = baseKey + ':conversation';
        let conversationId = localStorage.getItem(idKey);
        if (conversationId === null) {
            conversationId = crypto.randomUUID();
            localStorage.setItem(idKey, conversationId);
        }
        if (!valid(conversationId)) throw new Error('invalid saved conversation');
        const key = baseKey + ':draft:' + conversationId;
        if (sessions.has(key)) return sessions.get(key);
        const saved = JSON.parse(sessionStorage.getItem(key) || sessionStorage.getItem(baseKey) || '{"draft":"","pending":null}');
        if (!object(saved) || typeof saved.draft !== 'string' || (saved.pending && (!valid(saved.pending.turnId) || typeof saved.pending.text !== 'string' ||
            (hostId === 'schedule' && !valid(saved.pending.timeZone))))) throw new Error('invalid saved draft');
        const session = { ...empty(), key, scope: { storageId: scope.storageId, ownerId: scope.ownerId, hostId, conversationId },
            storageScope: { ...scope }, draft: saved.draft, draftRevision: Number.isSafeInteger(saved.draftRevision) ? saved.draftRevision : 0,
            pending: saved.pending || null, records: [], pollCount: 0, persistenceFailed: false };
        if (globalThis.HAEMA_TOKEN_USAGE) session.usage = globalThis.HAEMA_TOKEN_USAGE.create({ key: key + ':usage' });
        sessions.set(key, session);
        return session;
    }
    function accept(session, result) {
        if (!scopeFields.every(key => result[key] === session.scope[key]) || !Array.isArray(result.turns) ||
            !result.turns.every(turn => object(turn) && valid(turn.turnId) && typeof turn.text === 'string' && ['pending', 'complete', 'failed'].includes(turn.state) &&
                (turn.state !== 'complete' || typeof turn.reply?.text === 'string')) ||
            new Set(result.turns.map(turn => turn.turnId)).size !== result.turns.length) throw Object.assign(new Error('invalid host response'), { code: 'HOST_RESPONSE_INVALID' });
        const pendingTurn = session.pending && result.turns.find(turn => turn.turnId === session.pending.turnId);
        if (pendingTurn && (pendingTurn.text !== session.pending.text ||
            (session.pending.timeZone !== undefined && pendingTurn.timeZone !== undefined && pendingTurn.timeZone !== session.pending.timeZone))) throw new Error('turn conflict');
        if (result[httpStatus] === 202 && (!pendingTurn || pendingTurn.state !== 'pending')) throw Object.assign(new Error('invalid accepted response'), { code: 'HOST_RESPONSE_INVALID' });
        session.records = result.turns.map(turn => ({ turnId: turn.turnId, text: turn.text, state: turn.state,
            ...(turn.timeZone === undefined ? {} : { timeZone: turn.timeZone }),
            ...(turn.state === 'complete' ? { reply: { text: turn.reply.text, usage: turn.reply.usage } } : {}),
            ...(turn.error ? { error: { code: turn.error.code } } : {}), ...(turn.calendar ? { calendar: turn.calendar } : {}) }));
        session.turns = result.turns.flatMap(turn => [{ role: 'user', content: turn.text },
            ...(turn.state === 'complete' && turn.reply.text ? [{ role: 'assistant', content: turn.reply.text }] : []),
            ...(turn.state === 'failed' ? [{ role: 'status', content: turn.error?.code === 'UNAVAILABLE'
                ? (turn.memory?.status === 'saved' || turn.memory?.status === 'partial'
                    ? '기억 처리 후 호스트 답변을 완료하지 못했어요. 이 메시지는 쩜통에 남아 있어요.'
                    : '메시지를 받은 뒤 대화 처리를 완료하지 못했어요. 이 메시지는 쩜통에 남아 있어요.')
                : message(turn.error?.code) }] : [])]);
        for (const turn of result.turns) {
            const envelope = turn.tokenUsage;
            if (!envelope?.tokenUsage || !session.usage) continue;
            if (!valid(result.memoryConversationId)) {
                session.usageWarning = '해마 사용량의 대화 범위를 확인하지 못했어요. 확인되지 않은 값은 합산하지 않아요.';
                continue;
            }
            const usageRequest = { ownerId: session.scope.ownerId, conversationId: result.memoryConversationId,
                turns: envelope.tokenUsage.utteranceIds?.map(utteranceId => ({ utteranceId })) || [] };
            const outcome = session.usage.record(session.storageScope, usageRequest, envelope.tokenUsage, {
                conversationUsage: envelope.conversationUsage, usagePersistence: { status: envelope.persistence }
            });
            if (outcome.ok) session.usage.focus(session.storageScope, usageRequest);
            else session.usageWarning = '이 호스트의 해마 사용량을 확인하지 못했어요. 호스트 답변 토큰은 합산하지 않아요.';
        }
        if (session.pending) {
            const found = result.turns.find(turn => turn.turnId === session.pending.turnId);
            if (found && found.text !== session.pending.text) throw new Error('turn conflict');
            if (found) {
                if (found.state !== 'failed' && session.draft === session.pending.text && session.draftRevision === session.pending.draftRevision) {
                    session.draft = ''; session.draftRevision += 1;
                }
                if (found.state !== 'pending') session.pending = null;
                session.uncertain = false;
                persist(session);
            } else session.uncertain = true;
        }
        session.sending = result.turns.some(turn => turn.state === 'pending') || !!session.pending;
        const pendingCalendar = result.turns.find(turn => turn.state === 'pending' && turn.calendar)?.calendar;
        const calendarStatus = pendingCalendar && ({
            pending: 'Google 처리 결과를 확인하고 있어요. 확인될 때까지 같은 일정을 새로 등록하지 않아요.',
            not_connected: 'Google 계정 연결이 필요해요. 연결 후 대화 상태를 확인해 주세요.',
            reauth_required: 'Google 계정을 다시 연결해야 해요. 재연결 후 대화 상태를 확인해 주세요.',
            conflict: '일정이 달라져 확인이 필요해요. 변경을 완료하지 않았어요.',
            failed: 'Google 일정을 처리하지 못했어요. 등록·변경 완료가 아니에요.'
        }[pendingCalendar.state]);
        session.status = session.uncertain ? '전송 여부를 확인 중이에요. 상태 확인 후 같은 요청으로 다시 시도할 수 있어요.' :
            calendarStatus || (session.sending ? '호스트가 답변을 작성하고 있어요.' : '');
        session.historyReady = true;
        updateReady(session);
    }
    function schedulePoll(session) {
        clearTimeout(session.timer);
        if (session !== active) return;
        if (!session.records.some(turn => turn.state === 'pending')) return;
        if (session.records.some(turn => turn.state === 'pending' &&
            ['not_connected', 'reauth_required'].includes(turn.calendar?.state))) return;
        if (++session.pollCount > 180) { session.status = '처리가 계속되고 있어요. 잠시 뒤 상태를 다시 확인해 주세요.'; return; }
        session.timer = setTimeout(() => refresh(session, false), 1000);
    }
    async function checkHostReady(session) {
        session.hostReady = false;
        session.readinessNotice = '호스트 대화 준비를 확인하고 있어요.';
        try {
            const { storageId, ownerId, hostId } = session.scope;
            const scope = { storageId, ownerId, hostId };
            const result = await request('host.status', scope);
            if (!Object.entries(scope).every(([key, value]) => result[key] === value) || result.ready !== true) {
                throw Object.assign(new Error('invalid readiness'), { code: 'HOST_RESPONSE_INVALID' });
            }
            session.hostReady = true;
            session.readinessNotice = '';
            return true;
        } catch (error) {
            session.readinessNotice = message(error.code);
            if (error.code !== 'AI_SETUP_REQUIRED') session.readinessNotice += ' 대화 상태 확인을 눌러 다시 확인해 주세요.';
            return false;
        } finally { updateReady(session); }
    }
    async function refresh(session = active, checkReadiness = true) {
        if (!session?.scope || session.refreshing || session.submitting) return false;
        session.refreshing = true; session.loading = !session.ready; changed(session);
        try {
            if (checkReadiness) {
                session.ready = false; session.loading = true;
                await Promise.all([loadHosts(), checkHostReady(session)]);
            }
            accept(session, await request('host.conversation.get', session.scope));
            schedulePoll(session);
            return true;
        } catch (error) { session.historyReady = false; session.ready = false; session.status = message(error.code); return false; }
        finally { session.refreshing = false; session.loading = false; updateReady(session); changed(session); }
    }
    function activate(scope, hostId, onChange) {
        notify = onChange;
        try { active = getSession(scope, hostId) || getUnconnectedDraft(hostId); }
        catch { active = null; idle.status = '대화 식별자 또는 임시 입력을 읽지 못했어요. 기존 기록을 보존하고 전송을 멈췄어요.'; changed(null); return; }
        if (!active) { idle.status = '저장소를 연결하면 호스트와 대화할 수 있어요.'; return; }
        const session = active;
        if (session.unconnected) { changed(session); return; }
        refresh(session);
        if (hostId === 'schedule') calendarStatus(session);
    }
    function reset() { active = null; notify = null; for (const session of sessions.values()) clearTimeout(session.timer); }
    async function loadHosts() {
        if (!active?.scope) return catalogReady;
        if (catalogRequest) return catalogRequest;
        catalogRequest = (async () => {
            try {
                const result = await request('host.list');
                if (result.defaultMode !== 'haema-only' || !Array.isArray(result.modes) || result.modes.length !== 2 ||
                    !['haema-only', 'host'].every(id => result.modes.filter(item => object(item) && item.id === id &&
                        typeof item.name === 'string' && item.name.trim() && item.hostReply === (id === 'host')).length === 1) ||
                    !Array.isArray(result.hosts) || result.hosts.length !== hosts.length ||
                    !hosts.every(host => result.hosts.filter(item => object(item) && item.id === host.id && typeof item.name === 'string' && item.name.trim() && item.name.length <= 80).length === 1)) {
                    throw Object.assign(new Error('invalid host catalog'), { code: 'HOST_RESPONSE_INVALID' });
                }
                catalogReady = true; catalogNotice = '';
                return true;
            } catch (error) { catalogReady = false; catalogNotice = message(error.code); return false; }
            finally {
                idle.status = catalogNotice;
                for (const session of sessions.values()) updateReady(session);
                changed(active);
            }
        })();
        try { return await catalogRequest; } finally { catalogRequest = null; }
    }
    function setDraft(text) {
        if (!active || typeof text !== 'string') return;
        active.draft = text; active.draftRevision += 1;
        try {
            persist(active); active.persistenceFailed = false;
            if (active.unconnected) active.status = unconnectedNotice;
            updateReady(active);
        } catch {
            active.persistenceFailed = true; active.ready = false;
            active.status = active.unconnected ? '임시 입력을 저장하지 못했어요. 새로고침 전까지 열린 화면에서만 보관해요.' : '임시 입력을 보관하지 못해 전송을 멈췄어요.';
        }
    }
    function canSend(session) {
        const status = globalThis.HAEMA_LOCAL_CONNECTION?.status?.();
        const app = globalThis.HAEMA_CONSOLE;
        if (status?.connection === 'connected' && typeof app?.getConversationScope === 'function') {
            const current = app.getConversationScope();
            if (!app.isStorageReady() || current?.storageId !== session.scope.storageId || current.ownerId !== session.scope.ownerId) {
                session.status = '이 대화를 저장한 쩜통의 연결을 확인해 주세요. 작성한 내용은 보존했어요.';
                changed(session);
                return false;
            }
        }
        if (status?.connection === 'connected' && status.aiReady === true) return true;
        session.status = message(status?.connection !== 'connected' ? 'CONNECTION_REQUIRED' :
            status.runtimeMode === 'setup-only' ? 'AI_SETUP_REQUIRED' : 'AI_NOT_CONFIGURED');
        changed(session);
        return false;
    }
    async function deliver(session) {
        if (session.submitting || !session.pending || !canSend(session)) return false;
        let readBack = false;
        session.submitting = true; session.sending = true; session.status = '메시지를 보내고 있어요.'; changed(session);
        try {
            const { turnId, text, timeZone } = session.pending;
            const payload = { ...session.scope, turnId, text, ...(timeZone === undefined ? {} : { timeZone }) };
            accept(session, await request('host.conversation.send', payload, true));
            schedulePoll(session);
            return true;
        } catch (error) {
            session.uncertain = true; session.status = message(error.code);
            readBack = true;
            return false;
        } finally {
            session.submitting = false;
            if (readBack && session === active) await refresh(session, false);
            changed(session);
        }
    }
    function send(text) {
        const session = active;
        if (!session || !session.ready || session.sending || session.loading || typeof text !== 'string' || !text.trim()) return Promise.resolve(false);
        if (!canSend(session)) return Promise.resolve(false);
        let zone;
        if (session.scope.hostId === 'schedule') {
            try { zone = timeZone(); if (!valid(zone)) throw new Error('invalid time zone'); }
            catch { session.status = '사용 중인 시간대를 확인하지 못했어요. 시간대를 확인한 뒤 다시 보내 주세요.'; changed(session); return Promise.resolve(false); }
        }
        session.pending = { turnId: crypto.randomUUID(), text, ...(zone === undefined ? {} : { timeZone: zone }), draftRevision: session.draftRevision };
        session.draft = text; session.pollCount = 0;
        try { persist(session); } catch { session.pending = null; session.persistenceFailed = true; session.ready = false; session.status = '전송 식별자를 보관하지 못해 메시지를 보내지 않았어요.'; changed(session); return Promise.resolve(false); }
        return deliver(session);
    }
    async function retry() {
        const session = active;
        if (!session || !await refresh(session)) return false;
        // Only a confirmed missing turn can be sent again, with its original ID and body.
        if (session.ready && session.uncertain && session.pending && !session.records.some(turn => turn.turnId === session.pending.turnId)) return deliver(session);
        return true;
    }
    function calendarScope(session) { const { storageId, ownerId } = session.scope; return { storageId, ownerId, hostId: 'schedule' }; }
    async function calendarStatus(session = active) {
        if (!session?.scope || session.scope.hostId !== 'schedule') return;
        if (session.calendarLoading) return;
        session.calendarLoading = true; session.calendarError = ''; changed(session);
        try {
            const result = await request('calendar.status', calendarScope(session));
            if (!Object.entries(calendarScope(session)).every(([key, value]) => result[key] === value) ||
                !['not_configured', 'disconnected', 'connected', 'reauth_required', 'calendar_pending'].includes(result.state) ||
                result.configured !== (result.state !== 'not_configured') || result.connected !== (result.state === 'connected')) throw new Error('calendar response');
            session.calendar = { state: result.state, connected: result.connected, configured: result.configured,
                ...(typeof result.timeZone === 'string' ? { timeZone: result.timeZone } : {}) };
            session.calendarNotice = '';
            if (session === active && result.state === 'connected' && session.records.some(turn => turn.state === 'pending' && turn.calendar)) refresh(session, false);
            return true;
        } catch { session.calendarError = '캘린더 연결 상태를 확인하지 못했어요. 연결 상태 확인을 눌러 다시 확인해 주세요.'; return false; }
        finally { session.calendarLoading = false; changed(session); }
    }
    async function connectCalendar() {
        const session = active;
        if (!session?.scope || session.scope.hostId !== 'schedule' || session.calendarBusy || session.calendarLoading) return;
        if (session.calendar?.state === 'calendar_pending') {
            session.calendarNotice = '전용 달력 확인 중이에요. 새 연결을 만들지 않고 연결 상태를 다시 확인해 주세요.'; changed(session); return;
        }
        const popup = window.open('about:blank', 'haema-google-calendar', 'popup,width=560,height=760');
        if (!popup) { session.calendarNotice = '팝업을 허용한 뒤 Google 계정을 연결해 주세요.'; changed(session); return; }
        session.calendarBusy = true; changed(session);
        try {
            const result = await request('calendar.connect', { ...calendarScope(session), timeZone: timeZone() });
            if (!globalThis.HAEMA_LOCAL_CONNECTION?.acceptsLocalNavigation?.(result.authorizationUrl)) throw new Error('invalid authorization URL');
            popup.opener = null;
            popup.location.href = result.authorizationUrl;
            window.addEventListener('focus', () => { if (session === active) return calendarStatus(session); }, { once: true });
            session.calendarNotice = 'Google 연결을 마친 뒤 연결 상태 확인을 눌러 주세요.';
        } catch (error) { popup.close(); session.calendarNotice = message(error.code); }
        finally { session.calendarBusy = false; changed(session); }
    }
    async function disconnectCalendar() {
        const session = active;
        if (!session?.scope || session.scope.hostId !== 'schedule' || session.calendarBusy) return;
        session.calendarBusy = true; changed(session);
        try { await request('calendar.disconnect', calendarScope(session)); await calendarStatus(session); }
        catch (error) { session.calendarNotice = message(error.code); }
        finally { session.calendarBusy = false; changed(session); }
    }
    return { hosts, get state() { return active || idle; }, loadHosts, activate, reset, send, retry, refresh, setDraft,
        calendarStatus, connectCalendar, disconnectCalendar };
})();
