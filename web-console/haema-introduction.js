// @editedBy YAONG1230 2026-10-20
// Proposed owner-introduction API, awaiting backend implementation/confirmation.
// The server selects displayName; this client never infers a name from the text.
// Connection status before/after each request and draft ownership belong to the UI.
(function (global) {
    'use strict';
    const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value;
    const validRevision = value => Number.isSafeInteger(value) && value >= 0;
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    function validScope(scope) {
        return object(scope) && validId(scope.ownerId) && !['.', '..'].includes(scope.ownerId) && validId(scope.storageId) &&
            typeof scope.storageRoot === 'string' && scope.storageRoot.trim().length > 0;
    }
    function sameScope(a, b) {
        return validScope(a) && validScope(b) && a.ownerId === b.ownerId && a.storageRoot === b.storageRoot && a.storageId === b.storageId;
    }
    function validDisplayName(value) {
        return typeof value === 'string' && value.trim() === value && value.length > 0 && Array.from(value).length <= 512 &&
            !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
    }
    function validTimestamp(value) {
        if (typeof value !== 'string') return false;
        const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
        if (!parts) return false;
        const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
            Number(parts[4]) <= 23 && Number(parts[5]) <= 59 && Number(parts[6]) <= 59 &&
            (!parts[7] || (Number(parts[8]) <= 23 && Number(parts[9]) <= 59)) && Number.isFinite(Date.parse(value));
    }
    const failure = (code, message, status = 0) => ({ ok: false, code, error: message, status });
    const invalid = status => failure('INTRODUCTION_INVALID', '자기소개 응답을 확인하지 못했어요. 입력한 내용은 그대로 두었습니다.', status);
    function create(options = {}) {
        const requestFetch = options.fetch || ((...args) => global.fetch(...args));
        async function request(scope, method, text, revision) {
            if (!validScope(scope)) return failure('INTRODUCTION_SCOPE', '연결된 저장소와 사용자를 확인해 주세요.');
            if (method === 'PUT' && (typeof text !== 'string' || !validRevision(revision))) return invalid(0);
            // Snapshot the caller's scope before the first await. A later UI
            // selection must not change the identity expected for this response.
            const expected = { ownerId: scope.ownerId, storageRoot: scope.storageRoot, storageId: scope.storageId };
            let url;
            try {
                url = '/api/owners/' + encodeURIComponent(expected.ownerId) + '/introduction' +
                    (method === 'GET' ? '?storageId=' + encodeURIComponent(expected.storageId) : '');
            } catch { return failure('INTRODUCTION_SCOPE', '연결된 저장소와 사용자를 확인해 주세요.'); }
            const init = { method, cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } };
            if (method === 'PUT') {
                init.headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify({ storageId: expected.storageId, text, revision });
            }
            let response;
            try { response = await requestFetch(url, init); }
            catch { return failure('INTRODUCTION_NETWORK', '자기소개 서버에 연결하지 못했어요. 입력한 내용은 그대로 두었습니다.'); }
            const status = response?.status;
            if ([404, 405, 501].includes(status)) {
                return failure('INTRODUCTION_NOT_READY', '자기소개 저장 기능은 서버 연결을 준비 중이에요. 입력한 내용은 그대로 두었습니다.', status);
            }
            if (status === 409) return failure('INTRODUCTION_CONFLICT', '자기소개가 변경됐거나 저장소 연결이 달라졌어요. 최신 상태를 다시 확인해 주세요.', status);
            if (!Number.isInteger(status) || status < 100 || status > 599 || typeof response?.ok !== 'boolean') return invalid(0);
            if (!response.ok || status < 200 || status >= 300) return failure('INTRODUCTION_HTTP', '자기소개를 읽거나 저장하지 못했어요. 입력한 내용은 그대로 두었습니다.', status);
            let payload;
            try { payload = await response.json(); } catch { return invalid(status); }
            if (!object(payload)) return invalid(status);
            if (payload.success === false) return failure('INTRODUCTION_HTTP', '자기소개를 읽거나 저장하지 못했어요. 입력한 내용은 그대로 두었습니다.', status);
            if (payload.success !== true || payload.ownerId !== expected.ownerId || payload.storageId !== expected.storageId) return invalid(status);
            const introduction = payload.introduction;
            if (!object(introduction) || typeof introduction.text !== 'string' || !validRevision(introduction.revision) || !validDisplayName(introduction.displayName)) return invalid(status);
            if (introduction.revision === 0) {
                if (introduction.text !== '' || introduction.updatedAt !== null || introduction.displayName !== '사용자') return invalid(status);
            } else if (!validTimestamp(introduction.updatedAt)) return invalid(status);
            if (method === 'PUT' && (introduction.text !== text || introduction.revision <= revision || !validTimestamp(introduction.updatedAt))) return invalid(status);
            return { ok: true, scope: expected, ownerId: expected.ownerId, storageId: expected.storageId,
                introduction: { text: introduction.text, displayName: introduction.displayName, revision: introduction.revision, updatedAt: introduction.updatedAt } };
        }
        return {
            load: scope => request(scope, 'GET'),
            save: (scope, text, revision) => request(scope, 'PUT', text, revision)
        };
    }
    global.HAEMA_INTRODUCTION = { create, sameScope };
})(window);
