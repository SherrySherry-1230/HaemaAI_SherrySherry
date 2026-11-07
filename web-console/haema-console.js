// @editedBy YAONG1230
(() => {
    'use strict';

    const picker = document.getElementById('testHostSelect');
    const heading = document.getElementById('hostHeading');
    const form = document.getElementById('chatForm');
    const initialEditor = document.getElementById('chatInput');
    const template = initialEditor.cloneNode(false);
    const editors = new Map();
    const editorSlot = document.createElement('div');
    editorSlot.className = 'editor-slot';
    initialEditor.replaceWith(editorSlot);
    const draftKey = host => `haema.console.draft:${location.pathname}:${host}`;
    let editor;
    let selected = '';
    let composing = false;

    function restoreDraft(field, host) {
        try {
            field.value = sessionStorage.getItem(draftKey(host)) || '';
        } catch {
            // The editor still keeps its text when browser storage is unavailable.
        }
    }

    function saveDraft() {
        try {
            if (editor.value) sessionStorage.setItem(draftKey(selected), editor.value);
            else sessionStorage.removeItem(draftKey(selected));
        } catch {
            // Switching conversations also works with just the editors in this tab.
        }
    }

    function createEditor(host) {
        // Keep each native editing document mounted so Undo stays with its conversation.
        const frame = document.createElement('iframe');
        frame.className = 'conversation-editor';
        frame.title = `${picker.selectedOptions[0].text} 메시지 입력`;
        editorSlot.append(frame);
        const doc = frame.contentDocument;
        doc.documentElement.lang = 'ko';
        doc.head.append(document.getElementById('console-view-style').cloneNode(true));
        const style = doc.createElement('style');
        style.textContent = `
            html, body { height: 100%; overflow: hidden; }
            .user-input { display: block; width: 100%; height: 100%;
                min-height: 0; max-height: none; resize: none; }
            .user-input:focus-visible { outline-offset: -3px; }
        `;
        doc.head.append(style);
        const field = doc.importNode(template, false);
        restoreDraft(field, host);
        doc.body.append(field);
        field.addEventListener('input', event => {
            if (field === editor && !event.isComposing && !composing) saveDraft();
        });
        field.addEventListener('compositionstart', () => { composing = true; });
        field.addEventListener('compositionend', () => {
            composing = false;
            saveDraft();
            selectConversation(picker.value);
        });
        const view = { frame, field };
        editors.set(host, view);
        return view;
    }

    function selectConversation(host) {
        if (host === selected || composing) return;
        saveDraft();
        const next = editors.get(host) || createEditor(host);
        editors.get(selected).frame.hidden = true;
        next.frame.hidden = false;
        editor = next.field;
        selected = host;
        heading.textContent = host ? picker.selectedOptions[0].text : '해마.ai';
    }

    picker.value = '';
    window.HaemaHostPicker.bind(picker, selectConversation);
    editor = createEditor(selected).field;
    form.addEventListener('submit', event => event.preventDefault());

    const panels = document.querySelector('.console-panels');
    const tabs = document.querySelectorAll('.mobile-tabs button');
    for (const tab of tabs) {
        tab.addEventListener('click', () => {
            panels.dataset.mobilePanel = tab.dataset.mobilePanel;
            for (const item of tabs) item.setAttribute('aria-pressed', String(item === tab));
        });
    }
})();
