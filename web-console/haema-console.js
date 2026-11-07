// @editedBy YAONG1230
(() => {
    'use strict';

    const picker = document.getElementById('testHostSelect');
    const heading = document.getElementById('hostHeading');
    const form = document.getElementById('chatForm');
    const initialEditor = document.getElementById('chatInput');
    const template = initialEditor.cloneNode(false);
    const editors = new Map([['', initialEditor]]);
    const draftKey = host => `haema.console.draft:${location.pathname}:${host}`;
    let editor = initialEditor;
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

    function selectConversation(host) {
        if (host === selected || composing) return;
        saveDraft();
        let next = editors.get(host);
        if (!next) {
            next = template.cloneNode(false);
            restoreDraft(next, host);
            editors.set(host, next);
        }
        editor.replaceWith(next);
        editor = next;
        selected = host;
        heading.textContent = host ? picker.selectedOptions[0].text : '해마.ai';
    }

    picker.value = '';
    restoreDraft(editor, selected);
    window.HaemaHostPicker.bind(picker, selectConversation);
    form.addEventListener('input', event => {
        if (event.target === editor && !event.isComposing && !composing) saveDraft();
    });
    form.addEventListener('compositionstart', () => { composing = true; });
    form.addEventListener('compositionend', () => {
        composing = false;
        saveDraft();
        selectConversation(picker.value);
    });
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
