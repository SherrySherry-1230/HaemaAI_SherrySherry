// @editedBy YAONG1230 2026-10-20
// The HTTP contract is proposed in docs/INTRODUCTION_API_PROPOSAL.md.
(function(global) {
    'use strict';
    const records = new Map();
    const DRAFT_KEY = 'haema_introduction_drafts_v1';
    const placeholder = '챗봇에게 당신에 대해 알려주세요! 어떻게 불러드릴까요?';
    const scopeKey = scope => JSON.stringify([scope?.ownerId || '', scope?.storageRoot || '', scope?.storageId || '']);
    const sameScope = (a, b) => !!a && !!b && a.ownerId === b.ownerId && a.storageRoot === b.storageRoot && a.storageId === b.storageId;
    const client = () => global.HAEMA_INTRODUCTION.create();

    function drafts() {
        const raw = global.sessionStorage.getItem(DRAFT_KEY);
        const data = raw === null ? { version: 1, entries: [] } : JSON.parse(raw);
        if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.some(item =>
            !item || typeof item.key !== 'string' || typeof item.text !== 'string') ||
            new Set(data.entries.map(item => item.key)).size !== data.entries.length) throw Error('draft');
        return data;
    }
    function preserveDraft(record, remove = false) {
        try {
            const data = drafts();
            data.entries = data.entries.filter(item => item.key !== record.key);
            if (!remove) data.entries.push({ key: record.key, text: record.text });
            global.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
            record.draftWarning = '';
        } catch {
            record.draftWarning = '초안을 이 탭에 보관하지 못했어요. 새로고침 전에 내용을 복사해 주세요.';
        }
    }
    function recordFor(scope) {
        const key = scopeKey(scope);
        if (!records.has(key)) {
            const record = { key, scope: scope ? { ...scope } : null, text: '', serverText: '', displayName: '사용자',
                revision: null, loaded: false, loading: false, attempted: false, saving: false, dirty: false,
                error: '', notice: '', draftWarning: '' };
            try {
                const saved = drafts().entries.find(item => item.key === key);
                if (saved) { record.text = saved.text; record.dirty = true; }
            } catch {
                record.draftWarning = '기존 초안을 확인하지 못했어요. 보관된 기록은 그대로 두었습니다.';
            }
            records.set(key, record);
        }
        return records.get(key);
    }
    const currentRecord = consoleApp => recordFor(consoleApp.getConversationScope());
    const identified = (consoleApp, record) => consoleApp.hasStorageId(record.scope);
    const isCurrent = (consoleApp, record) => sameScope(record.scope, consoleApp.getConversationScope());
    const isOpen = (consoleApp, record) => consoleApp.modalMode === 'introduction' && consoleApp.modalData === record;
    function notify(consoleApp, record) {
        if (isOpen(consoleApp, record)) refresh(consoleApp, record);
        if (isCurrent(consoleApp, record)) consoleApp.render();
    }
    function message(consoleApp, record) {
        if (!record.scope || !identified(consoleApp, record)) return '저장소를 연결한 뒤 자기소개를 저장할 수 있어요. 입력은 이 탭에 보관해요.';
        if (!isCurrent(consoleApp, record)) return '연결된 저장소가 바뀌었어요. 입력은 이전 저장소의 초안으로 보관해요.';
        if (record.saving) return '자기소개를 저장하고 있어요.';
        if (record.loading) return '저장된 자기소개를 확인하고 있어요. 먼저 작성하셔도 괜찮아요.';
        return record.error || record.notice || '이름이나 원하는 호칭, 기억해 줬으면 하는 내용을 자유롭게 적어주세요.';
    }
    function refresh(consoleApp, record) {
        if (!isOpen(consoleApp, record)) return;
        const text = document.getElementById('modalIntroduction');
        const save = document.getElementById('modalSave');
        const reload = document.getElementById('introductionReload');
        const status = document.getElementById('introductionStatus');
        const warning = document.getElementById('introductionDraftWarning');
        if (text) text.disabled = record.saving;
        if (save) {
            save.disabled = record.saving || record.loading || !record.loaded || !isCurrent(consoleApp, record) || !record.text.trim();
            save.textContent = record.saving ? '저장 중…' : '저장';
        }
        if (reload) reload.disabled = record.loading || record.saving || !identified(consoleApp, record) || !isCurrent(consoleApp, record);
        if (status) status.textContent = message(consoleApp, record);
        if (warning) warning.textContent = record.draftWarning;
    }
    async function load(consoleApp, record) {
        if (record.loading || record.saving || !identified(consoleApp, record)) return;
        record.loading = true;
        record.attempted = true;
        record.error = '';
        refresh(consoleApp, record);
        try {
            await consoleApp.verifyConversationScope(record.scope);
            const result = await client().load(record.scope);
            if (!result.ok) throw result;
            await consoleApp.verifyConversationScope(record.scope);
            const saved = result.introduction;
            record.serverText = saved.text;
            record.displayName = saved.displayName;
            record.revision = saved.revision;
            record.loaded = true;
            if (!record.dirty) {
                record.text = saved.text;
                if (isOpen(consoleApp, record)) {
                    const input = document.getElementById('modalIntroduction');
                    if (input) input.value = saved.text;
                }
            } else if (record.text === saved.text) {
                record.dirty = false;
                preserveDraft(record, true);
            }
            record.notice = record.dirty ? '저장된 소개를 확인했어요. 작성 중인 입력은 유지했으며, 저장하면 이 내용으로 갱신돼요.' : '';
        } catch (error) {
            record.loaded = false;
            record.error = error.code === 'INTRODUCTION_NOT_READY'
                ? '자기소개 저장 기능을 준비 중이에요. 작성한 내용은 이 탭에 보관해요.'
                : error.error || error.message || '저장된 소개를 불러오지 못했어요. 입력은 유지했어요.';
        } finally {
            record.loading = false;
            notify(consoleApp, record);
        }
    }
    function button(consoleApp) {
        const record = currentRecord(consoleApp);
        if (identified(consoleApp, record) && !record.attempted && !record.loading) {
            record.attempted = true;
            Promise.resolve().then(() => load(consoleApp, record));
        }
        const label = record.serverText.trim() ? '👤: ' + record.displayName : '👤: 자신을 소개해주세요';
        return '<button class="tool-button introduction-button" id="introductionBtn" type="button" aria-haspopup="dialog" title="' + consoleApp.escapeHtml(label) + '"><img src="Resources/haema-design/10-storage-button.svg" alt="" aria-hidden="true"><span>' + consoleApp.escapeHtml(label) + '</span></button>';
    }
    function open(consoleApp) {
        const record = currentRecord(consoleApp);
        consoleApp.modalReturnFocus = consoleApp.getFocusReference(document.activeElement);
        consoleApp.modalMode = 'introduction';
        consoleApp.modalData = record;
        consoleApp.render();
        if (!record.loaded && !record.loading) load(consoleApp, record);
    }
    function render(consoleApp) {
        const record = consoleApp.modalData;
        return '<div class="form-group"><label class="form-label" for="modalIntroduction">나를 소개하는 글</label>' +
            '<textarea class="form-textarea introduction-textarea" id="modalIntroduction" rows="8" placeholder="' + placeholder + '" aria-describedby="introductionStatus introductionDraftWarning">' + consoleApp.escapeHtml(record.text) + '</textarea></div>' +
            '<p class="introduction-status" id="introductionStatus" role="status" aria-live="polite">' + consoleApp.escapeHtml(message(consoleApp, record)) + '</p>' +
            '<p class="introduction-status" id="introductionDraftWarning" role="status">' + consoleApp.escapeHtml(record.draftWarning) + '</p>' +
            '<button class="btn btn-secondary" id="introductionReload" type="button">저장된 소개 다시 확인</button>';
    }
    function bind(consoleApp) {
        const record = consoleApp.modalData;
        const input = document.getElementById('modalIntroduction');
        input?.addEventListener('compositionstart', () => { consoleApp.isComposing = true; });
        input?.addEventListener('compositionend', () => {
            consoleApp.isComposing = false;
            record.text = input.value;
            record.dirty = record.text !== record.serverText;
            preserveDraft(record, !record.dirty);
            if (consoleApp.deferredCompositionRender) consoleApp.render();
            else refresh(consoleApp, record);
        });
        input?.addEventListener('input', () => {
            record.text = input.value;
            record.dirty = record.text !== record.serverText;
            if (record.loaded) record.error = '';
            record.notice = '';
            preserveDraft(record, !record.dirty);
            refresh(consoleApp, record);
        });
        document.getElementById('introductionReload')?.addEventListener('click', () => load(consoleApp, record));
        refresh(consoleApp, record);
    }
    async function save(consoleApp) {
        const record = consoleApp.modalData;
        if (!record || record.saving || record.loading || !record.loaded || !isCurrent(consoleApp, record) || !record.text.trim()) return;
        const text = record.text;
        const revision = record.revision;
        record.saving = true;
        record.error = '';
        preserveDraft(record);
        refresh(consoleApp, record);
        try {
            await consoleApp.verifyConversationScope(record.scope);
            const result = await client().save(record.scope, text, revision);
            if (!result.ok) throw result;
            await consoleApp.verifyConversationScope(record.scope);
            record.serverText = result.introduction.text;
            record.displayName = result.introduction.displayName;
            record.revision = result.introduction.revision;
            record.text = text;
            record.dirty = false;
            record.loaded = true;
            record.notice = '자기소개가 저장됐어요.';
            preserveDraft(record, true);
        } catch (error) {
            record.error = error.code === 'INTRODUCTION_CONFLICT'
                ? '저장된 소개가 바뀌었어요. 입력은 유지했으니 저장된 소개를 다시 확인한 뒤 저장해 주세요.'
                : error.code === 'INTRODUCTION_NOT_READY'
                    ? '자기소개 저장 기능을 준비 중이에요. 입력은 이 탭에 보관해요.'
                    : error.error || error.message || '저장 완료를 확인하지 못했어요. 입력은 유지했어요.';
            if (error.code === 'INTRODUCTION_CONFLICT' || error.code === 'INTRODUCTION_NOT_READY') record.loaded = false;
        } finally {
            record.saving = false;
            notify(consoleApp, record);
        }
    }
    global.HAEMA_INTRODUCTION_MODAL = { button, open, render, bind, save };
})(window);
