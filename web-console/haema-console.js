// @editedBy YAONG1230 2026-11-10: separate toolbar states and calendar status presentation
// @editedBy SherrySherry 2026-11-09: shared connection rendering; stored values preserved
// @editedBy SherrySherry 2026-11-06: six server hosts, scoped drafts/history, Calendar connection controls
// @editedBy YAONG1230 2026-11-06: 선택한 테스트 호스트와 왼쪽 대화창에서 대화
// @editedBy SherrySherry 2026-11-05: separate introduction usage and conversation token details
// @editedBy YAONG1230 2026-11-05: 표시 허용된 쩜 이름·별칭 보존; 파일명/개인정보 보호와 분리
// @editedBy YAONG1230 2026-10-26: Figma toolbar artwork; existing connection actions preserved
// @editedBy YAONG1230 2026-10-28: 저장소 중첩 모달 DOM 보존
// @editedBy YAONG1230 2026-10-28: 회상 제목 프레임과 패널 아래 응답 가이드
// @editedBy YAONG1230 2026-10-28: 대화 이력의 회상 결과 선택과 패널 내부 뷰포트
// @editedBy SherrySherry 2026-10-05
// @editedBy SherrySherry 2026-09-24
// @editedBy YAONG1230 2026-10-03
// @editedBy YAONG1230 2026-10-04
// @editedBy YAONG1230 2026-10-05
// @editedBy YAONG1230 2026-10-07
// @editedBy YAONG1230 2026-10-08
// @editedBy YAONG1230 2026-10-10
// @editedBy YAONG1230 2026-10-14
// @editedBy YAONG1230 2026-10-16: 로컬 AI 연결 안내와 모델 선택 보존
// @editedBy YAONG1230 2026-10-16: 발화별 토큰 계량 표시와 프론트 수신 경계
// @editedBy YAONG1230 2026-10-17: 토큰 v2 응답과 서버 누적 복원 연결
// @editedBy YAONG1230 2026-10-18: 연결된 저장소 식별자와 최초 사용량 응답 대조
// @editedBy YAONG1230 2026-10-20: 자기소개 입력과 저장 호칭 버튼
// @editedBy YAONG1230 2026-10-21: 모달 편집 선택 방향 보존
// @editedBy YAONG1230 2026-10-22: 연속 제출·변경 스냅샷·접수와 처리 상태 분리
// @editedBy SherrySherry 2026-11-05: 비동기 갱신 중 입력·조합·실행 취소 보존
// HAEMA_CONSOLE - 해마.AI 콘솔 애플리케이션
HAEMA_CONSOLE = {
    status: 'resting',
    statusText: '해마 쉬는 중...',
    recallResults: [],
    answerGuide: null,
    latestResult: null,
    selectedHistoryResult: null,
    selectedResultAnchor: null,
    resultSelectionKeys: new WeakMap(),
    nextResultSelectionKey: 0,
    previewGuideState: null,
    previewUsageDetailsOpen: false,
    recallShapeHistory: new Map(),
    previewState: 'idle',
    allJJums: [],
    cardShapeHistory: new Map(),
    streamingJJums: new Set(),
    selectedJJumId: null,
    storageConnected: false,
    storageIdentity: null,
    apiConfigured: false,
    sending: false,
    sendPressed: false,
    sendPressTimer: null,
    modalMode: null,
    modalData: null,
    throttleTimer: null,  // 실시간 타이핑 쓰로틀 타이머 (0.5초 간격)
    backgroundStreamTimer: null,  // 백그라운드 스트리밍 타이머
    lastInputValue: '',
    typingStartTime: 0,
    lastKeystrokeTime: 0,
    hesitationDetected: false,
    emotionContext: null,  // 감지된 감정 컨텍스트
    conversationHistory: [],
    conversationOwnerId: 'demo',
    conversationSession: null,
    tokenUsage: null,
    tokenUsageError: null,
    tokenUsageRestoreKey: null,
    introductionTokenUsage: null,
    introductionTokenUsageError: null,
    introductionUsageRestoreKey: null,
    conversationScopeEpoch: 0,
    conversationSessionError: '',
    conversationSessionNotice: '',
    conversationPersistenceBlocked: false,
    activeConversationScope: null,
    draftVersion: 0,
    activeMobilePanel: 'chat',
    selectedTestHost: '',
    hostPickerOpen: false,
    hostPickerActiveId: null,
    boundHostPickers: new WeakSet(),
    typingTimer: null,
    isComposing: false,
    boundInputElements: new WeakSet(),
    apiKeyName: '',

    // 쩜 데이터는 외부에서 주입하거나 모달로 추가한다.
    // 초기 샘플 데이터는 넣지 않는다.

};

// ===== 렌더링 함수 =====
HAEMA_CONSOLE.replaceViewPreservingInput = function(app, html, input) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const nextInput = template.content.querySelector('#userInput');
    const pathTo = (element, root) => {
        const path = [];
        while (element && element !== root) { path.unshift(element); element = element.parentNode; }
        return element === root ? path : [];
    };
    const previousPath = pathTo(input, app);
    const nextPath = pathTo(nextInput, template.content);
    if (!previousPath.length || input?.dataset?.editor !== nextInput?.dataset?.editor || previousPath.length !== nextPath.length ||
        previousPath.some((element, index) => element.tagName !== nextPath[index].tagName || element.id !== nextPath[index].id)) {
        app.replaceChildren(template.content);
        return;
    }
    // Keep the entire editor ancestry connected. Moving even the same textarea
    // through a fragment cancels native editing/IME state and its undo history.
    let parent = app;
    for (let index = 0; index < previousPath.length; index += 1) {
        const kept = previousPath[index];
        const next = nextPath[index];
        const before = document.createDocumentFragment();
        const after = document.createDocumentFragment();
        let passed = false;
        for (const sibling of [...next.parentNode.childNodes]) {
            if (sibling === next) { passed = true; continue; }
            (passed ? after : before).appendChild(sibling);
        }
        for (const sibling of [...parent.childNodes]) if (sibling !== kept) sibling.remove();
        parent.insertBefore(before, kept);
        parent.appendChild(after);
        // Keep the editor's availability stable while preserving its native history.
        const managed = name => kept === input && ['disabled', 'readonly', 'title'].includes(name);
        for (const attribute of [...kept.attributes]) {
            if (!managed(attribute.name) && !next.hasAttribute(attribute.name)) kept.removeAttribute(attribute.name);
        }
        for (const attribute of next.attributes) {
            if (!managed(attribute.name) && kept.getAttribute(attribute.name) !== attribute.value) kept.setAttribute(attribute.name, attribute.value);
        }
        parent = kept;
    }
};

HAEMA_CONSOLE.render = function() {
    if (this.isComposing) { this.deferredCompositionRender = true; return; }
    this.deferredCompositionRender = false;
    const app = document.getElementById("app");
    // allJJums가 초기화되지 않았으면 빈 배열로 초기화
    if (!this.allJJums) {
        this.allJJums = [];
    }
    // 입력창의 현재 값 보존 (렌더링 시 입력값 초기화 방지)
    const userInput = document.getElementById("userInput");
    const preservedValue = userInput ? userInput.value : "";
    const preservedFocus = userInput ? document.activeElement === userInput : false;
    const activeElementId = document.activeElement?.id || "";
    const activeFocus = this.getFocusReference(document.activeElement);
    const selection = userInput ? [userInput.selectionStart, userInput.selectionEnd, userInput.selectionDirection] : null;
    const scrollPositions = [...document.querySelectorAll('[data-scroll-key]')].map(node => [node.dataset.scrollKey, node.scrollTop, node.scrollLeft]);
    const previewGuide = document.getElementById('previewGuideContent');
    if (previewGuide && !previewGuide.hidden && this.previewGuideState) this.previewGuideState.scrollTop = previewGuide.scrollTop;
    const previewUsageDetails = document.getElementById('previewUsageDetails');
    if (previewUsageDetails) this.previewUsageDetailsOpen = previewUsageDetails.open;
    const storageOverlays = ['storageModalOverlay', 'existingStorageModalOverlay']
        .map(id => document.getElementById(id)).filter(Boolean);
    const sameModal = this.renderedModalMode === this.modalMode && this.renderedModalData === this.modalData;
    const modalDrafts = (sameModal ? [...document.querySelectorAll('.modal-overlay.active input, .modal-overlay.active textarea, .modal-overlay.active select')] : [])
        .filter(node => node.id).map(node => [node.id,
            node.id === 'modalApiModel' ? node.value || node.dataset.selectedModel || '' : node.value,
            node.selectionStart, node.selectionEnd, node.selectionDirection]);

    this.replaceViewPreservingInput(app, this.renderHeader() + this.renderMainContainer() + this.renderModal(), userInput);
    if (typeof HAEMA_TOKEN_METER !== 'undefined' && typeof HAEMA_TOKEN_METER.animate === 'function') {
        const scope = this.getConversationScope();
        HAEMA_TOKEN_METER.animate(app, scope ? JSON.stringify([scope.ownerId, scope.storageRoot, scope.storageId ?? null, this.selectedTestHost || 'haema-only']) : '');
    }
    this.renderedModalMode = this.modalMode;
    this.renderedModalData = this.modalData;
    storageOverlays.forEach(overlay => app.appendChild(overlay));

    // 입력창 값 복원
    const restoredInput = document.getElementById("userInput");
    if (restoredInput && userInput) {
        const pendingRestore = this.incrementalDraftRestore;
        const draftRestore = pendingRestore?.draftVersion === this.draftVersion ? pendingRestore : null;
        if (draftRestore) this.lastInputValue = draftRestore.text;
        const fromHost = userInput?.dataset?.editor?.startsWith('host-');
        const normalValue = draftRestore ? draftRestore.text : fromHost ? this.lastInputValue : preservedValue;
        const restoredValue = this.selectedTestHost ? globalThis.HAEMA_TEST_HOST.state.draft : normalValue;
        if (restoredInput.value !== restoredValue) restoredInput.value = restoredValue;
        this.incrementalDraftRestore = null;
        if (preservedFocus && restoredInput !== userInput) {
            restoredInput.focus();
            if (selection && !draftRestore) restoredInput.setSelectionRange(selection[0], selection[1], selection[2]);
        }
    }
    scrollPositions.forEach(([key, top, left]) => {
        const node = [...document.querySelectorAll('[data-scroll-key]')].find(item => item.dataset.scrollKey === key);
        if (node) { node.scrollTop = top; node.scrollLeft = left; }
    });
    const restoredGuide = document.getElementById('previewGuideContent');
    if (restoredGuide && !restoredGuide.hidden && this.previewGuideState) restoredGuide.scrollTop = this.previewGuideState.scrollTop;
    if (this.pendingConversationScroll) {
        const history = document.querySelector('.conversation-history');
        if (history) history.scrollTop = history.scrollHeight;
        this.pendingConversationScroll = false;
    }
    modalDrafts.forEach(([id, value, start, end, direction]) => {
        const node = document.getElementById(id);
        if (node) {
            node.value = value;
            if (id === 'modalApiModel') node.dataset.selectedModel = value;
            if (typeof start === 'number' && node.setSelectionRange) node.setSelectionRange(start, end, direction || 'none');
            if (id === activeElementId) node.focus();
        }
    });

    this.attachEventListeners();
    this.observeSeonLayout();
    if (this.modalMode && this.modalData) {
        const overlay = document.getElementById("modalOverlay");
        if (overlay) { overlay.classList.add("active"); overlay.style.display = "flex"; }
        if (this.modalMode === "apiKey" && typeof HAEMA_API_KEY_MODAL !== "undefined") {
            HAEMA_API_KEY_MODAL.bindEvents();
        }
        this.bindFormModalKeyboard(overlay);
        if (this.modalMode === 'introduction' && typeof HAEMA_INTRODUCTION_MODAL !== 'undefined') {
            HAEMA_INTRODUCTION_MODAL.bind(this);
        }
    }
    // 재렌더 후에도 카드 버튼과 열린 폼 안의 키보드 위치를 유지한다.
    if (!document.querySelector('dialog[open]')) {
        const focusTarget = this.findFocusTarget(activeFocus);
        const overlay = document.getElementById('modalOverlay');
        if (this.modalMode && overlay) {
            if (focusTarget && overlay.contains(focusTarget)) focusTarget.focus({ preventScroll: true });
            else this.focusFormModal(overlay);
        } else if (focusTarget) {
            focusTarget.focus({ preventScroll: true });
        }
    }
};

HAEMA_CONSOLE.getStatusEmojis = function() {
    return this.status === "working" ? "💛💚💛" : this.status === "error" ? "💔💔💔" :
        this.statusText === "대화를 보냈어요" ? "🩷❤️🩷" : "💚💚💚";
};

HAEMA_CONSOLE.renderHeader = function() {
    const statusClass = "status-" + this.status;
    const emojis = this.getStatusEmojis();

    // API 키 설정 상태 확인
    const apiProvider = localStorage.getItem("haema_api_provider") || "";
    const apiModel = localStorage.getItem("haema_api_model") || "";
    const hasApiKey = this.apiConfigured;

    let apiBtnHtml = "";
    if (hasApiKey && apiProvider) {
        const providerEmoji = apiProvider === "openai" ? "🟢" :
                              apiProvider === "anthropic" ? "🟣" :
                              apiProvider === "google" ? "🔵" :
                              apiProvider === "grok" ? "⚡" :
                              apiProvider === "deepseek" ? "🔶" : "🔑";
        apiBtnHtml = '<button class="btn btn-icon btn-api-status" id="apiKeyBtn" title="API 키 설정">' +
            providerEmoji + ' ' + this.escapeHtml(apiProvider) +
            (apiModel ? ' · ' + this.escapeHtml(apiModel) : '') +
            ' 🔑</button>';
    } else if (apiProvider) {
        apiBtnHtml = '<button class="btn btn-icon btn-api-status" id="apiKeyBtn" title="API 키 설정">' +
            '🔑 ' + this.escapeHtml(apiProvider) + ' (키 미설정)</button>';
    } else {
        apiBtnHtml = '<button class="btn btn-icon" id="apiKeyBtn" title="API 키 설정">🔑: 없음</button>';
    }

    const storagePath = localStorage.getItem("haema_storage_path") || "";
    const storageBtnHtml = '<button class="btn btn-icon" id="storageBtn" title="저장 폴더 연결">🪣 : ' + (this.storageConnected ? "연결✅" : "없음") + '</button>';

    return [
        '<header class="header ' + statusClass + '">',
        '<div class="header-left haema-brand">',
        '<div class="haema-brand-logo-wrap"><img class="haema-brand-logo" src="Resources/haema-design/haema-header-logo.svg" width="177" height="174" alt=""></div>',
        '<div class="haema-brand-copy"><h1 class="haema-brand-title">해마.ai</h1><p class="haema-brand-tagline">     당신의 기억을 보존하고,&#10;    필요한 순간 다시 연결합니다.&#10;&#10;   인공지능의 인공 해마.&#10;당신을 기억하게 하세요.</p></div>',
        '</div>',
        '<div class="header-right">',
        '<a class="repo-link" href="https://github.com/SherrySherry-1230/HaemaAI_SherrySherry" target="_blank" rel="noreferrer">GitHub 저장소</a>',
        '<div class="status-bar"><img class="status-art" src="Resources/haema-design/button-raster-4x/17-haema-status-pill.png" width="161.83" height="26" alt=""><span class="status-emojis">' + emojis + '</span><span class="status-text">' + this.escapeHtml(this.statusText) + '</span></div>',
        '</div>',
        '</header>',
    ].join("");
};

HAEMA_CONSOLE.renderMainContainer = function() {
    return '<main class="main-container"><nav class="mobile-tabs" aria-label="콘솔 화면 선택">' +
        '<button class="mobile-tab" type="button" data-mobile-panel="chat" aria-selected="' + (this.activeMobilePanel === 'chat') + '">대화</button>' +
        '<button class="mobile-tab" type="button" data-mobile-panel="haema" aria-selected="' + (this.activeMobilePanel === 'haema') + '">해마</button></nav>' +
        '<div class="console-panels" data-mobile-panel="' + this.activeMobilePanel + '">' + this.renderLeftPanel() + this.renderRightPanel() + '</div></main>';
};

HAEMA_CONSOLE.renderRightPanel = function() {
    return '<section class="panel panel-right" aria-label="해마 기억 목록"><div class="right-panel-art" aria-hidden="true"><span class="panel-art-slices"></span></div>' + this.renderTransmissionStatus() + '<div class="panel-heading">' +
        '<div><h1 class="panel-title">해마의 기억</h1><div class="panel-caption">저장된 쩜과 연결을 확인해요</div></div>' +
        '<div class="jjum-list-tools"><span class="jjum-list-count" title="최근 저장순">모든 쩜 ' + (this.allJJums || []).length + '</span><div class="create-btn-wrapper"><button class="btn btn-create" id="createJJumBtn">+ 새 쩜(JJum) 만들기</button></div></div>' +
        '</div><div class="panel-viewport haema-panel-viewport"><div class="haema-panel-scroll" data-scroll-key="haema-panel">' +
        '<div class="haema-scroll" data-scroll-key="haema">' + this.renderHostPreview() + this.renderJJumListSection() + '</div></div></div></section>';
};

HAEMA_CONSOLE.getHostPickerChoices = function() {
    return [{ id: '', name: '해마.ai만 사용' }, ...globalThis.HAEMA_TEST_HOST.hosts];
};

HAEMA_CONSOLE.renderHostSelector = function() {
    const choices = this.getHostPickerChoices();
    const selected = choices.find(choice => choice.id === this.selectedTestHost) || choices[0];
    if (!choices.some(choice => choice.id === this.hostPickerActiveId)) this.hostPickerActiveId = selected.id;
    const activeIndex = choices.findIndex(choice => choice.id === this.hostPickerActiveId);
    return '<div class="host-picker" id="hostPicker" data-open="' + this.hostPickerOpen + '">' +
        '<select class="host-picker-native" id="testHostSelect" aria-label="호스트 선택" tabindex="-1" hidden>' +
        choices.map(choice => '<option value="' + this.escapeHtml(choice.id) + '"' +
            (selected.id === choice.id ? ' selected' : '') + '>' + this.escapeHtml(choice.name) + '</option>').join('') + '</select>' +
        '<button class="host-picker-trigger" id="hostPickerTrigger" type="button" aria-haspopup="listbox" aria-controls="hostPickerOptions" aria-expanded="' +
        this.hostPickerOpen + '" aria-label="호스트 선택: ' + this.escapeHtml(selected.name) + '"><span class="host-picker-trigger-label">' + this.escapeHtml(selected.name) + '</span></button>' +
        '<div class="host-picker-popup" id="hostPickerPopup"' + (this.hostPickerOpen ? '' : ' hidden') + '>' +
        '<div class="host-picker-popup-heading"><button class="host-picker-close" id="hostPickerClose" type="button" aria-label="호스트 선택 닫기"><span class="host-picker-close-arrow" aria-hidden="true"></span></button></div>' +
        '<div class="host-picker-options" id="hostPickerOptions" role="listbox" tabindex="-1" aria-label="호스트 선택" aria-activedescendant="hostPickerOption-' + activeIndex + '" data-scroll-key="host-picker-options">' +
        choices.map((choice, index) => '<div class="host-picker-option' + (choice.id === this.hostPickerActiveId ? ' is-active' : '') +
            '" id="hostPickerOption-' + index + '" role="option" aria-selected="' + (choice.id === selected.id) +
            '" data-host-id="' + this.escapeHtml(choice.id) + '"><span>' + this.escapeHtml(choice.name) + '</span></div>').join('') +
        '</div></div></div>';
};

HAEMA_CONSOLE.positionHostPicker = function() {
    if (!this.hostPickerOpen) return;
    const picker = document.getElementById('hostPicker');
    const popup = document.getElementById('hostPickerPopup');
    if (!picker || !popup) return;
    const bounds = picker.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const bottom = top + (viewport?.height || window.innerHeight);
    const below = bottom - bounds.bottom;
    const above = bounds.top - top;
    const opensAbove = below < 212 && above > below;
    picker.dataset.placement = opensAbove ? 'above' : 'below';
    popup.style.maxHeight = Math.max(0, (opensAbove ? above : below) - 8) + 'px';
    popup.style.transform = '';
    const popupBounds = popup.getBoundingClientRect();
    const left = (viewport?.offsetLeft || 0) + 8;
    const right = (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth) - 8;
    const shift = popupBounds.left < left ? left - popupBounds.left :
        popupBounds.right > right ? right - popupBounds.right : 0;
    popup.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
};

HAEMA_CONSOLE.updateHostPickerView = function(scrollActive = false) {
    const picker = document.getElementById('hostPicker');
    const popup = document.getElementById('hostPickerPopup');
    const trigger = document.getElementById('hostPickerTrigger');
    const list = document.getElementById('hostPickerOptions');
    if (!picker || !popup || !trigger || !list) return;
    picker.dataset.open = String(this.hostPickerOpen);
    popup.hidden = !this.hostPickerOpen;
    trigger.setAttribute('aria-expanded', String(this.hostPickerOpen));
    let active;
    picker.querySelectorAll('[data-host-id]').forEach(option => {
        const isActive = option.dataset.hostId === this.hostPickerActiveId;
        option.classList.toggle('is-active', isActive);
        option.setAttribute('aria-selected', String(option.dataset.hostId === this.selectedTestHost));
        if (isActive) active = option;
    });
    if (active) list.setAttribute('aria-activedescendant', active.id);
    this.positionHostPicker();
    if (this.hostPickerOpen && scrollActive && active) {
        const itemBounds = active.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        if (itemBounds.top < listBounds.top) list.scrollTop -= listBounds.top - itemBounds.top;
        else if (itemBounds.bottom > listBounds.bottom) list.scrollTop += itemBounds.bottom - listBounds.bottom;
    }
};

HAEMA_CONSOLE.setHostPickerOpen = function(open, focus = true) {
    this.hostPickerOpen = !!open;
    if (this.hostPickerOpen) this.hostPickerActiveId = this.selectedTestHost;
    this.updateHostPickerView(this.hostPickerOpen);
    if (focus) document.getElementById(this.hostPickerOpen ? 'hostPickerOptions' : 'hostPickerTrigger')?.focus({ preventScroll: true });
};

HAEMA_CONSOLE.chooseHostPickerOption = function(value) {
    if (!this.getHostPickerChoices().some(choice => choice.id === value)) return;
    const select = document.getElementById('testHostSelect');
    if (!select) return;
    const unchanged = value === this.selectedTestHost;
    this.setHostPickerOpen(false, false);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (unchanged && !this.isComposing) document.getElementById('hostPickerTrigger')?.focus({ preventScroll: true });
};

HAEMA_CONSOLE.handleHostPickerKeydown = function(event) {
    if (event.isComposing || event.keyCode === 229) return;
    const choices = this.getHostPickerChoices();
    if (event.key === 'Escape' && this.hostPickerOpen) {
        event.preventDefault(); event.stopPropagation(); this.setHostPickerOpen(false); return;
    }
    if (event.key === 'Tab') {
        if (this.hostPickerOpen) this.setHostPickerOpen(false, false);
        return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (event.currentTarget.id === 'hostPickerTrigger') this.setHostPickerOpen(!this.hostPickerOpen);
        else this.chooseHostPickerOption(this.hostPickerActiveId);
        return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const wasOpen = this.hostPickerOpen;
    if (!wasOpen) this.setHostPickerOpen(true);
    let index = choices.findIndex(choice => choice.id === this.hostPickerActiveId);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = choices.length - 1;
    else if (wasOpen) index = (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
    this.hostPickerActiveId = choices[Math.max(0, index)].id;
    this.updateHostPickerView(true);
};

HAEMA_CONSOLE.bindHostPicker = function() {
    const picker = document.getElementById('hostPicker');
    if (!picker) return;
    if (!this.boundHostPickers.has(picker)) {
        this.boundHostPickers.add(picker);
        document.getElementById('hostPickerTrigger')?.addEventListener('click', () => this.setHostPickerOpen(!this.hostPickerOpen));
        document.getElementById('hostPickerTrigger')?.addEventListener('keydown', event => this.handleHostPickerKeydown(event));
        document.getElementById('hostPickerClose')?.addEventListener('click', () => this.setHostPickerOpen(false));
        document.getElementById('hostPickerClose')?.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); this.setHostPickerOpen(false); }
        });
        const list = document.getElementById('hostPickerOptions');
        list?.addEventListener('keydown', event => this.handleHostPickerKeydown(event));
        list?.addEventListener('click', event => {
            const option = event.target.closest('[data-host-id]');
            if (option && list.contains(option)) this.chooseHostPickerOption(option.dataset.hostId);
        });
        list?.addEventListener('pointermove', event => {
            if (event.pointerType === 'touch') return;
            const option = event.target.closest('[data-host-id]');
            if (option && list.contains(option) && this.hostPickerActiveId !== option.dataset.hostId) {
                this.hostPickerActiveId = option.dataset.hostId;
                this.updateHostPickerView();
            }
        });
    }
    if (!this.hostPickerDocumentListeners) {
        this.hostPickerDocumentListeners = true;
        const closeOutside = event => {
            const current = document.getElementById('hostPicker');
            if (this.hostPickerOpen && current && !current.contains(event.target)) this.setHostPickerOpen(false, false);
        };
        document.addEventListener('pointerdown', closeOutside, true);
        document.addEventListener('focusin', closeOutside);
        window.addEventListener('resize', () => this.positionHostPicker());
        window.visualViewport?.addEventListener('resize', () => this.positionHostPicker());
    }
    this.updateHostPickerView();
};

HAEMA_CONSOLE.activateTestHost = function() {
    if (!this.selectedTestHost) return;
    globalThis.HAEMA_TEST_HOST.activate(this.getConversationScope(), this.selectedTestHost, () => {
        if (!this.selectedTestHost) return;
        const host = globalThis.HAEMA_TEST_HOST.state;
        const terminal = host.records?.filter(turn => turn.state !== 'pending').at(-1)?.turnId;
        if (terminal && !host.memoryRefreshing && (host.memoryRefreshId !== terminal || host.memoryNotice)) {
            host.memoryRefreshing = true;
            host.memoryRefreshId = terminal;
            this.loadLocalServerData().then(() => { host.memoryNotice = ''; }).catch(() => {
                host.memoryNotice = '대화 기록은 받았지만 기억 목록을 다시 읽지 못했어요. 대화 상태 확인으로 다시 읽을 수 있어요.';
            }).finally(() => {
                host.memoryRefreshing = false;
                if (globalThis.HAEMA_TEST_HOST.state === host && this.selectedTestHost) this.render();
            });
        }
        this.render();
    });
};

HAEMA_CONSOLE.chatEditorKey = function() {
    return this.selectedTestHost ? 'host-' + this.conversationScopeEpoch + '-' + this.selectedTestHost : 'haema';
};

HAEMA_CONSOLE.switchChatHost = function(value) {
    if (value === this.selectedTestHost) return;
    const input = document.getElementById('userInput');
    const scope = this.getConversationScope();
    const memoryKey = this.memoryDraftKey();
    let memoryDraft = this.haemaModeDraftScope === memoryKey ? this.lastInputValue : '';
    if (!this.selectedTestHost) {
        this.lastInputValue = input?.value || '';
        this.haemaModeDraftScope = memoryKey;
        if (memoryKey) try { sessionStorage.setItem(memoryKey, this.lastInputValue); } catch {}
    }
    else globalThis.HAEMA_TEST_HOST.setDraft(input?.value || '');
    if (memoryKey) try { memoryDraft = sessionStorage.getItem(memoryKey) ?? memoryDraft; } catch {}
    this.selectedTestHost = globalThis.HAEMA_TEST_HOST.hosts.some(host => host.id === value) ? value : '';
    try { sessionStorage.setItem('haema_test_host', this.selectedTestHost); } catch {}
    globalThis.HAEMA_TEST_HOST.reset();
    if (this.selectedTestHost) {
        this.incrementalController?.stop();
        this.incrementalController = null;
        this.incrementalState = null;
        clearTimeout(this.incrementalUsageTimer);
        this.incrementalUsageTimer = null;
    }
    this.activeMobilePanel = 'chat';
    if (this.selectedTestHost) this.activateTestHost();
    this.render();
    if (!this.selectedTestHost) {
        // Returning from a host preserves text typed before the memory session handshake.
        this.draftVersion += 1;
        this.lastInputValue = memoryDraft;
        this.haemaModeDraftScope = memoryKey;
        const editor = document.getElementById('userInput');
        if (editor) editor.value = memoryDraft;
        this.incrementalController?.sample(memoryDraft);
        if (memoryKey) try { sessionStorage.setItem(memoryKey, memoryDraft); } catch {}
    }
    document.getElementById('userInput')?.focus({ preventScroll: true });
};

HAEMA_CONSOLE.sendTestHostMessage = async function() {
    const input = document.getElementById('userInput');
    const host = globalThis.HAEMA_TEST_HOST;
    if (!input || this.isComposing || !this.isStorageReady() || !this.isApiKeyReady() ||
        host.state.loading || host.state.sending || !host.state.ready || !input.value.trim()) return;
    host.setDraft(input.value);
    this.pendingConversationScroll = true;
    await host.send(input.value);
};

HAEMA_CONSOLE.renderTestHostControls = function() {
    const host = globalThis.HAEMA_TEST_HOST.state;
    const name = globalThis.HAEMA_TEST_HOST.hosts.find(item => item.id === this.selectedTestHost)?.name || '';
    let controls = '<button type="button" class="conversation-retry" id="testHostReload">대화 상태 확인</button>';
    if (host.uncertain) controls += '<button type="button" class="conversation-retry" id="testHostRetry">같은 요청 다시 확인·전송</button>';
    if (this.selectedTestHost === 'schedule') {
        const labels = {
            not_configured: '연결 설정이 필요함',
            disconnected: 'Google 계정 연결 필요',
            connected: 'Google 연결 완료',
            reauth_required: 'Google 재연결 필요',
            calendar_pending: '전용 달력 확인 중',
        };
        const state = host.calendar?.state;
        const loading = host.calendarLoading === true;
        const error = typeof host.calendarError === 'string' ? host.calendarError : '';
        const confirmed = Object.prototype.hasOwnProperty.call(labels, state);
        const displayState = loading ? 'loading' : error ? 'error' : confirmed ? state : 'unknown';
        const label = loading ? 'Google 연결 상태 조회 중' : error ? 'Google 연결 상태 조회 실패' :
            confirmed ? labels[state] : 'Google 연결 상태 확인 필요';
        const busy = host.calendarBusy || loading ? ' disabled' : '';
        const canConnect = !loading && !error && (state === 'disconnected' || state === 'reauth_required');
        const canDisconnect = !loading && !error && state === 'connected';
        controls += '<span role="status" data-calendar-state="' + displayState + '">' + label + '</span>' +
            (canConnect ? '<button type="button" class="conversation-retry" id="calendarConnect"' + busy + '>' +
                (state === 'reauth_required' ? 'Google 재연결' : 'Google 계정 연결') + '</button>' : '') +
            '<button type="button" class="conversation-retry" id="calendarStatus"' + busy + '>' +
                (loading ? '조회 중…' : '연결 상태 확인') + '</button>' +
            (canDisconnect ? '<button type="button" class="conversation-retry" id="calendarDisconnect"' + busy + '>연결 해제</button>' : '') +
            (error ? '<span role="alert">' + this.escapeHtml(error) + '</span>' : '') +
            (host.calendarNotice ? '<span role="status">' + this.escapeHtml(host.calendarNotice) + '</span>' : '');
    }
    return '<div class="test-host-controls"><strong>' + this.escapeHtml(name) + '</strong>' + controls + '</div>';
};

HAEMA_CONSOLE.renderTestHostHistory = function() {
    const host = globalThis.HAEMA_TEST_HOST.state;
    const turns = host.pending && !host.records?.some(turn => turn.turnId === host.pending.turnId)
        ? [...host.turns, { role: 'user', content: host.pending.text }] : host.turns;
    return turns.map(turn => {
        if (turn.role === 'status') return '<p class="message-meta" role="status">' + this.escapeHtml(turn.content) + '</p>';
        const user = turn.role === 'user';
        return '<div class="message-row ' + (user ? 'user' : 'test-host-reply') + '" role="group" aria-label="' +
            (user ? '사용자' : '호스트') + '" data-test-host-role="' + (user ? 'user' : 'assistant') +
            '"><div class="message-stack"><div class="message-bubble">' + this.escapeHtml(turn.content) + '</div></div></div>';
    }).join('') + (host.status ? '<p class="message-meta" role="status">' + this.escapeHtml(host.status) + '</p>' : '') +
        (host.memoryNotice ? '<p class="message-meta" role="status">' + this.escapeHtml(host.memoryNotice) + '</p>' : '');
};

HAEMA_CONSOLE.renderTransmissionStatus = function() {
    let label = this.statusText;
    let status = this.status;
    let detail;
    let emojis = this.getStatusEmojis();
    if (this.selectedTestHost) {
        const host = globalThis.HAEMA_TEST_HOST.state;
        const failed = host.records?.at(-1)?.state === 'failed';
        status = host.uncertain || failed || (!host.sending && !!host.status && !host.loading) ? 'error' :
            host.loading || host.sending ? 'working' : 'resting';
        label = host.loading ? '대화 불러오는 중' : host.uncertain ? '전송 확인 필요' : host.sending ? '응답 확인 중' :
            failed ? '처리 확인 필요' : status === 'error' ? '연결 확인 필요' : host.ready ? '호스트 연결' : '연결 준비 필요';
        detail = host.status || label;
        emojis = status === 'error' ? '💔💔💔' : status === 'working' ? '💛💚💛' : '💚💚💚';
    }
    if (label === '대화를 보내고 있어요') label = '전송 중';
    else if (label === '대화를 보냈어요') label = '전송 완료';
    else if (label === '대화는 보냈지만 결과를 표시하지 못했어요. 기억 목록을 다시 확인해 주세요.') label = '전송 완료 · 확인 필요';
    detail = detail || (label === this.statusText ? label : label + ' · ' + this.statusText);
    return '<div class="top-state-area" data-figma-frame="top_State_Area">' + this.renderHostSelector() +
        '<div class="haema-status-pill status-' + status + '" role="status" aria-live="polite" aria-atomic="true" aria-label="' + this.escapeHtml(detail) + '" title="' + this.escapeHtml(detail) + '">' +
        '<span class="status-emojis" aria-hidden="true">' + emojis + '</span><span class="status-text">' + this.escapeHtml(label) + '</span></div></div>';
};

HAEMA_CONSOLE.getTopicName = function(topic) {
    if (typeof topic === 'string') return topic;
    return topic?.jjum?.jjumName || topic?.jjumName || topic?.name || topic?.topic || '';
};

HAEMA_CONSOLE.getResultSelectionKey = function(result) {
    if (!this.resultSelectionKeys.has(result)) this.resultSelectionKeys.set(result, 'result-' + (++this.nextResultSelectionKey));
    return this.resultSelectionKeys.get(result);
};

HAEMA_CONSOLE.getResultTone = function(result) {
    return result ? (Number(this.getResultSelectionKey(result).slice(7)) - 1) % 4 : 0;
};

HAEMA_CONSOLE.getResultTime = function(result) {
    const at = result?.at;
    const date = at == null || at === '' ? null : new Date(at);
    return date && Number.isFinite(date.getTime()) ? {
        text: date.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
        iso: date.toISOString()
    } : { text: '시각 미제공', iso: '' };
};

HAEMA_CONSOLE.getLatestHistoryResult = function() {
    const latest = this.latestResult;
    if (!latest) return null;
    const scope = this.getConversationScope();
    const history = this.conversationHistory.filter(item => item.type === 'result' &&
        (!item.scope || HAEMA_CONVERSATION_SESSION.sameScope(item.scope, scope)));
    if (history.includes(latest)) return latest;
    const hasIdentity = [latest.conversationId, latest.utteranceId].every(value => typeof value === 'string' && value.trim().length > 0);
    if (!hasIdentity) return latest;
    return history.reverse().find(item =>
        item.conversationId === latest.conversationId && item.utteranceId === latest.utteranceId && item.at === latest.at) || latest;
};

HAEMA_CONSOLE.getPreviewResult = function() {
    const selected = this.selectedHistoryResult;
    if (selected) {
        const sameScope = !selected.scope || HAEMA_CONVERSATION_SESSION.sameScope(selected.scope, this.getConversationScope());
        const newerResult = this.latestResult && this.latestResult !== this.selectedResultAnchor;
        if (sameScope && !newerResult && this.conversationHistory.includes(selected)) return selected;
        this.selectedHistoryResult = null;
        this.selectedResultAnchor = null;
    }
    return this.previewState === 'success' ? this.getLatestHistoryResult() : null;
};

HAEMA_CONSOLE.selectHistoryResult = function(key) {
    const scope = this.getConversationScope();
    const result = this.conversationHistory.find(item => item.type === 'result' && this.getResultSelectionKey(item) === key &&
        (!item.scope || HAEMA_CONVERSATION_SESSION.sameScope(item.scope, scope)));
    if (!result) return;
    this.selectedHistoryResult = result;
    this.selectedResultAnchor = this.latestResult;
    this.activeMobilePanel = 'haema';
    this.render();
    const scroll = document.querySelector('.haema-scroll');
    if (scroll) scroll.scrollTop = 0;
    if (window.matchMedia('(max-width: 820px)').matches) document.getElementById('haemaPreviewHeading')?.focus({ preventScroll: true });
};

HAEMA_CONSOLE.renderPreviewUsage = function(meter) {
    if (!meter) return '';
    // Reposition the existing meter's rendered content without recalculating usage.
    const template = document.createElement('template');
    template.innerHTML = meter;
    const section = template.content.querySelector('.token-meter');
    if (!section) return meter;
    const details = document.createElement('details');
    details.className = 'haema-preview-usage-details';
    details.id = 'previewUsageDetails';
    details.open = this.previewUsageDetailsOpen;
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', '토큰 사용량 상세');
    summary.title = '토큰 사용량 상세';
    summary.textContent = 'ⓘ';
    const content = document.createElement('div');
    content.className = 'haema-preview-usage-details-content';
    content.tabIndex = 0;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-label', '토큰 사용량 상세 내역');
    content.dataset.scrollKey = 'preview-usage-details';
    for (const child of [...section.childNodes]) {
        if (child.nodeType === 1 && (child.classList.contains('token-meter-heading') || child.classList.contains('token-meter-track'))) continue;
        content.appendChild(child);
    }
    details.append(summary, content);
    section.appendChild(details);
    return '<div class="haema-preview-live-usage">' + section.outerHTML + '</div>';
};

HAEMA_CONSOLE.renderHostPreview = function() {
    const host = this.selectedTestHost ? globalThis.HAEMA_TEST_HOST.state : null;
    const result = host ? null : this.getPreviewResult();
    const selected = this.selectedHistoryResult === result && !!result;
    const state = host ? 'host' : result ? 'success' : this.previewState;
    const resultKey = result ? [result.conversationId || '', result.utteranceId || '', result.at ?? ''].join(':') : '';
    if (!this.previewGuideState || this.previewGuideState.result !== result || this.previewGuideState.key !== resultKey) {
        this.previewGuideState = { result, key: resultKey, scrollTop: 0 };
    }
    const activeRecallKeys = new Set();
    let body = '<p class="haema-preview-summary">대화를 보내면 호스트에게 전달할 기억을 확인할 수 있어요.</p>';
    if (host) {
        const latest = host.records?.at(-1);
        const text = host.status || (latest?.memory?.status === 'saved' ? '선택한 호스트와 나눈 대화를 기억에 반영했어요.' :
            latest?.memory?.status === 'partial' ? '대화의 기억 처리 중 일부를 확인해야 해요.' :
            latest?.state === 'complete' ? '호스트 답변을 받았어요. 아래에서 저장된 기억을 확인할 수 있어요.' :
            '선택한 호스트와 대화하면 기억 처리 상태를 확인할 수 있어요.');
        body = '<p class="haema-preview-summary">' + this.escapeHtml(text) + '</p>';
    } else if (state === 'loading') {
        body = '<p class="haema-preview-summary">이번 대화의 기억을 확인하고 있어요.</p>';
    } else if (state === 'incremental') {
        const local = this.incrementalState;
        const session = local?.session;
        const target = local?.draft || local?.entries?.at(-1)?.input || session?.draft || session?.submissions?.at(-1);
        const matches = target && session?.recallScores?.inputId === target.inputId && session.recallScores.revision === target.revision;
        const recall = matches ? session.recallScores.status : 'uncomputed';
        const recallLabel = { uncomputed: '미계산', pending: '탐색 중', ready: '잠정 탐색 완료', error: '탐색 확인 필요' }[recall] || '결과 대기';
        body = '<p class="haema-preview-summary">현재 입력의 회상 점수 <strong>—</strong> · ' + recallLabel + '</p>' +
            '<p class="haema-preview-summary">회상 전달 대기 · 호스트 답변은 실행하지 않았어요.</p>';
        const candidates = matches ? (session?.candidates || []).filter(candidate => candidate.inputId === target.inputId && candidate.revision === target.revision && candidate.generation === session.analysisGeneration) : [];
        if (candidates.length) body += '<p class="haema-preview-topics">입력 중 임시 후보 ' + candidates.length + '개 · 저장된 쩜과 구분해 보관 중</p>';
        const remoteInput = session?.draft || session?.submissions?.at(-1);
        const contextCurrent = target && remoteInput?.inputId === target.inputId && remoteInput.revision === target.revision;
        const readiness = contextCurrent && { wait: '이야기 이어 듣기', ready: '답변 가능 권고', uncertain: '판단 대기' }[session?.responseReadiness?.status];
        if (readiness) body += '<p class="haema-preview-topics">' + readiness + ' · 잠정 권고</p>';
    } else if (state === 'result-error') {
        body = '<p class="haema-preview-summary">대화는 보냈지만 결과를 표시하지 못했어요. 기억 목록을 다시 확인해 주세요.</p>';
    } else if (state === 'error') {
        body = '<p class="haema-preview-summary">이번 요청을 완료하지 못했어요. 연결 상태를 확인하고 다시 보내주세요.</p>';
    } else if (result) {
        const candidates = result.candidates || [];
        const topics = (result.topics || []).map(topic => this.getTopicName(topic)).filter(Boolean);
        const newCount = (result.newJJums || []).length;
        body = '<p class="haema-preview-summary">' + (candidates.length ? '회상된 쩜 ' + candidates.length + '개' : '이번 대화에서 회상된 쩜이 없어요.') + (newCount ? ' · 새 쩜 ' + newCount + '개' : '') + '</p>';
        if (candidates.length) {
            const shapes = ['01', '02', '04', '10', '12', '23', '32'];
            body += '<div class="haema-preview-chips" id="previewRecallTitles" tabindex="0" aria-label="회상된 쩜 제목" data-scroll-key="preview-titles:' + this.escapeHtml(resultKey) + '">' + candidates.map((candidate, index) => {
                const name = candidate.name || candidate.jjumName || '이름 없는 쩜';
                const key = candidate.jjumId ? 'id:' + candidate.jjumId : 'fallback:' + index + ':' + name;
                activeRecallKeys.add(key);
                const previous = this.recallShapeHistory.get(key);
                const available = shapes.filter(shape => shape !== previous);
                const shape = available[Math.floor(Math.random() * available.length)];
                this.recallShapeHistory.set(key, shape);
                return '<span class="haema-preview-chip" data-recall-shape="' + shape + '" style="--recall-shape:url(Resources/haema-design/irregular/shape-' + shape + '.svg)"><span class="haema-preview-chip-label">' + this.escapeHtml(name) + '</span></span>';
            }).join('') + '</div>';
        }
        if (topics.length) {
            body += '<p class="haema-preview-topics">주제 · ' + topics.slice(0, 2).map(topic => this.escapeHtml(topic)).join(' · ') + (topics.length > 2 ? ' 외 ' + (topics.length - 2) + '개' : '') + '</p>';
        }
    }
    for (const key of this.recallShapeHistory.keys()) {
        if (!activeRecallKeys.has(key)) this.recallShapeHistory.delete(key);
    }
    const meter = typeof HAEMA_TOKEN_METER !== 'undefined' ? HAEMA_TOKEN_METER.render(this.readTokenUsage(), host ? host.sending : this.previewState === 'loading', this.readIntroductionTokenUsage()) : '';
    const liveUsage = this.renderPreviewUsage(meter);
    const time = this.getResultTime(result);
    const selectionHtml = result ? '<div class="haema-preview-selection"><span class="haema-preview-selection-label">' + (selected ? '선택한 회상 결과' : '최근 회상 결과') + '</span>' +
        '<time class="haema-preview-time"' + (time.iso ? ' datetime="' + this.escapeHtml(time.iso) + '"' : '') + '>' + this.escapeHtml(time.text) + '</time>' +
        (selected ? '<button class="haema-preview-latest" id="previewLatestBtn" type="button">최신 상태로 돌아가기</button>' : '') + '</div>' : '';
    const guide = result?.guide;
    const hasGuide = typeof guide === 'string' ? !!guide.trim() : Array.isArray(guide) ? guide.some(item => typeof item === 'string' && item.trim()) : !!guide && typeof guide === 'object';
    let guideHtml = '';
    if (hasGuide) {
        guideHtml = '<section class="haema-preview-guide"><h2 class="haema-preview-guide-title">호스트 응답 가이드</h2><div class="response-guide-content">' + this.renderResponseGuide(guide) + '</div></section>';
    } else {
        const notice = host ? '기억 사용은 선택한 호스트의 권한을 따릅니다.' : state === 'incremental' ? '연속 입력의 응답 가이드는 아직 전달되지 않았어요.' :
            result ? '이번 결과에는 응답 가이드가 없어요.' : state === 'loading' ? '응답 가이드를 기다리고 있어요.' : '표시할 응답 가이드가 아직 없어요.';
        guideHtml = '<p class="haema-preview-guide-empty">' + notice + '</p>';
    }
    return '<div class="haema-preview-group' + (result ? ' is-selected' : '') + (selected ? ' is-history-selected' : '') + '" data-result-tone="' + this.getResultTone(result) + '"><div class="haema-preview' + (meter ? ' has-token-meter' : '') + '" data-preview-state="' + state + '" data-live-preview-state="' + this.previewState + '"><span class="haema-preview-background" aria-hidden="true"></span>' +
        '<span class="haema-preview-avatar" aria-hidden="true"><img src="Resources/haema-design/haema-preview-character.png" width="244" height="441" alt=""></span>' +
        '<div class="haema-preview-content"><div class="haema-preview-heading"><strong class="haema-preview-title" id="haemaPreviewHeading" tabindex="-1">호스트에게 전달할 기억</strong></div>' +
        '<div class="haema-preview-guide-content" id="previewGuideContent" role="region" aria-label="선택한 쩜과 호스트 응답 가이드" tabindex="0" data-scroll-key="preview-guide:' + this.escapeHtml(resultKey) + '">' + selectionHtml + '<div class="haema-preview-body">' + body + guideHtml + '</div></div>' +
        '<div class="haema-preview-controls">' + liveUsage + '</div></div></div></div>';
};

HAEMA_CONSOLE.openLatestResult = function() {
    this.selectedHistoryResult = null;
    this.selectedResultAnchor = null;
    this.activeMobilePanel = 'haema';
    this.render();
    const scroll = document.querySelector('.haema-scroll');
    if (scroll) scroll.scrollTop = 0;
    document.getElementById('haemaPreviewHeading')?.focus({ preventScroll: true });
};

// @editedBy YAONG1230 2026-10-16: Figma 52:547 / 25:46 / 49:526, 내부 스크롤
// Display only: preserve the stored raw value and distinguish missing values from zero.
HAEMA_CONSOLE.seonDisplay = function(weight) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
        return { state: 'unknown', level: null, label: '연결 강도 확인 전' };
    }
    if (weight < 1) return { state: 'inactive', level: null, label: '활성 연결 없음' };
    const level = Math.min(7, Math.floor(weight));
    return { state: 'known', level, label: '연결 강도 ' + level + '단계' };
};

HAEMA_CONSOLE.renderJJumListSection = function() {
    const jjums = this.allJJums || [];
    const visibleIds = new Set(jjums.map(jjum => jjum.jjumId));
    for (const id of this.cardShapeHistory.keys()) {
        if (!visibleIds.has(id)) this.cardShapeHistory.delete(id);
    }
    const workingOrder = { new: 0, strong: 1, related: 2, candidate: 3 };
    const sortedJJums = jjums.slice().sort((a, b) => {
        if (this.status === 'working') {
            const aOrder = workingOrder[String(a.displayStatus || a.visualStatus || '').toLowerCase()] ?? 4;
            const bOrder = workingOrder[String(b.displayStatus || b.visualStatus || '').toLowerCase()] ?? 4;
            if (aOrder !== bOrder) return aOrder - bOrder;
        }
        return new Date(b.firstSeen) - new Date(a.firstSeen);
    });
    if (!sortedJJums.length) {
        return '<div class="jjum-list-section"><div class="empty-state"><img class="empty-haema" src="Resources/haema-design/crying-haema.png" alt="우는 해마"><div class="empty-text">쩜이 없어요</div></div></div>';
    }
    const escape = value => this.escapeHtml(String(value ?? ''));
    const states = {
        new: '새 쩜', candidate: '후보', related: '관련', strong: '강추천',
        'sent-strong': '강추천 전송 완료', 'sent-related': '관련 전송 완료', 'sent-candidate': '후보 전송 완료'
    };
    const accordionHtml = sortedJJums.map((jjum, index) => {
        const id = String(jjum.jjumId);
        const isExpanded = String(this.selectedJJumId || '') === id;
        const displayState = String(jjum.displayStatus || jjum.visualStatus || '').toLowerCase();
        const state = Object.hasOwn(states, displayState) ? displayState : 'general';
        const lightParts = state === 'strong' || state === 'related';
        const parts = lightParts
            ? ['05-score-circle.svg', '03-jjum-name-pill.svg', '06-alias-pill.svg', '02-card-ellipsis.svg', '07-card-summary-background.svg']
            : ['26-score-circle-alt.svg', '27-jjum-name-pill-alt.svg', '28-alias-pill-alt.svg', '29-card-ellipsis-alt.svg', '30-card-summary-a.svg'];
        // 접힘·펼침 각각 8종. 상태가 바뀌어도 바로 직전 윤곽 번호는 반복하지 않는다.
        const previous = this.cardShapeHistory.get(jjum.jjumId);
        const choices = Array.from({ length: 8 }, (_, i) => i + 1).filter(shape => shape !== previous);
        const shape = choices[Math.floor(Math.random() * choices.length)];
        this.cardShapeHistory.set(jjum.jjumId, shape);
        const shapeAsset = (isExpanded ? 'expanded-' : 'collapsed-') + String(shape).padStart(2, '0') + '.svg';
        // 이름은 서버가 표시를 허용해 반환한 값 그대로 사용한다. 파일명을 대신 쓰거나 가려진 원문을 추측하지 않는다.
        const name = String(jjum.jjumName || jjum.name || '이름 없는 쩜');
        const aliases = Array.isArray(jjum.aliases) ? jjum.aliases : [];
        const tags = Array.isArray(jjum.jjtags) ? jjum.jjtags : Array.isArray(jjum.tags) ? jjum.tags : [];
        const metadata = [
            ...aliases.map(alias => ({ label: '별명', text: alias })),
            ...(jjum.type ? [{ label: '유형', text: jjum.type }] : []),
            ...tags.map(tag => ({ label: '태그', text: tag }))
        ];
        const chip = item => '<span class="jjum-chip is-' + ({ '별명': 'alias', '유형': 'type', '태그': 'tag' })[item.label] + '" style="--chip-outline:url(\'Resources/haema-design/' + parts[2] + '\')"><span class="sr-only">' + item.label + ': </span><span>' + escape(item.text) + '</span></span>';
        const metadataHtml = metadata.map(chip).join('');
        const nameHtml = '<span class="jjum-name" style="--name-shape:url(\'Resources/haema-design/' + parts[1] + '\')"><span>' + escape(name) + '</span></span>';
        const scoreHtml = '<span class="score-slot"><img src="Resources/haema-design/' + parts[0] + '" width="32" height="32" alt=""><span aria-label="' + (state === 'new' ? '새 쩜' : '회상 점수 미제공') + '">' + (state === 'new' ? 'New' : '—') + '</span></span>';
        const ellipsisHtml = !isExpanded && metadata.length
            ? '<span class="jjum-menu" aria-hidden="true"><img src="Resources/haema-design/' + parts[3] + '" width="38.2605" height="22.9574" alt=""><span>...</span></span>' : '';
        const summary = escape(jjum.summary || '요약 없음');
        const summaryHtml = '<span class="jjum-summary" style="--summary-outline:url(\'Resources/haema-design/' + parts[4] + '\')"><span>' + summary + '</span></span>';
        const facts = (Array.isArray(jjum.facts) ? jjum.facts : []).map(fact => '<p class="detail-text">' + escape(fact.text) + '</p>').join('');
        const events = (Array.isArray(jjum.events) ? jjum.events : []).map(event => {
            const timestamp = typeof event.date === 'number' ? new Date(event.date) : null;
            const dateLabel = timestamp && Number.isFinite(timestamp.getTime())
                ? timestamp.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : event.date;
            const references = (Array.isArray(event.refJJumIds) ? event.refJJumIds : [])
                .map(targetId => jjums.find(item => item.jjumId === targetId)?.jjumName || '목록 밖의 쩜');
            return '<p class="detail-text">' + (dateLabel != null && dateLabel !== '' ? '<span class="jjum-event-date">' + escape(dateLabel) + '</span> ' : '') + escape(event.summary) +
                (references.length ? '<span class="jjum-event-references">함께한 쩜: ' + references.map(escape).join(' · ') + '</span>' : '') + '</p>';
        }).join('');
        const seons = (Array.isArray(jjum.seons) ? jjum.seons : []).filter(relation => relation && typeof relation === 'object').map(relation => {
            const target = jjums.find(item => item.jjumId === relation.targetId);
            const display = this.seonDisplay(relation.weight);
            return '<div class="seon-item"><span class="seon-target">' + escape(target?.jjumName || '목록 밖의 쩜') + '</span><span class="seon-label">' + escape(relation.label || '연결') + '</span>' +
                '<span class="seon-strength">' + escape(display.label) + '</span></div>';
        }).join('');
        const regionKey = Array.from(id, char => char.codePointAt(0).toString(16)).join('-');
        const detailsId = 'jjum-content-' + regionKey;
        const detailsHtml = isExpanded ? '<div class="jjum-card-content"><div class="jjum-content-scroll" id="' + detailsId + '" tabindex="0" role="region" aria-label="' + escape(name) + ' 내용" data-scroll-key="jjum-body:' + escape(id) + '"><div class="jjum-content-summary">' + summary + '</div>' +
            (facts ? '<section class="detail-section"><h3 class="detail-label">사실</h3>' + facts + '</section>' : '') +
            (events ? '<section class="detail-section"><h3 class="detail-label">사건</h3>' + events + '</section>' : '') +
            (seons ? '<section class="detail-section"><h3 class="detail-label">쩜선 연결</h3><div class="seons-list">' + seons + '</div></section>' : '') +
            '<div class="jjum-meta">' + (states[state] ? escape(states[state]) + ' · ' : '') + escape(this.formatDate(jjum.firstSeen)) + (jjum.pinned ? ' · 고정' : '') + '</div>' +
            '<div class="card-actions"><button class="card-action" type="button" data-action="edit">수정</button><button class="card-action" type="button" data-action="hide">목록에서 숨기기</button></div></div></div>' : '';
        return '<article class="jjum-card state-' + state + (lightParts ? ' has-light-card-parts' : '') + (isExpanded ? ' is-expanded' : '') + '" data-jjum-id="' + escape(id) + '">' +
            '<span class="jjum-card-art" data-card-shape="' + shapeAsset + '" style="--card-shape:url(\'Resources/haema-design/jjum-display/' + shapeAsset + '\')" aria-hidden="true"></span>' +
            '<div class="jjum-card-scroll"' + (isExpanded ? ' tabindex="0" role="region" aria-label="' + escape(name) + ' 전체 정보" data-scroll-key="jjum:' + escape(id) + '" id="jjum-scroll-' + regionKey + '"' : '') + '>' +
            '<button class="jjum-card-head" type="button" data-action="toggle" aria-expanded="' + isExpanded + '"' + (isExpanded ? ' aria-controls="' + detailsId + '"' : '') + ' aria-label="' + escape(name) + (isExpanded ? ' 접기' : ' 펼치기') + '">' +
                '<span class="jjum-card-row">' + scoreHtml + '<span class="jjum-header-metadata">' + nameHtml + metadataHtml + '</span>' + ellipsisHtml + '</span>' +
                (isExpanded ? '' : summaryHtml) + '</button>' + detailsHtml + '</div>' +
            '<button class="jjum-expand" type="button" data-action="toggle" aria-expanded="' + isExpanded + '" aria-label="' + escape(name) + (isExpanded ? ' 접기' : ' 펼치기') + '"><img src="Resources/haema-design/card-toggle/' + (isExpanded ? 'collapse-' : 'expand-') + state + '.svg" width="29.3827" height="17.0097" alt=""></button></article>';
    }).join('');
    const connectorsHtml = sortedJJums.flatMap(jjum => (Array.isArray(jjum.seons) ? jjum.seons : []).map(relation => {
        if (!relation || typeof relation !== 'object') return '';
        if (relation.targetId === jjum.jjumId || !sortedJJums.some(item => item.jjumId === relation.targetId)) return '';
        const display = this.seonDisplay(relation.weight);
        if (display.state === 'inactive') return '';
        return '<path class="seon-curve" data-source-id="' + escape(jjum.jjumId) + '" data-target-id="' + escape(relation.targetId) + '" data-seon-level="' + (display.level ?? 'unknown') + '" vector-effect="non-scaling-stroke"></path>';
    })).join('');
    return '<div class="jjum-list-section"><div class="jjum-list">' + (connectorsHtml ? '<svg class="seon-connections" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + connectorsHtml + '</svg>' : '') + accordionHtml + '</div></div>';
};

// Use the shared geometry; card expansion changes the middle segment, not the end size.
HAEMA_CONSOLE.updateSeonLayout = function() {
    const list = document.querySelector('.jjum-list');
    const drawing = list?.querySelector('.seon-connections');
    if (!drawing) return;
    const renderer = globalThis.HaemaSeon;
    if (typeof renderer?.paint !== 'function') {
        drawing.querySelectorAll('path').forEach(path => path.removeAttribute('d'));
        return;
    }
    const listRect = list.getBoundingClientRect();
    if (listRect.width <= 0 || listRect.height <= 0) return;
    drawing.setAttribute('viewBox', '0 0 ' + listRect.width + ' ' + listRect.height);
    const cards = new Map([...list.querySelectorAll('.jjum-card')].map(card => [card.dataset.jjumId, card]));
    const order = new Map([...cards.keys()].map((id, index) => [id, index]));
    const listStyle = getComputedStyle(list);
    const collapsedStep = Number.parseFloat(listStyle.getPropertyValue('--seon-card-height'))
        + (Number.parseFloat(listStyle.rowGap) || 0);
    const routes = [];
    drawing.querySelectorAll('path').forEach(path => {
        const source = cards.get(path.dataset.sourceId);
        const target = cards.get(path.dataset.targetId);
        if (!source || !target) { path.removeAttribute('d'); return; }
        const sourceRect = source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const startX = sourceRect.right - listRect.left - 8;
        const endX = targetRect.right - listRect.left - 8;
        const startY = sourceRect.top - listRect.top + 24;
        const endY = targetRect.top - listRect.top + 24;
        const anchorX = Math.max(startX, endX);
        routes.push({ path, startX, startY, endX, endY,
            distance: Math.abs(order.get(path.dataset.sourceId) - order.get(path.dataset.targetId)),
            room: Math.max(0, listRect.width - anchorX - 4) });
    });
    if (!routes.length) return;
    // Ordinal distance stays fixed when a card opens, unlike its measured height.
    routes.sort((a, b) => a.distance - b.distance);
    const groups = [];
    routes.forEach(route => {
        const previous = groups[groups.length - 1];
        if (previous && previous[0].distance === route.distance) previous.push(route);
        else groups.push([route]);
    });
    const maxLane = Math.min(64, ...routes.map(route => route.room));
    const minLane = Math.min(18, maxLane);
    const lastGroup = groups[groups.length - 1];
    const maxRank = groups.length - 1 + (lastGroup.length > 1 ? 0.08 : 0);
    groups.forEach((group, groupIndex) => group.forEach((route, duplicateIndex) => {
        // 짧은 연결부터 안쪽에 놓고, 같은 길이의 연결만 작은 간격으로 나눈다.
        const duplicateOffset = group.length > 1 ? duplicateIndex / (group.length - 1) * 0.08 : 0;
        const desiredLane = groups.length === 1
            ? Math.min(maxLane, minLane + duplicateIndex * 2)
            : minLane + (maxLane - minLane) * (groupIndex + duplicateOffset) / maxRank;
        // Reserve enough height even while both cards are collapsed; never size ends from expanded height.
        const heightBound = Number.isFinite(collapsedStep) && collapsedStep > 0
            ? route.distance * collapsedStep * renderer.sourceWidth / renderer.sourceHeight : desiredLane;
        const lane = Math.min(desiredLane, heightBound);
        const level = /^[1-7]$/.test(route.path.dataset.seonLevel || '') ? Number(route.path.dataset.seonLevel) : undefined;
        renderer.paint(route.path, { startX: route.startX, startY: route.startY,
            endX: route.endX, endY: route.endY, lane }, level);
    }));
};

// 접힘의 한 줄에는 테두리까지 온전히 들어가는 정보만 두고, 나머지는 펼침에서 읽는다.
HAEMA_CONSOLE.updateJJumMetadataLayout = function() {
    document.querySelectorAll('.jjum-card:not(.is-expanded)').forEach(card => {
        card.classList.remove('has-more-metadata');
        const metadata = card.querySelector('.jjum-header-metadata');
        if (!metadata) return;
        const chips = [...metadata.querySelectorAll('.jjum-chip')];
        chips.forEach(chip => { chip.hidden = false; });
        const bottom = metadata.getBoundingClientRect().bottom;
        if (!chips.some(chip => chip.getBoundingClientRect().bottom > bottom + .5)) return;
        card.classList.add('has-more-metadata');
        chips.forEach(chip => { chip.hidden = chip.getBoundingClientRect().bottom > bottom + .5; });
    });
};

HAEMA_CONSOLE.observeSeonLayout = function() {
    this.seonLayoutObserver?.disconnect();
    const list = document.querySelector('.jjum-list');
    if (!list) return;
    this.updateJJumMetadataLayout();
    this.updateSeonLayout();
    if (typeof ResizeObserver === 'undefined') return;
    this.seonLayoutObserver = new ResizeObserver(() => {
        this.updateJJumMetadataLayout();
        this.updateSeonLayout();
    });
    this.seonLayoutObserver.observe(list);
    const scroll = document.querySelector('.haema-scroll');
    if (scroll) this.seonLayoutObserver.observe(scroll);
    list.querySelectorAll('.jjum-card').forEach(card => this.seonLayoutObserver.observe(card));
    document.fonts?.ready.then(() => { this.updateJJumMetadataLayout(); this.updateSeonLayout(); });
};

// ===== 이벤트 리스너 =====
HAEMA_CONSOLE.attachEventListeners = function() {
    const sendBtn = document.getElementById("sendBtn");
    const clearBtn = document.getElementById("clearBtn");
    const createBtn = document.getElementById("createJJumBtn");
    const modalOverlay = document.getElementById("modalOverlay");
    const modalClose = document.getElementById("modalClose");
    const modalCancel = document.getElementById("modalCancel");
    const modalSave = document.getElementById("modalSave");
    const userInput = document.getElementById("userInput");
    const inputArea = document.querySelector(".input-area");
    const storageBtn = document.getElementById("storageBtn");
    document.getElementById('testHostSelect')?.addEventListener('change', event => {
        if (this.isComposing) this.hostAfterComposition = event.target.value;
        else this.switchChatHost(event.target.value);
    });
    this.bindHostPicker();
    document.getElementById('testHostReload')?.addEventListener('click', () => globalThis.HAEMA_TEST_HOST.refresh());
    document.getElementById('testHostRetry')?.addEventListener('click', () => globalThis.HAEMA_TEST_HOST.retry());
    document.getElementById('calendarConnect')?.addEventListener('click', () => globalThis.HAEMA_TEST_HOST.connectCalendar());
    document.getElementById('calendarStatus')?.addEventListener('click', () => globalThis.HAEMA_TEST_HOST.calendarStatus());
    document.getElementById('calendarDisconnect')?.addEventListener('click', () => globalThis.HAEMA_TEST_HOST.disconnectCalendar());
    document.getElementById('introductionBtn')?.addEventListener('click', () => HAEMA_INTRODUCTION_MODAL.open(this));

    document.querySelectorAll("[data-action]").forEach(element => {
        element.addEventListener("click", event => {
            event.stopPropagation();
            const id = element.closest("[data-jjum-id]")?.dataset.jjumId;
            if (element.dataset.action === "toggle") this.toggleJJum(id);
            if (element.dataset.action === "edit") this.openEditModal(id);
            if (element.dataset.action === "hide") this.confirmDelete(id);
        });
    });
    document.querySelectorAll('[data-mobile-panel]').forEach(element => {
        if (element.classList.contains('mobile-tab')) element.addEventListener('click', () => {
            this.activeMobilePanel = element.dataset.mobilePanel;
            this.render();
        });
    });

    // 저장소/API 키 준비 상태에 따라 userInput disabled 처리
    this.updateInputAvailability();

    if (sendBtn) sendBtn.addEventListener("click", () => this.activateSend());
    document.querySelectorAll('[data-retry-utterance]').forEach(button => {
        button.addEventListener('click', () => this.retryConversation(button.dataset.retryUtterance));
    });
    document.querySelectorAll('[data-incremental-retry-delivery]').forEach(button => {
        button.addEventListener('click', () => this.incrementalController?.retryDelivery(button.dataset.incrementalRetryDelivery));
    });
    document.querySelectorAll('[data-incremental-retry-processing]').forEach(button => {
        button.addEventListener('click', () => {
            const result = this.incrementalController?.retry(button.dataset.incrementalRetryProcessing);
            if (result?.ok) this.trackTokenTurn('begin', this.getConversationScope(), this.incrementalUsageRequest(result.input));
        });
    });
    document.getElementById('incrementalRefreshBtn')?.addEventListener('click', () => {
        const controller = this.incrementalController;
        if (!controller) return;
        const scope = this.getConversationScope();
        if (!HAEMA_CONVERSATION_SESSION.sameScope(scope, controller.getState().scope)) { this.render(); return; }
        const text = document.getElementById('userInput')?.value || '';
        controller.stop();
        this.incrementalController = null;
        // A new local controller reads the same saved session ID. A restarted
        // server is never silently assigned the old submissions as fresh work.
        if (!this.selectedTestHost) this.syncIncrementalConversation(scope);
        this.draftVersion += 1;
        this.incrementalDraftRestore = { text, draftVersion: this.draftVersion };
        this.render();
    });
    // The server connection is shared: do not switch this tab's storage during a send.
    if (storageBtn) storageBtn.disabled = this.sending;
    if (clearBtn) clearBtn.addEventListener("click", () => this.handleClear());
    if (createBtn) createBtn.addEventListener("click", () => this.openCreateModal());
    document.getElementById('previewUsageDetails')?.addEventListener('toggle', event => {
        if (event.target.isConnected) this.previewUsageDetailsOpen = event.target.open;
    });
    document.querySelectorAll('[data-result-key]').forEach(button => button.addEventListener('click', () => this.selectHistoryResult(button.dataset.resultKey)));
    document.getElementById('previewLatestBtn')?.addEventListener('click', () => this.openLatestResult());
    if (storageBtn) storageBtn.addEventListener("click", () => {
        if (typeof HAEMA_STORAGE_MODAL !== "undefined" && typeof HAEMA_STORAGE_MODAL.open === "function") {
            HAEMA_STORAGE_MODAL.open();
        }
    });
    const apiKeyBtn = document.getElementById("apiKeyBtn");
    if (apiKeyBtn) apiKeyBtn.addEventListener("click", () => this.openApiKeyModal());
    if (modalOverlay) modalOverlay.addEventListener("click", (e) => {
        if (e.target === modalOverlay) this.closeModal();
    });
    if (modalClose) modalClose.addEventListener("click", () => this.closeModal());
    if (modalCancel) modalCancel.addEventListener("click", () => this.closeModal());
    if (modalSave) modalSave.addEventListener("click", () => this.saveModal());

    // input-area 클릭 시 저장소/API 키 상태에 따라 안내 모달 열기
    if (inputArea && !this.boundInputElements.has(inputArea)) {
        this.boundInputElements.add(inputArea);
        inputArea.addEventListener("click", (e) => {
            const disabledOverlay = e.target.closest(".input-disabled-overlay");
            if (disabledOverlay) {
                this.handleInputAreaClick();
                return;
            }

            const input = document.getElementById("userInput");
            if (e.target.id === "userInput") {
                if (input && (input.disabled || input.readOnly)) {
                    this.handleInputAreaClick();
                    return;
                }
                return;
            }
            if (e.target.closest("button")) {
                return;
            }
            this.handleInputAreaClick();
        });
    }

    // 실시간 타이핑 쓰로틀 (Throttle 500ms - 타이핑 중에도 0.5초마다 계속 호출)
    if (userInput && !this.boundInputElements.has(userInput)) {
        this.boundInputElements.add(userInput);
        userInput.addEventListener("compositionstart", () => {
            if (userInput.readOnly) { this.handleInputAreaClick(); return; }
            this.isComposing = true;
        });
        for (const eventName of ['beforeinput', 'paste', 'cut']) {
            userInput.addEventListener(eventName, event => {
                if (!userInput.readOnly) return;
                event.preventDefault();
                this.handleInputAreaClick();
            });
        }
        userInput.addEventListener("compositionend", (e) => {
            if (document.getElementById('userInput') !== userInput) return;
            this.isComposing = false;
            if (!userInput.dataset?.editor || userInput.dataset.editor === this.chatEditorKey()) this.handleInput(e.target.value);
            if (this.hostAfterComposition != null) {
                const next = this.hostAfterComposition;
                this.hostAfterComposition = null;
                this.switchChatHost(next);
                return;
            }
            if (this.deferredCompositionRender) this.render();
        });
        userInput.addEventListener("input", (e) => {
            if (document.getElementById('userInput') !== userInput) return;
            if (!this.selectedTestHost) this.draftVersion += 1;
            if (!this.isComposing) this.handleInput(e.target.value);
        });
        userInput.addEventListener("keydown", (e) => {
            const editingKey = e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete' ||
                (e.key.length === 1 && !e.ctrlKey && !e.metaKey) ||
                ((e.ctrlKey || e.metaKey) && ['v', 'x'].includes(e.key.toLowerCase()));
            if (userInput.readOnly && editingKey) {
                e.preventDefault();
                if (!e.repeat) this.handleInputAreaClick();
                return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !this.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                if (!e.repeat) this.activateSend();
            }
        });
    }
};

// ===== 저장소/API 키 준비 상태 체크 =====
HAEMA_CONSOLE.isStorageReady = function() {
    return this.storageConnected === true && globalThis.HAEMA_LOCAL_CONNECTION?.status().connection === 'connected';
};

HAEMA_CONSOLE.isApiKeyReady = function() {
    return this.apiConfigured === true && globalThis.HAEMA_LOCAL_CONNECTION?.status().aiReady === true;
};

HAEMA_CONSOLE.refreshApiStatus = async function() {
    try {
        const response = await HAEMA_LOCAL_CONNECTION.request('settings.status');
        if (!response.ok) throw new Error("설정 상태를 확인할 수 없습니다.");
        const config = await response.json();
        this.apiConfigured = config.configured === true;
        localStorage.setItem("haema_api_configured", String(this.apiConfigured));
        if (this.apiConfigured) {
            localStorage.setItem("haema_api_provider", config.provider || "");
            localStorage.setItem("haema_api_model", config.model || "");
            localStorage.setItem("haema_api_base_url", config.baseUrl || "");
        try {
            const cipher = new WebCryptoCipher();
            await cipher.generateSessionKey();
            const saved = await new ConsoleConfigStore(cipher).load();
            const active = typeof activeApiKeySet === 'function' ? activeApiKeySet(saved) : saved.apiKeySet;
            this.apiKeyName = active?.name || active?.keyName || active?.provider || config.provider || '';
        } catch { this.apiKeyName = config.provider || ''; }
        }
    } catch {
        this.apiConfigured = false;

    }
    this.render();
};

// ===== userInput 사용 가능 여부 업데이트 =====
HAEMA_CONSOLE.updateInputAvailability = function() {
    const userInput = document.getElementById("userInput");
    if (!userInput) return;
    const storageReady = this.isStorageReady();
    const apiKeyReady = this.isApiKeyReady();
    const isReady = storageReady && apiKeyReady;
    userInput.disabled = false;
    userInput.readOnly = !isReady;
    userInput.setAttribute('aria-readonly', String(!isReady));
    userInput.title = '';
    if (!!this.selectedTestHost) {
        const host = globalThis.HAEMA_TEST_HOST.state;
        const send = document.getElementById('sendBtn');
        if (send) send.disabled = !isReady || host.loading || host.sending || !host.ready || !userInput.value.trim();
        return;
    }
    const sendBtn = document.getElementById("sendBtn");
    if (sendBtn) sendBtn.disabled = !isReady || this.sending;
};

// ===== input-area 클릭 시 처리 =====
HAEMA_CONSOLE.handleInputAreaClick = async function() {
    if (this.inputWarningOpen) return;
    const storageReady = this.isStorageReady();
    const apiKeyReady = this.isApiKeyReady();
    if (storageReady && apiKeyReady) return;
    this.inputWarningOpen = true;
    try {
        const connection = globalThis.HAEMA_LOCAL_CONNECTION?.status();
        if (connection?.connection !== 'connected') {
            await HAEMA_DIALOG.alert('내 컴퓨터의 해마 실행 프로그램과 먼저 연결해 주세요.', { title: '연결이 필요해요' });
        } else if (connection.runtimeMode === 'setup-only') {
            await HAEMA_DIALOG.alert('지금은 설정을 확인하는 중이에요. 대화 연결 준비가 끝나면 입력할 수 있어요.', { title: '대화 준비가 필요해요' });
        } else if (!storageReady && !apiKeyReady) {
            await HAEMA_DIALOG.alert("저장소와 AI 연결을 설정하면 대화를 시작할 수 있어요.", { title: '대화할 준비를 해볼까요?' });
            this.statusText = "🪣저장소🪣와 🗝️AI 연결🗝️을 모두 준비해 주세요";
            this.render();
            if (typeof HAEMA_STORAGE_MODAL !== "undefined" && typeof HAEMA_STORAGE_MODAL.open === "function") {
                HAEMA_STORAGE_MODAL.open();
            }
        } else if (!storageReady) {
            await HAEMA_DIALOG.alert("기억을 보관할 저장 폴더를 먼저 연결해주세요.", { title: '저장소를 연결해주세요' });
            this.statusText = "🪣저장소🪣가 연결되지 않았습니다.";
            this.render();
            if (typeof HAEMA_STORAGE_MODAL !== "undefined" && typeof HAEMA_STORAGE_MODAL.open === "function") {
                HAEMA_STORAGE_MODAL.open();
            }
        } else if (!apiKeyReady) {
            await HAEMA_DIALOG.alert("사용할 AI와 모델의 연결 설정을 확인해주세요.", { title: 'AI 연결을 확인해주세요', tone: 'error' });
            this.statusText = "🗝️AI 연결🗝️ 설정을 확인해주세요.";
            this.render();
            this.openApiKeyModal();
        }
    } finally {
        this.inputWarningOpen = false;
    }
};

// Enter와 클릭 모두 같은 버튼 눌림 상태를 사용하며 화면 재생성 후에도 유지한다.
HAEMA_CONSOLE.activateSend = function() {
    const button = document.getElementById("sendBtn");
    if (!button || button.disabled) return;
    this.sendPressed = true;
    button.classList.add("is-pressed");
    clearTimeout(this.sendPressTimer);
    this.sendPressTimer = setTimeout(() => {
        this.sendPressed = false;
        this.sendPressTimer = null;
        document.getElementById("sendBtn")?.classList.remove("is-pressed");
    }, 180);
    return this.handleSend();
};

HAEMA_CONSOLE.getConversationScope = function() {
    const storageRoot = localStorage.getItem('haema_storage_root') || localStorage.getItem('haema_storage_path') || '';
    if (!storageRoot) return null;
    const identity = this.storageIdentity;
    if (!this.storageConnected && identity?.storageRoot !== storageRoot) return null;
    const storageId = identity?.storageRoot === storageRoot ? identity.storageId : undefined;
    return { ownerId: this.conversationOwnerId, storageRoot, ...(this.hasStorageId({ storageId }) ? { storageId } : {}) };
};

HAEMA_CONSOLE.hasStorageId = function(scope) {
    return typeof scope?.storageId === 'string' && scope.storageId.trim() === scope.storageId &&
        scope.storageId.length > 0 && scope.storageId.length <= 512;
};

HAEMA_CONSOLE.getTokenUsageStore = function() {
    if (!this.tokenUsage && typeof HAEMA_TOKEN_USAGE !== 'undefined') this.tokenUsage = HAEMA_TOKEN_USAGE.create();
    return this.tokenUsage;
};

// Introduction name selection is an independent Haema operation, not a chat turn.
HAEMA_CONSOLE.getIntroductionTokenUsageStore = function() {
    if (!this.introductionTokenUsage && typeof HAEMA_TOKEN_USAGE !== 'undefined') {
        this.introductionTokenUsage = HAEMA_TOKEN_USAGE.create({ key: 'haema_introduction_token_usage_v2' });
    }
    return this.introductionTokenUsage;
};

HAEMA_CONSOLE.readIntroductionTokenUsage = function() {
    const scope = this.getConversationScope();
    if (!this.hasStorageId(scope)) return null;
    const summary = this.getIntroductionTokenUsageStore()?.current(scope);
    const warning = this.introductionTokenUsageError;
    if (warning && HAEMA_CONVERSATION_SESSION.sameScope(scope, warning.scope)) {
        return { ...summary, warning: warning.error };
    }
    return summary?.conversationId || summary?.ok === false ? summary : null;
};

HAEMA_CONSOLE.receiveIntroductionUsage = function(scope, envelope) {
    if (!this.hasStorageId(scope) || !HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope())) return;
    const operationId = envelope?.operationId;
    let outcome;
    if (typeof operationId !== 'string' || !operationId.startsWith('introduction:') || operationId.length > 512 ||
        operationId !== envelope?.tokenUsage?.conversationId ||
        !Array.isArray(envelope?.tokenUsage?.calls) || envelope.tokenUsage.calls.some(call => !call || call.task !== 'selectDisplayName')) {
        outcome = { ok: false, error: '자기소개 사용량의 형식을 확인하지 못했어요. 이전 기록은 유지해요.' };
    } else {
        const store = this.getIntroductionTokenUsageStore();
        const request = { ownerId: scope.ownerId, conversationId: operationId, turns: [{ utteranceId: operationId }] };
        outcome = store?.record(scope, request, envelope.tokenUsage, {
            conversationUsage: envelope.conversationUsage, usagePersistence: envelope.usagePersistence
        });
        if (outcome?.ok) {
            const focused = store.focus(scope, request);
            if (focused?.ok === false) outcome = focused;
        }
    }
    this.introductionTokenUsageError = outcome?.ok ? null : { scope, error: outcome?.error || '자기소개 사용량을 확인하지 못했어요.' };
    return outcome;
};

HAEMA_CONSOLE.restoreIntroductionTokenUsage = async function(scope, epoch = this.conversationScopeEpoch) {
    const store = this.getIntroductionTokenUsageStore();
    const conversationId = store?.current(scope)?.conversationId;
    if (!conversationId) return;
    const current = () => epoch === this.conversationScopeEpoch &&
        HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope()) && store.current(scope)?.conversationId === conversationId;
    try {
        if (!current()) return;
        await this.verifyConversationScope(scope);
        const response = await HAEMA_LOCAL_CONNECTION.request('conversation.usage', { ownerId: scope.ownerId, conversationId });
        const payload = await response.json();
        if (!current()) return;
        await this.verifyConversationScope(scope);
        if (!current()) return;
        if (!response.ok || payload.success !== true) throw Error('서버의 자기소개 사용량을 읽지 못했어요. 마지막 확인값은 유지해요.');
        const outcome = store.restore(scope, conversationId, payload.conversationUsage);
        if (!outcome.ok) throw Error(outcome.error);
        this.introductionTokenUsageError = null;
    } catch (error) {
        if (current()) this.introductionTokenUsageError = { scope, error: error.message || '자기소개 사용량을 확인하지 못했어요.' };
    }
    if (current()) this.render();
};

HAEMA_CONSOLE.readTokenUsage = function() {
    if (this.selectedTestHost) {
        const host = globalThis.HAEMA_TEST_HOST.state;
        const summary = host.usage?.current(host.storageScope) || { ok: true, turnCount: 0, latest: null };
        return host.usageWarning ? { ...summary, warning: host.usageWarning } : summary;
    }
    const scope = this.getConversationScope();
    if (!scope) return { ok: true, turnCount: 0, latest: null };
    if (!this.hasStorageId(scope)) return { ok: false, summary: null, error: '연결된 저장소의 식별 정보를 받지 못해 사용량을 확인할 수 없어요. 저장소를 다시 연결해 주세요.' };
    const summary = this.getTokenUsageStore()?.current(scope) || { ok: true, turnCount: 0, latest: null };
    if (this.tokenUsageError && HAEMA_CONVERSATION_SESSION.sameScope(scope, this.tokenUsageError.scope)) {
        return { ...summary, warning: this.tokenUsageError.error };
    }
    return summary;
};

HAEMA_CONSOLE.trackTokenTurn = function(action, scope, request) {
    if (!this.hasStorageId(scope)) return;
    const outcome = this.getTokenUsageStore()?.[action](scope, request);
    if (outcome?.ok === false) this.tokenUsageError = { scope, error: outcome.error };
    return outcome;
};

// The report is Haema-only. Host generation and recall length estimates never enter this ledger.
HAEMA_CONSOLE.receiveTokenUsage = function(scope, request, measurement, persistence = {}) {
    if (!this.hasStorageId(scope)) return { ok: false, summary: null, error: '사용량의 저장소를 확인하지 못했어요.' };
    const outcome = this.getTokenUsageStore()?.record(scope, request, measurement, persistence);
    if (outcome?.ok === false) this.tokenUsageError = { scope, error: outcome.error };
    else if (outcome?.ok) this.tokenUsageError = null;
    if (HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope())) this.render();
    return outcome;
};

HAEMA_CONSOLE.restoreTokenUsage = async function(scope, conversationId, epoch = this.conversationScopeEpoch) {
    if (!this.hasStorageId(scope)) return;
    const isCurrent = () => epoch === this.conversationScopeEpoch &&
        HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope()) &&
        this.conversationSession.current(scope) === conversationId;
    try {
        if (!isCurrent()) return;
        await this.verifyConversationScope(scope);
        if (!isCurrent()) return;
        const response = await HAEMA_LOCAL_CONNECTION.request('conversation.usage', { ownerId: scope.ownerId, conversationId });
        const payload = await response.json();
        if (!isCurrent()) return;
        if (!response.ok || payload.success !== true) throw new Error('서버의 누적 사용량을 읽지 못했어요. 확인된 기록은 유지해요.');
        // Pin the opaque ID supplied by storage status/init before the request;
        // both status checks and the response must agree with that original ID.
        await this.verifyConversationScope(scope);
        if (!isCurrent()) return;
        const outcome = this.getTokenUsageStore()?.restore(scope, conversationId, payload.conversationUsage);
        if (outcome?.ok === false) throw new Error(outcome.error);
        this.tokenUsageError = null;
    } catch (error) {
        if (HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope()) && epoch === this.conversationScopeEpoch) {
            this.tokenUsageError = { scope, error: error.message || '서버 사용량을 확인하지 못했어요. 기존 기록은 유지해요.' };
        }
    }
    if (epoch === this.conversationScopeEpoch && HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope())) this.render();
};

HAEMA_CONSOLE.syncConversationPending = function() {
    try {
        if (!this.conversationSession) this.conversationSession = HAEMA_CONVERSATION_SESSION.create();
        const scope = this.getConversationScope();
        if (!this.selectedTestHost) this.syncIncrementalConversation(scope);
        if (JSON.stringify(scope) !== JSON.stringify(this.activeConversationScope)) {
            globalThis.HAEMA_TEST_HOST?.reset();
            this.conversationScopeEpoch += 1;
            if (!!this.selectedTestHost) queueMicrotask(() => this.activateTestHost());
            this.tokenUsageRestoreKey = null;
            this.introductionUsageRestoreKey = null;
        }
        if (!scope || (this.activeConversationScope && !HAEMA_CONVERSATION_SESSION.sameScope(scope, this.activeConversationScope))) {
            this.selectedHistoryResult = null;
            this.selectedResultAnchor = null;
            this.latestResult = null;
            this.previewState = 'idle';
            this.recallResults = [];
            this.answerGuide = null;
        }
        this.activeConversationScope = scope;
        this.conversationSessionNotice = '';
        if (!scope) return;
        if (this.hasStorageId(scope)) {
            const key = JSON.stringify([scope.ownerId, scope.storageRoot, scope.storageId]);
            if (key !== this.introductionUsageRestoreKey) {
                this.introductionUsageRestoreKey = key;
                const epoch = this.conversationScopeEpoch;
                Promise.resolve().then(() => this.restoreIntroductionTokenUsage(scope, epoch));
            }
        }
        const unverified = this.conversationSession.unverifiedPendingCount(scope);
        if (unverified) this.conversationSessionNotice = '이전 연결의 미완료 전송 ' + unverified + '건은 이 탭에 보관 중이에요. 저장소가 확인되지 않아 자동으로 다시 보내지 않았어요.';
        const conversationId = this.conversationSession.current(scope);
        if (conversationId) {
            const key = JSON.stringify([scope.ownerId, scope.storageRoot, scope.storageId ?? null, conversationId]);
            if (key !== this.tokenUsageRestoreKey) {
                this.tokenUsageRestoreKey = key;
                const epoch = this.conversationScopeEpoch;
                Promise.resolve().then(() => this.restoreTokenUsage(scope, conversationId, epoch));
            }
        }
        this.conversationSession.pending(scope).forEach(request => {
            const turn = request.turns[0];
            if (this.conversationHistory.some(item => item.request?.turns[0].utteranceId === turn.utteranceId && HAEMA_CONVERSATION_SESSION.sameScope(item.scope, scope))) return;
            this.conversationHistory.push({ type: 'user', text: turn.text, at: turn.at, request, scope, failed: true,
                error: '이전 전송의 완료 여부를 확인하지 못했어요. 다시 보내기로 확인할 수 있어요.' });
        });
    } catch (error) {
        this.conversationSessionError = error.message || '이 탭의 전송 기록을 확인할 수 없어 전송을 멈췄어요.';
        this.conversationPersistenceBlocked = true;
    }
};

HAEMA_CONSOLE.verifyConversationScope = async function(scope) {
    if (!scope || !HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope())) {
        throw new Error('이 대화를 보냈던 저장소를 연결한 뒤 다시 보내 주세요.');
    }
    const response = await HAEMA_LOCAL_CONNECTION.request('storage.status');
    const status = await response.json();
    if (!response.ok || status.connected !== true || status.storageRoot !== scope.storageRoot ||
        !HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope())) {
        throw new Error('저장소 연결이 바뀌었거나 확인되지 않아 전송을 멈췄어요. 저장소를 다시 확인해 주세요.');
    }
    if ((this.hasStorageId(scope) && status.storageId !== scope.storageId) ||
        (!this.hasStorageId(scope) && this.hasStorageId(status))) {
        throw new Error('연결된 저장소의 식별 정보가 바뀌어 처리를 멈췄어요. 저장소를 다시 연결해 주세요.');
    }
};

HAEMA_CONSOLE.waitForConversationComposition = function() {
    const input = document.getElementById('userInput');
    if (!this.isComposing || !input) return Promise.resolve();
    return new Promise(resolve => input.addEventListener('compositionend', () => { this.isComposing = false; resolve(); }, { once: true }));
};

// A storage switch stops local delivery, never deletes the server's session or
// silently submits old text into another physical store.
HAEMA_CONSOLE.syncIncrementalConversation = function(scope) {
    if (!this.isApiKeyReady() || !scope || !this.hasStorageId(scope)) {
        if (this.incrementalController) {
            this.incrementalController.stop();
            this.incrementalDraftRestore = null;
        }
        this.incrementalController = null;
        this.incrementalState = null;
        clearTimeout(this.incrementalUsageTimer);
        this.incrementalUsageTimer = null;
        return null;
    }
    if (this.incrementalController && HAEMA_CONVERSATION_SESSION.sameScope(scope, this.incrementalState?.scope)) return this.incrementalController;
    this.incrementalController?.stop();
    this.incrementalController = null;
    this.incrementalState = null;
    clearTimeout(this.incrementalUsageTimer);
    this.incrementalUsageTimer = null;
    this.incrementalListWarning = '';
    const conversationId = this.conversationSession.ensure(scope);
    let controller;
    const current = () => this.incrementalController === controller && HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope());
    controller = HAEMA_INCREMENTAL_CONTROLLER.create({
        client: HAEMA_INCREMENTAL_CLIENT.create(), scope, conversationId,
        verifyScope: checked => this.verifyConversationScope(checked),
        onChange: state => Promise.resolve().then(() => {
            if (current()) this.receiveIncrementalState(controller, state);
        }),
        onResult: event => Promise.resolve().then(() => {
            if (current()) return this.receiveIncrementalResult(controller, event);
        })
    });
    this.incrementalController = controller;
    this.incrementalState = controller.getState();
    this.incrementalDraftRestore = this.incrementalState.draft && !this.lastInputValue ? { text: this.incrementalState.draft.text, draftVersion: this.draftVersion } : null;
    this.incrementalStateSignature = '';
    const startingDraftVersion = this.draftVersion;
    Promise.resolve().then(() => controller.start()).then(() => {
        if (!current() || (!this.selectedTestHost && this.isComposing)) return;
        const input = document.getElementById('userInput');
        if (!input || !controller.getState().session) return;
        const restored = controller.getState().draft;
        if (restored && this.draftVersion === startingDraftVersion && !input.value && !this.lastInputValue) {
            if (!this.selectedTestHost) input.value = restored.text;
            this.lastInputValue = restored.text;
        } else {
            // Typing during the handshake wins over a remotely restored draft,
            // while the controller keeps that draft's identity and revision.
            controller.sample(!!this.selectedTestHost ? this.lastInputValue : input.value);
        }
    }).catch(() => { /* Controller keeps the original queue and reports the error. */ });
    return controller;
};

HAEMA_CONSOLE.incrementalUsageRequest = function(input) {
    return { ownerId: this.incrementalState.scope.ownerId, conversationId: this.incrementalState.conversationId,
        turns: [{ utteranceId: input.inputId }] };
};

HAEMA_CONSOLE.receiveIncrementalState = function(controller, state) {
    if (this.incrementalController !== controller || !HAEMA_CONVERSATION_SESSION.sameScope(state.scope, this.getConversationScope())) return;
    const signature = JSON.stringify(state);
    if (signature === this.incrementalStateSignature) return;
    this.incrementalStateSignature = signature;
    this.incrementalState = state;
    const submissions = state.session?.submissions || [];
    const inputs = new Map(submissions.map(submission => [submission.inputId, { input: submission, delivery: 'accepted', processing: submission.processing }]));
    state.entries.forEach(entry => inputs.set(entry.input.inputId, entry));
    [...inputs.values()].sort((a, b) => a.input.sequence - b.input.sequence).forEach(entry => {
        let message = this.conversationHistory.find(item => item.incremental && item.inputId === entry.input.inputId &&
            item.conversationId === state.conversationId && HAEMA_CONVERSATION_SESSION.sameScope(item.scope, state.scope));
        if (!message) {
            message = { type: 'user', incremental: true, scope: state.scope, conversationId: state.conversationId, inputId: entry.input.inputId };
            this.conversationHistory.push(message);
        }
        Object.assign(message, { text: entry.input.text, at: entry.input.at ?? entry.input.receivedAt ?? Date.now(),
            sequence: entry.input.sequence, delivery: entry.delivery, processing: entry.processing?.status || null,
            retryDelivery: entry.delivery === 'uncertain' || entry.retry?.delivery === 'uncertain',
            retryProcessing: submissions.at(-1)?.inputId === entry.input.inputId && entry.processing?.status === 'failed' &&
                !state.entries.some(item => item.delivery !== 'accepted') && (!entry.retry || entry.retry.delivery === 'accepted'),
            error: entry.error?.message || (entry.processing?.result?.code === 'AI_NOT_CONFIGURED'
                ? 'AI 연결을 확인한 뒤 기억 처리를 다시 시도해 주세요.' : ''),
            acknowledged: entry.delivery === 'accepted', failed: false });
    });
    this.latestResult = null;
    this.recallResults = [];
    this.answerGuide = null;
    this.previewState = 'incremental';
    const queued = state.entries.filter(entry => entry.delivery !== 'accepted').length;
    const pending = submissions.some(entry => entry.processing.status === 'pending');
    this.status = state.error ? 'error' : queued || pending ? 'working' : 'resting';
    const latestStatus = submissions.at(-1)?.processing.status;
    this.statusText = state.error ? '연결 확인 필요' : queued ? '전송 대기 ' + queued + '건' : pending ? '접수 완료 · 기억 처리 중' :
        latestStatus === 'failed' ? '접수 완료 · 처리 확인 필요' : submissions.length ? '기억 처리 확인' : '해마 쉬는 중...';
    this.scheduleIncrementalUsage(controller);
    this.render();
};

HAEMA_CONSOLE.receiveIncrementalResult = async function(controller, event) {
    const current = () => this.incrementalController === controller && HAEMA_CONVERSATION_SESSION.sameScope(event.scope, this.getConversationScope());
    if (!current()) return;
    const request = this.incrementalUsageRequest(event.input);
    const live = controller.getState();
    const latestSequence = Math.max(0, ...(live.entries || []).map(entry => entry.input.sequence),
        ...(live.session?.submissions || []).map(entry => entry.sequence));
    if (event.isLatest && event.input.sequence === latestSequence &&
        this.getTokenUsageStore()?.current(event.scope)?.latest?.utteranceId !== event.input.inputId) {
        this.trackTokenTurn('focus', event.scope, request);
    }
    this.trackTokenTurn(event.processing.status === 'failed' ? 'fail' : 'accept', event.scope, request);
    if (event.result?.tokenUsage) this.receiveTokenUsage(event.scope, request, event.result.tokenUsage, {
        conversationUsage: event.result.conversationUsage, usagePersistence: event.result.usagePersistence
    });
    // Superseded processing can still consume tokens. Read the authoritative
    // ledger instead of guessing its cost from whether a result was applied.
    await this.restoreTokenUsage(event.scope, event.conversationId);
    if (!current()) return;
    if (event.processing.status === 'completed') {
        try { await this.loadLocalServerData(); }
        catch { if (current()) this.incrementalListWarning = '기억 처리는 끝났지만 목록을 새로 읽지 못했어요.'; }
    }
    if (current()) { this.scheduleIncrementalUsage(controller); this.render(); }
};

HAEMA_CONSOLE.scheduleIncrementalUsage = function(controller) {
    if (this.incrementalUsageTimer || this.incrementalController !== controller) return;
    const state = controller.getState();
    if (!state.session?.submissions.some(entry => entry.processing.status === 'pending') && !this.readTokenUsage().pendingUsageIds?.length) return;
    this.incrementalUsageTimer = setTimeout(async () => {
        this.incrementalUsageTimer = null;
        if (this.incrementalController !== controller) return;
        await this.restoreTokenUsage(state.scope, state.conversationId);
        if (this.incrementalController === controller) this.scheduleIncrementalUsage(controller);
    }, 1000);
};

HAEMA_CONSOLE.handleSend = function() {
    if (!!this.selectedTestHost) return this.sendTestHostMessage();
    if (this.sending || this.isComposing) return;
    if (!this.isStorageReady() || !this.isApiKeyReady()) {
        this.handleInputAreaClick();
        return;
    }
    const input = document.getElementById("userInput");
    if (!input) return;
    const text = input.value;
    if (!text.trim()) {
        this.status = "error";
        this.statusText = "⚠️ 입력할 내용을 작성해주세요!";
        this.render();
        return;
    }
    this.syncConversationPending();
    if (this.conversationPersistenceBlocked) {
        this.status = 'error';
        this.statusText = this.conversationSessionError;
        this.render();
        return;
    }
    try {
        const controller = this.incrementalController;
        const outcome = controller?.enqueue(text);
        if (!outcome?.ok) throw new Error(outcome?.message || '연속 입력 연결을 확인하고 있어요. 입력은 그대로 두었습니다.');
        this.trackTokenTurn('begin', this.getConversationScope(), this.incrementalUsageRequest(outcome.input));
        input.value = '';
        this.draftVersion += 1;
        this.lastInputValue = '';
        this.pendingConversationScroll = true;
        this.recallResults = [];
        this.answerGuide = null;
        this.latestResult = null;
        this.previewState = 'incremental';
        this.receiveIncrementalState(controller, controller.getState());
    } catch (error) {
        this.status = 'error';
        this.statusText = error.message || '전송을 준비하지 못했어요.';
        if (error.code === 'CONVERSATION_SESSION') {
            this.conversationSessionError = this.statusText;
            this.conversationPersistenceBlocked = true;
        }
        this.render();
    }
};

HAEMA_CONSOLE.retryConversation = async function(utteranceId) {
    if (this.sending || this.isComposing) return;
    const scope = this.getConversationScope();
    const message = this.conversationHistory.find(item => item.failed && !item.acknowledged &&
        item.request?.turns[0].utteranceId === utteranceId && HAEMA_CONVERSATION_SESSION.sameScope(item.scope, scope));
    if (!message) return;
    if (!this.isStorageReady() || !this.isApiKeyReady()) { this.handleInputAreaClick(); return; }
    return this.sendConversationRequest(message, true);
};

HAEMA_CONSOLE.sendConversationRequest = async function(message, retry, alreadyVerified = false) {
    if (this.sending && !alreadyVerified) return;
    const request = message.request;
    const text = request.turns[0].text;
    this.pendingConversationScroll = true;
    this.status = "working";
    this.sending = true;
    this.latestResult = null;
    this.previewState = 'loading';
    this.recallResults = [];
    this.answerGuide = null;
    this.stopBackgroundStream();
    this.statusText = "대화를 보내고 있어요";
    this.activeMobilePanel = 'chat';
    this.render();

    let accepted = false;
    let tokenTurnStarted = false;
    let usageReceived = false;
    const usageEpoch = this.conversationScopeEpoch;
    try {
        if (!alreadyVerified) await this.verifyConversationScope(message.scope);
        if (!HAEMA_CONVERSATION_SESSION.sameScope(message.scope, this.getConversationScope())) throw new Error('저장소가 바뀌어 전송을 멈췄어요.');
        this.conversationSession.savePending(message.scope, request);
        this.conversationSessionError = '';
        this.conversationPersistenceBlocked = false;
        this.trackTokenTurn('begin', message.scope, request);
        tokenTurnStarted = true;
        this.render();
        const response = await HAEMA_LOCAL_CONNECTION.request('conversation.process', retry ? { ...request, touch: false } : request);
        const payload = await response.json();
        usageReceived = !!payload.tokenUsage;
        // Failure responses may already have consumed tokens. Preserve their
        // observed usage before receipt/application error handling below.
        if (payload.tokenUsage && this.hasStorageId(message.scope) && usageEpoch === this.conversationScopeEpoch &&
            HAEMA_CONVERSATION_SESSION.sameScope(message.scope, this.getConversationScope())) {
            try {
                await this.verifyConversationScope(message.scope);
                if (usageEpoch === this.conversationScopeEpoch) this.receiveTokenUsage(message.scope, request, payload.tokenUsage, {
                    conversationUsage: payload.conversationUsage,
                    usagePersistence: payload.usagePersistence
                });
            } catch (error) {
                this.tokenUsageError = { scope: message.scope, error: error.message || '사용량의 저장소를 확인하지 못했어요.' };
            }
        }
        if (response.ok && payload.success && !payload.extraction?.receipt) {
            throw Object.assign(new Error('서버에서 대화 처리 확인을 받지 못했어요. 최신 로컬 서버 연결을 확인한 뒤 다시 보내 주세요.'), { code: 'CONVERSATION_RECEIPT' });
        }
        this.conversationSession.validateReceipt(request, payload.extraction?.receipt ?? payload.receipt);
        if (!response.ok || !payload.success) {
            const error = new Error(payload.error || "대화 처리에 실패했습니다.");
            error.code = payload.code || (response.status === 429 ? "USAGE_LIMIT" : "");
            throw error;
        }
        accepted = true;
        message.acknowledged = true;
        message.failed = false;
        message.error = '';
        this.trackTokenTurn('accept', message.scope, request);
        try { this.conversationSession.complete(message.scope, request.turns[0].utteranceId); }
        catch (error) {
            this.conversationSessionError = '대화는 보냈지만 이 탭의 전송 기록을 정리하지 못했어요. 새 전송을 멈추고 기존 기록을 유지했습니다.';
            this.conversationPersistenceBlocked = true;
        }
        await this.waitForConversationComposition();
        if (!HAEMA_CONVERSATION_SESSION.sameScope(message.scope, this.getConversationScope())) {
            this.status = 'resting';
            this.statusText = '대화는 보냈어요. 현재 연결된 저장소를 확인해 주세요.';
            this.sending = false;
            this.render();
            return;
        }

        const hostPreview = payload.hostPreview && typeof payload.hostPreview === 'object' ? payload.hostPreview : {};
        const candidateData = payload.recall?.candidates || hostPreview.candidates || [];
        const candidates = Array.isArray(candidateData) ? candidateData : [];
        this.recallResults = candidates.map(candidate => ({
            ...(candidate.jjum || candidate),
            recallReason: candidate.reasons
        }));
        this.answerGuide = hostPreview.guide || payload.answerGuide || payload.recall?.answerGuide || null;
        const resultSnapshot = {
            conversationId: request.conversationId,
            utteranceId: request.turns[0].utteranceId,
            candidates: this.recallResults.map((jjum, index) => ({
                jjumId: jjum.jjumId || '',
                name: jjum.jjumName || jjum.name || candidates[index]?.jjumName || candidates[index]?.name || '이름 없는 쩜',
                summary: jjum.summary || '',
                reasons: candidates[index]?.reasons || jjum.recallReason || [],
                tags: jjum.jjtags || jjum.tags || [],
                relations: (jjum.seons || candidates[index]?.relations || []).map(relation => ({
                    targetId: relation.targetId || '',
                    targetName: this.allJJums.find(item => item.jjumId === relation.targetId)?.jjumName || '',
                    label: relation.label || ''
                }))
            })),
            topics: Array.isArray(hostPreview.topics) ? hostPreview.topics : [],
            newJJums: Array.isArray(hostPreview.newJJums) ? hostPreview.newJJums : Array.isArray(hostPreview.newJjums) ? hostPreview.newJjums : Array.isArray(payload.newJJums) ? payload.newJJums : [],
            guide: hostPreview.guide || payload.answerGuide || payload.recall?.answerGuide || null,
            at: Date.now()
        };
        let listRefreshed = true;
        try { await this.loadLocalServerData(); }
        catch { listRefreshed = false; }
        if (listRefreshed) {
            // Newly created relation targets become available only after refreshing the stored list.
            resultSnapshot.candidates.forEach(candidate => candidate.relations.forEach(relation => {
                relation.targetName = this.allJJums.find(item => item.jjumId === relation.targetId)?.jjumName || relation.targetName;
            }));
        }
        this.status = "resting";
        this.statusText = listRefreshed ? "대화를 보냈어요" : '대화는 보냈지만 기억 목록을 새로고침하지 못했어요.';
        message.notice = listRefreshed ? '' : this.statusText;
        this.selectedHistoryResult = null;
        this.selectedResultAnchor = null;
        this.latestResult = resultSnapshot;
        this.previewState = 'success';
        const historyPanel = document.querySelector('.conversation-history');
        this.pendingConversationScroll = !historyPanel || historyPanel.scrollHeight - historyPanel.scrollTop - historyPanel.clientHeight <= 48;
        this.conversationHistory.push({ type: 'result', ...resultSnapshot, scope: message.scope, count: resultSnapshot.candidates.length });
        const currentInput = document.getElementById("userInput");
        if (!this.selectedTestHost && !retry && !this.isComposing && message.draftVersion === this.draftVersion && currentInput && currentInput.value.trim() === text) currentInput.value = "";
        this.sending = false;
        await this.waitForConversationComposition();
        this.render();
    } catch (error) {
        if (tokenTurnStarted) this.trackTokenTurn('fail', message.scope, request);
        if (tokenTurnStarted && !usageReceived && usageEpoch === this.conversationScopeEpoch &&
            HAEMA_CONVERSATION_SESSION.sameScope(message.scope, this.getConversationScope())) {
            await this.restoreTokenUsage(message.scope, request.conversationId, usageEpoch);
        }
        this.latestResult = null;
        this.previewState = accepted ? 'result-error' : 'error';
        this.recallResults = [];
        this.answerGuide = null;
        const errorText = error.name === 'TypeError' || error.name === 'SyntaxError'
            ? '응답을 확인하지 못했어요. 연결 상태를 확인하고 다시 보내기를 눌러 주세요.'
            : error.message || '대화 처리에 실패했습니다.';
        message.failed = !accepted;
        message.error = accepted ? '' : error.code === 'USAGE_LIMIT' ? '사용량 한도를 확인해 주세요.' : errorText;
        if (error.code === 'CONVERSATION_SESSION') {
            this.conversationSessionError = error.message;
            this.conversationPersistenceBlocked = true;
        }
        this.sending = false;
        this.status = "error";
        this.statusText = accepted ? '대화는 보냈지만 결과를 표시하지 못했어요. 기억 목록을 다시 확인해 주세요.' : error.code === "USAGE_LIMIT"
            ? "⚠️ API 사용량 한도 초과: 사용량·결제 상태를 확인하거나 다른 키/모델로 바꿔주세요."
            : "⚠️ " + errorText;
        if (accepted) message.notice = this.statusText;
        await this.waitForConversationComposition();
        const currentInput = document.getElementById("userInput");
        if (!this.selectedTestHost && accepted && !retry && !this.isComposing && message.draftVersion === this.draftVersion && currentInput && currentInput.value.trim() === text) currentInput.value = "";
        this.render();
    }
};


HAEMA_CONSOLE.handleClear = function() {
    const input = document.getElementById("userInput");
    if (input) input.value = "";
    if (this.selectedTestHost) { globalThis.HAEMA_TEST_HOST.setDraft(''); this.render(); return; }
    this.draftVersion += 1;
    this.lastInputValue = '';
    this.incrementalController?.sample('');
    localStorage.removeItem("haema_input");
    try { sessionStorage.removeItem(this.memoryDraftKey()); } catch {}
    this.answerGuide = null;
    this.recallResults = [];
    this.latestResult = null;
    this.selectedHistoryResult = null;
    this.selectedResultAnchor = null;
    this.previewState = 'idle';
    this.status = "resting";
    this.statusText = "해마 쉬는 중...";
    this.render();
};

// Only changed, non-composing drafts are sampled; submitting is a separate event.
HAEMA_CONSOLE.handleInput = function(inputValue) {
    if (!!this.selectedTestHost) {
        globalThis.HAEMA_TEST_HOST.setDraft(inputValue);
        this.updateInputAvailability();
        return;
    }
    this.lastInputValue = inputValue;
    try { sessionStorage.setItem(this.memoryDraftKey(), inputValue); } catch {}
    if (this.isApiKeyReady()) this.incrementalController?.sample(inputValue);
    const indicator = document.getElementById('typingIndicator');
    if (!inputValue || !inputValue.trim()) {
        if (this.typingTimer) clearTimeout(this.typingTimer);
        if (indicator) indicator.classList.remove('is-visible');
        return;
    }
    if (indicator) indicator.classList.add('is-visible');
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
        const currentIndicator = document.getElementById('typingIndicator');
        if (currentIndicator) currentIndicator.classList.remove('is-visible');
        this.typingTimer = null;
    }, 500);
};

// ===== 백그라운드 스트리밍 (논블로킹 0.5초 간격 스냅샷) =====
HAEMA_CONSOLE.startBackgroundStream = function(inputValue) {
    // 이미 타이머가 실행 중이면 무시
    if (this.backgroundStreamTimer) {
        return;
    }

    // 백그라운드 작업: 현재 입력값으로 회상 시뮬레이션 (논블로킹)
    const streamSnapshot = () => {
        if (!inputValue || !inputValue.trim()) {
            this.stopBackgroundStream();
            return;
        }

        // 가벼운 회상 시뮬레이션 (메인 스레드 블로킹 방지)_ 일단 주석처리
       /* setTimeout(() => {
            this.simulateRecall(inputValue);
        }, 0);*/
    };

    // 즉시 첫 스냅샷
    streamSnapshot();

    // 0.5초 간격으로 백그라운드 스트리밍
    this.backgroundStreamTimer = setInterval(streamSnapshot, 500);
};

// ===== 백그라운드 스트리밍 중지 =====
HAEMA_CONSOLE.stopBackgroundStream = function() {
    if (this.backgroundStreamTimer) {
        clearInterval(this.backgroundStreamTimer);
        this.backgroundStreamTimer = null;
    }
};

// @editedBy YAONG1230 2026-10-10: 폼 모달과 카드의 키보드 초점 유지
HAEMA_CONSOLE.getFocusReference = function(element) {
    if (!element) return null;
    if (element.id) return { id: element.id };
    const card = element.closest('[data-jjum-id]');
    return card && element.dataset.action ? { cardId: card.dataset.jjumId, action: element.dataset.action } : null;
};

HAEMA_CONSOLE.findFocusTarget = function(reference) {
    if (!reference) return null;
    const card = reference.cardId && [...document.querySelectorAll('[data-jjum-id]')]
        .find(element => element.dataset.jjumId === reference.cardId);
    const target = reference.id ? document.getElementById(reference.id) :
        card && [...card.querySelectorAll('[data-action]')].find(element => element.dataset.action === reference.action);
    return target && !target.disabled && target.getClientRects().length ? target : null;
};

HAEMA_CONSOLE.focusFormModal = function(overlay) {
    const target = overlay?.querySelector('.modal-body input:not(:disabled), .modal-body select:not(:disabled), .modal-body textarea:not(:disabled)') ||
        overlay?.querySelector('#modalClose');
    target?.focus({ preventScroll: true });
};

HAEMA_CONSOLE.bindFormModalKeyboard = function(overlay) {
    if (!overlay) return;
    overlay.addEventListener('keydown', event => {
        if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.closeModal();
            return;
        }
        if (event.key !== 'Tab') return;
        const controls = [...overlay.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
            .filter(element => element.tabIndex >= 0 && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
};

HAEMA_CONSOLE.openCreateModal = function() {
    this.modalReturnFocus = this.getFocusReference(document.activeElement);


    // ===== 백그라운드 공감 스트림 (Background Empathy Stream) =====
    // 타이핑 스냅샷을 백엔드 비동기 파이프라인으로 Fire-and-Forget 전송한다.
    // Event Loop를 점유하지 않으며, UI 렌더링을 최우선 처리한다.
    // 백엔드 연동 시: WebSocket/SSE를 통해 실제 이벤트 수신 가능
    HAEMA_CONSOLE.streamSnapshot = function(inputValue) {
        // 입력 검증: null, undefined, 공백 문자열 방어
        if (inputValue === null || inputValue === undefined) {
            return;
        }

        const trimmed = typeof inputValue === 'string' ? inputValue.trim() : String(inputValue);
        if (!trimmed) {
            return;
        }

        // 비동기 파이프라인: setTimeout 0으로 이벤트 루프에 양보
        setTimeout(() => {
            try {
                // 백엔드 연동 지점: HAEMA_CONSOLE.streamSnapshot(inputValue)
                // 현재는 simulateRecall을 비동기 컨텍스트에서 호출 (백엔드 연동 전)_ 일단 주석처리
                /* if (typeof this.simulateRecall === 'function') {
                    this.simulateRecall(trimmed);
                } */
            } catch (error) {
                this.handleBackendError('snapshot', error);
            }
        }, 0);
    };

    // ===== JJum 데이터 스키마 검증 =====
    // 백엔드에서 수신하는 JJum 데이터의 필수 필드 및 타입 검증
    HAEMA_CONSOLE.validateJJumSchema = function(jjum) {
        if (!jjum || typeof jjum !== 'object') {
            return { valid: false, reason: 'JJum이 객체가 아닙니다.' };
        }

        // 필수 필드 검증
        if (!jjum.jjumId || typeof jjum.jjumId !== 'string') {
            return { valid: false, reason: 'jjumId가 없거나 문자열이 아닙니다.' };
        }

        if (!jjum.jjumName) {
            return { valid: false, reason: 'jjumName이 없습니다.' };
        }

        // 선택적 필드 타입 검증 (있으면 검증)
        if (jjum.jjumName && typeof jjum.jjumName !== 'string') {
            return { valid: false, reason: 'jjumName이 문자열이 아닙니다.' };
        }
        if (jjum.type && typeof jjum.type !== 'string') {
            return { valid: false, reason: 'type이 문자열이 아닙니다.' };
        }
        if (jjum.aliases && !Array.isArray(jjum.aliases)) {
            return { valid: false, reason: 'aliases가 배열이 아닙니다.' };
        }
        if (jjum.tags && !Array.isArray(jjum.tags)) {
            return { valid: false, reason: 'tags가 배열이 아닙니다.' };
        }
        if (jjum.facts && !Array.isArray(jjum.facts)) {
            return { valid: false, reason: 'facts가 배열이 아닙니다.' };
        }
        if (jjum.seons && !Array.isArray(jjum.seons)) {
            return { valid: false, reason: 'seons가 배열이 아닙니다.' };
        }
        if (jjum.mentionCount !== undefined && typeof jjum.mentionCount !== 'number') {
            return { valid: false, reason: 'mentionCount가 숫자가 아닙니다.' };
        }
        if (jjum.firstSeen !== undefined && isNaN(Date.parse(jjum.firstSeen))) {
            return { valid: false, reason: 'firstSeen이 유효한 날짜가 아닙니다.' };
        }

        return { valid: true };
    };

    // ===== 실시간 JJum 스트리밍 업데이트 =====
    // 백엔드에서 스트리밍되어 오는 신규 JJum을 오른쪽 MAP/쩜 지도 패널에 실시간 드로우한다.
    // 네트워크 지연, 빈 데이터, 중복 데이터, 스키마 위반 등 예외 상황을 처리한다.
    HAEMA_CONSOLE.streamJJumUpdate = function(newJJum) {
        try {
            // 1. 기본 존재 검증
            if (!newJJum || typeof newJJum !== 'object') {
                return;
            }

            // 2. 스키마 검증
            const validation = this.validateJJumSchema(newJJum);
            if (!validation.valid) {
                return;
            }

            // 3. ID 추출 (jjumName 또는 jjumName 중 하나 사용)
            const jjumId = newJJum.jjumId;
            const displayName = newJJum.jjumName || '알 수 없음';

            // 4. 중복 체크: 이미 존재하는 JJum이면 스킵
            const existing = this.allJJums.find(j => j.jjumId === jjumId);
            if (existing) {
                return;
            }

            // 5. 신규 JJum 구성 (백엔드 필드명 차이 대응)
            const jjum = {
                jjumId: jjumId,
                jjumName: newJJum.jjumName || displayName,
                type: newJJum.type || 'unknown',
                tags: Array.isArray(newJJum.tags) ? newJJum.tags : [],
                summary: newJJum.summary || '',
                facts: Array.isArray(newJJum.facts) ? newJJum.facts : [],
                events: Array.isArray(newJJum.events) ? newJJum.events : [],
                seons: Array.isArray(newJJum.seons) ? newJJum.seons : [],
                mentionCount: typeof newJJum.mentionCount === 'number' ? newJJum.mentionCount : 0,
                firstSeen: newJJum.firstSeen || new Date().toISOString(),
                lastMentioned: newJJum.lastMentioned || newJJum.firstSeen || new Date().toISOString(),
                pinned: !!newJJum.pinned,
                status: newJJum.status || 'active',
                mergedFrom: Array.isArray(newJJum.mergedFrom) ? newJJum.mergedFrom : [],
                editHistory: Array.isArray(newJJum.editHistory) ? newJJum.editHistory : [],
                meta: typeof newJJum.meta === 'object' && newJJum.meta ? newJJum.meta : {},
                ownerId: newJJum.ownerId || 'demo',
                sourceService: newJJum.sourceService || 'unknown',
                schemaVersion: newJJum.schemaVersion || 3
            };

            // 6. JJum 추가 및 스트리밍 표시
            this.allJJums.push(jjum);
            this.streamingJJums.add(jjumId);

            // 7. 애니메이션 클래스 적용을 위해 재렌더링
            this.render();

            // 8. 스트리밍 완료 표시 제거 (1.2초 후)
            setTimeout(() => {
                try {
                    this.streamingJJums.delete(jjumId);
                    this.render();
                } catch (cleanupError) {
                }
            }, 1200);

        } catch (error) {
            this.handleBackendError('streamJJumUpdate', error);
        }
    };

    // ===== 백엔드 오류 처리 =====
    // 네트워크 오류, 데이터 파싱 실패 등 백엔드 관련 오류를 통합 처리한다.
    HAEMA_CONSOLE.handleBackendError = function(context, error) {

        // UI에 오류 상태 표시 (선택 사항)
        if (this.status !== 'error') {
            this.status = 'error';
            this.statusText = '백엔드 연결 오류... 🔄';
            // 오류 상태는 잠시만 표시 (3초 후 복원)
            setTimeout(() => {
                if (this.status === 'error') {
                    this.status = 'resting';
                    this.statusText = '해마 쉬는 중...';
                    this.render();
                }
            }, 3000);
        }
    };

    // ===== 백엔드 이벤트 핸들러 설정 =====
    // WebSocket 또는 SSE 연결 시 호출할 이벤트 핸들러 등록
    // 실제 백엔드 연동 시 이 함수를 호출하여 이벤트 리스너를 설정한다.
    HAEMA_CONSOLE.setupBackendHandlers = function(backendClient) {
        if (!backendClient) {
            return;
        }

        // 스트리밍 JJum 수신 핸들러
        if (typeof backendClient.onJJumStream === 'function') {
            backendClient.onJJumStream((newJJum) => {
                this.streamJJumUpdate(newJJum);
            });
        }

        // 스냅샷 응답 핸들러 (백엔드가 처리한 결과 수신)
        if (typeof backendClient.onSnapshotResponse === 'function') {
            backendClient.onSnapshotResponse((response) => {
                if (response && response.recallResults) {
                    this.recallResults = response.recallResults;
                    this.render();
                }
            });
        }

        // 연결 상태 변경 핸들러
        if (typeof backendClient.onConnectionChange === 'function') {
            backendClient.onConnectionChange((connected) => {
                this.backendConnected = connected;
                if (!connected) {
                    this.status = 'resting';
                    this.statusText = '백엔드 연결 대기 중... ⏳';
                    this.render();
                }
            });
        }
    };

    // ===== 타이핑 멈춤 감지 & 감정 상태 업데이트 =====
    // 사용자가 입력을 멈추었을 때 백엔드가 감지한 '망설임/불안' 감정 상태를 해마 상태 바에 업데이트한다.
    HAEMA_CONSOLE.detectTypingStop = function() {
        this.clearTypingStopTimer();

        // 타이핑 멈춤 감지: 망설임/불안 감정 상태 레이블 업데이트
        this.status = "working";
        this.statusText = "해마 생각 중... 💭";
        this.render();
    };

    // ===== 타이핑 멈춤 타이머 해제 =====
    HAEMA_CONSOLE.clearTypingStopTimer = function() {
        if (this.typingStopTimer) {
            clearTimeout(this.typingStopTimer);
            this.typingStopTimer = null;
        }
    };

    this.modalMode = "create";
    this.modalData = {
        jjumName: "",
        aliases: [],
        type: "인물",
        tags: [],
        summary: "",
        facts: [],
        seons: []
    };
    this.render();
    const overlay = document.getElementById("modalOverlay");
    if (overlay) {
        overlay.classList.add("active");
        overlay.style.display = "flex";
    }
};

HAEMA_CONSOLE.openApiKeyModal = function() {
    this.modalReturnFocus = this.getFocusReference(document.activeElement);
    // API 키 모달은 이제 haema-api-key-modal.js에서 담당한다.
    // 여기서는 모드만 설정하고, 실제 콘텐츠 렌더링과 저장은 분리 파일에 맡긴다.
    this.modalMode = "apiKey";
    this.modalData = {
        apiKey: "",
        provider: localStorage.getItem("haema_api_provider") || "",
        model: localStorage.getItem("haema_api_model") || "",
        baseURL: localStorage.getItem("haema_api_base_url") || "",
    };
    this.render();

    // render()로 인해 DOM이 재생성되므로, render() 이후에 이벤트 바인딩
    // setTimeout을 사용하여 DOM이 완전히 렌더링된 후 이벤트 바인딩
    setTimeout(() => {
        if (typeof HAEMA_API_KEY_MODAL !== "undefined" && typeof HAEMA_API_KEY_MODAL.bindEvents === "function") {
            HAEMA_API_KEY_MODAL.bindEvents();
        }
    }, 0);

    const overlay = document.getElementById("modalOverlay");
    if (overlay) {
        overlay.classList.add("active");
        overlay.style.display = "flex";
    }
};

HAEMA_CONSOLE.openEditModal = function(jjumId) {
    const jjum = this.allJJums.find(j => j.jjumId === jjumId);
    if (!jjum) return;
    this.modalReturnFocus = this.getFocusReference(document.activeElement);
    this.modalMode = "edit";
    this.modalData = JSON.parse(JSON.stringify(jjum));
    this.render();
    const overlay = document.getElementById("modalOverlay");
    if (overlay) {
        overlay.classList.add("active");
        overlay.style.display = "flex";
    }
};

HAEMA_CONSOLE.closeModal = function() {
    const overlay = document.getElementById("modalOverlay");
    if (overlay) {
        overlay.classList.remove("active");
        overlay.style.display = "none";
    }
    this.modalMode = null;
    this.modalData = null;
    const returnFocus = this.findFocusTarget(this.modalReturnFocus);
    this.modalReturnFocus = null;
    returnFocus?.focus({ preventScroll: true });
};

HAEMA_CONSOLE.saveModal = async function() {
    if (this.modalMode === 'introduction') {
        await HAEMA_INTRODUCTION_MODAL.save(this);
        return;
    }
    if (this.modalMode === "apiKey") {
        if (typeof HAEMA_API_KEY_MODAL !== "undefined") {
            await HAEMA_API_KEY_MODAL.saveApiKeyModal();
            await this.refreshApiStatus();
        }
        return;
    }
    if (!this.isStorageReady()) {
        await HAEMA_DIALOG.alert("먼저 저장소를 연결해주세요.", { title: '기억을 보관할 곳이 필요해요' });
        return;
    }
    const rawValue = id => document.getElementById(id)?.value || "";
    const value = id => rawValue(id).trim();
    const jjumName = value("modalJJumName");
    if (!jjumName) {
        await HAEMA_DIALOG.alert("쩜 이름을 입력해주세요.", { title: '쩜 이름을 알려주세요' });
        document.getElementById('modalJJumName')?.focus();
        return;
    }
    const now = Date.now();
    const existing = this.modalMode === "edit" ? this.modalData : null;
    // Preserve untouched structured data, including delimiters and per-fact metadata.
    // Compare the values as the browser displays them in input/textarea controls.
    const singleLineDisplay = values => (values || []).join(", ").replace(/[\r\n]/g, "");
    const originalFactsDisplay = (existing?.facts || []).map(fact => fact.text).join("\n").replace(/\r\n?/g, "\n").replace(/^\n/, "");
    const originalTags = existing?.jjtags || existing?.tags || [];
    const aliases = existing && rawValue("modalAliases") === singleLineDisplay(existing.aliases)
        ? existing.aliases || [] : value("modalAliases").split(",").map(s => s.trim()).filter(Boolean);
    const jjtags = existing && rawValue("modalTags") === singleLineDisplay(originalTags)
        ? originalTags : value("modalTags").split(",").map(s => s.trim()).filter(Boolean);
    const facts = existing && rawValue("modalFacts") === originalFactsDisplay
        ? existing.facts || [] : value("modalFacts").split("\n").filter(Boolean).map(text =>
            existing?.facts?.find(fact => fact.text === text) || { text, addedAt: now, source: "user_edit" });
    const originalSeons = (existing?.seons || []).map((seon, index) => ({ seon, line: this.formatSeonForEdit(seon, index), name: this.seonTargetForEdit(seon, index), used: false }));
    const seons = [];
    const seonLines = value("modalSeons").split("\n");
    for (let index = 0; index < seonLines.length; index++) {
        const line = seonLines[index].trim();
        if (!line) continue;
        // 수정하지 않은 쩜선은 화면 밖 대상·생략된 라벨·활성 시점을 포함해 그대로 보존한다.
        const original = originalSeons.find(item => !item.used && item.line === line);
        if (original) {
            original.used = true;
            seons.push(original.seon);
            continue;
        }
        const parts = line.split("|").map(part => part.trim());
        const [name, label, rawWeight] = parts;
        const weight = Number(rawWeight);
        let error = "";
        if (parts.length !== 3 || !name || !rawWeight || !Number.isFinite(weight) || weight < 0) {
            error = "대상이름 | 연결라벨 | 누적 점수 형식으로 입력해주세요.";
        }
        const namedTargets = this.allJJums.filter(jjum => jjum.jjumName === name || (jjum.aliases || []).includes(name));
        const hiddenTarget = originalSeons.find(item => item.name === name && !this.allJJums.some(jjum => jjum.jjumId === item.seon.targetId));
        const targetId = hiddenTarget?.seon.targetId || (namedTargets.length === 1 ? namedTargets[0].jjumId : "");
        if (!error && !targetId) {
            error = namedTargets.length > 1 ? "같은 이름의 쩜이 여러 개입니다. 구분할 수 있는 별칭을 입력해주세요." : "연결할 쩜을 찾을 수 없습니다. 대상이름 또는 별칭을 확인해주세요.";
        }
        if (error) {
            await HAEMA_DIALOG.alert("쩜선 " + (index + 1) + "번째 줄: " + error, { title: '쩜선을 확인해주세요' });
            document.getElementById("modalSeons")?.focus();
            return;
        }
        seons.push({ targetId, label: label || "연결", weight, lastActivated: now });
    }
    const payload = {
        jjumName,
        aliases,
        type: value("modalType") || "unknown",
        jjtags,
        summary: value("modalSummary"), facts, seons,
    };
    const saveBtn = document.getElementById("modalSave");
    if (saveBtn) saveBtn.disabled = true;
    let saved = false;
    try {
        const scope = this.getConversationScope();
        await this.verifyConversationScope(scope);
        const response = await HAEMA_LOCAL_CONNECTION.request(existing ? 'memory.update' : 'memory.create', {
            ownerId: scope.ownerId, ...(existing ? { jjumId: existing.jjumId } : {}), value: payload
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "쩜 저장에 실패했습니다.");
        saved = true;
        this.closeModal();
        await this.loadLocalServerData();
    } catch (error) {
        if (saved) {
            await HAEMA_DIALOG.alert('쩜은 저장했지만 기억 목록을 새로고침하지 못했어요. 저장소 연결을 확인하고 목록을 다시 불러와 주세요.', { title: '쩜은 저장했어요', tone: 'warning' });
        } else {
            await HAEMA_DIALOG.alert(error.message || "쩜 저장에 실패했습니다.", { title: '쩜을 저장하지 못했어요', tone: 'error' });
            if (saveBtn) saveBtn.disabled = false;
        }
    }
};

// ===== 시뮬레이션 로직 ===== 일단 주석처리.


// ===== 유틸리티 함수 =====
HAEMA_CONSOLE.escapeHtml = function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

HAEMA_CONSOLE.formatDate = function(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) {
        return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    } else if (days < 7) {
        return date.toLocaleDateString('ko-KR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    } else if (days < 30) {
        return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } else {
        return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    }
};

HAEMA_CONSOLE.syntaxHighlight = function(json) {
    if (typeof json !== 'string') {
        json = JSON.stringify(json, null, 2);
    }
    return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
        .replace(/: "([^"]+)"/g, ': <span class="string">"$1"</span>')
        .replace(/: (\d+\.?\d*)/g, ': <span class="number">$1</span>')
        .replace(/: (true|false)/g, ': <span class="boolean">$1</span>');
};

HAEMA_CONSOLE.safeGuideForDisplay = function(value) {
    if (Array.isArray(value)) return value.map(item => this.safeGuideForDisplay(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !/^(score|simulationScore|preferenceScore)$/i.test(key))
        .map(([key, item]) => [key, this.safeGuideForDisplay(item)]));
};

// 기존 응답 가이드의 사용자용 문구만 표시한다. ID와 내부 JSON을 화면에 덤프하지 않는다.
HAEMA_CONSOLE.renderResponseGuide = function(guide) {
    if (typeof guide === 'string') return '<p>' + this.escapeHtml(guide) + '</p>';
    if (!guide || typeof guide !== 'object') return '';
    const textItems = value => (Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string' && item.trim());
    const sections = Array.isArray(guide) ? [['응답 가이드', textItems(guide)]] : [
        ['대화 방향', textItems(guide.mode)],
        ['답변 방향', textItems(guide.allowed)],
        ['공감할 내용', textItems(guide.comfortCues)],
        ['주의할 내용', textItems(guide.forbidden)],
        ['확인할 내용', textItems((Array.isArray(guide.followUpQuestions) ? guide.followUpQuestions : []).map(question => typeof question === 'string' ? question : question?.prompt))]
    ];
    return sections.filter(([, items]) => items.length).map(([title, items]) =>
        '<div class="response-guide-section"><div class="result-detail-label">' + title + '</div><ul>' + items.map(item => '<li>' + this.escapeHtml(item) + '</li>').join('') + '</ul></div>'
    ).join('') || '<p>응답 가이드가 전달됐어요.</p>';
};

HAEMA_CONSOLE.renderConversationResult = function(item) {
    const key = this.getResultSelectionKey(item);
    const selected = this.getPreviewResult() === item;
    const time = this.getResultTime(item);
    const usageBadge = item.conversationId && item.utteranceId && typeof HAEMA_TOKEN_METER !== 'undefined'
        ? HAEMA_TOKEN_METER.badge(this.getTokenUsageStore()?.turn(item.scope, item.conversationId, item.utteranceId)) : '';
    return '<button class="haema-history-card haema-result-option' + (selected ? ' is-selected' : '') + '" id="history-' + key + '" type="button" data-result-key="' + key + '" data-result-tone="' + this.getResultTone(item) + '" data-result-at="' + this.escapeHtml(String(item.at ?? '')) + '" aria-pressed="' + selected + '">' +
        '<span class="haema-history-header"><span class="haema-history-title">해마 회상 결과</span><time class="haema-history-time"' + (time.iso ? ' datetime="' + this.escapeHtml(time.iso) + '"' : '') + '>' + this.escapeHtml(time.text) + '</time></span>' +
        '<span class="haema-history-count">쩜 ' + (item.candidates || []).length + '개 발견</span>' + usageBadge + '<span class="haema-result-action">' + (selected ? '선택한 결과' : '오른쪽에서 보기 →') + '</span></button>';
};

HAEMA_CONSOLE.renderHaemaHistory = function() {
    const conversationScope = this.getConversationScope();
    const visibleHistory = this.conversationHistory.filter(item => !item.scope || HAEMA_CONVERSATION_SESSION.sameScope(item.scope, conversationScope));
    const messages = visibleHistory.map(item => {
        if (item.type === 'user') {
            const time = this.getResultTime(item);
            const timeText = time.iso ? new Date(time.iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : time.text;
            const timestamp = '<time class="message-time"' + (time.iso ? ' datetime="' + this.escapeHtml(time.iso) + '"' : '') + '>' + this.escapeHtml(timeText) + '</time>';
            if (item.incremental) {
                const labels = { queued: '전송 대기', sending: '접수 확인 중', uncertain: '접수 확인 필요' };
                const processingLabels = { pending: '접수됨 · 기억 처리 중', completed: '기억 처리 완료 · 회상 전달 대기',
                    failed: '접수됨 · 기억 처리 실패', superseded: '접수됨 · 다음 입력으로 처리 전환' };
                const notice = item.delivery === 'accepted' ? processingLabels[item.processing] || '접수됨' : labels[item.delivery] || '전송 대기';
                const retry = item.retryDelivery ? '<button class="conversation-retry" type="button" data-incremental-retry-delivery="' + this.escapeHtml(item.inputId) + '">같은 입력 다시 확인</button>' : '';
                const retryProcessing = item.retryProcessing ? '<button class="conversation-retry" type="button" data-incremental-retry-processing="' + this.escapeHtml(item.inputId) + '">기억 처리 다시 시도</button>' : '';
                const usage = typeof HAEMA_TOKEN_METER !== 'undefined' ? HAEMA_TOKEN_METER.badge(this.getTokenUsageStore()?.turn(item.scope, item.conversationId, item.inputId)) : '';
                return '<div class="message-row user"><div class="message-stack">' + timestamp + '<div class="message-bubble">' + (usage ? '<span class="message-meta">' + usage + '</span>' : '') +
                    this.escapeHtml(item.text) + '<span class="message-meta">' + this.escapeHtml(item.error || notice) + '</span>' + retry + retryProcessing + '</div></div></div>';
            }
            const retry = item.failed && !item.acknowledged && item.request ? '<button class="conversation-retry" type="button" data-retry-utterance="' + this.escapeHtml(item.request.turns[0].utteranceId) + '"' + (this.sending ? ' disabled' : '') + '>다시 보내기</button>' : '';
            return '<div class="message-row user"><div class="message-stack">' + timestamp + '<div class="message-bubble' + (item.failed ? ' message-error' : '') + '">' + this.escapeHtml(item.text) + (item.failed || item.notice ? '<span class="message-meta">' + this.escapeHtml(item.error || item.notice || '') + '</span>' : '') + retry + '</div></div></div>';
        }
        if (item.type === 'result') return this.renderConversationResult(item);
        return '';
    }).join('');
    const empty = visibleHistory.length ? '' : '<div class="conversation-empty"><span class="conversation-empty-mark">~</span><strong>해마와 대화를 시작해 보세요</strong><br>보낸 메시지는 이곳에 차곡차곡 쌓여요.</div>';
    const sessionError = this.conversationSessionError ? '<p class="conversation-session-error" role="alert">' + this.escapeHtml(this.conversationSessionError) + '</p>' : '';
    const sessionNotice = this.conversationSessionNotice ? '<p class="message-meta" role="status">' + this.escapeHtml(this.conversationSessionNotice) + '</p>' : '';
    const incrementalError = this.incrementalState?.error;
    const incrementalNotice = (incrementalError ? '<p class="conversation-session-error" role="alert">' + this.escapeHtml(incrementalError.message) +
        ' <button class="conversation-retry" id="incrementalRefreshBtn" type="button">연결 다시 확인</button></p>' : '') +
        (this.incrementalListWarning ? '<p class="message-meta" role="status">' + this.escapeHtml(this.incrementalListWarning) + '</p>' : '');
    return sessionError + sessionNotice + incrementalNotice + empty + messages;
};

HAEMA_CONSOLE.renderToolbarContent = function(icon, label, connected, isApiLabel = false) {
    return '<span class="tool-button-content"><span class="tool-button-icon" aria-hidden="true">' +
        this.escapeHtml(icon) + '</span><span class="tool-button-separator" aria-hidden="true">:</span>' +
        '<span class="tool-button-label' + (isApiLabel ? ' api-key-label' : '') + '">' + this.escapeHtml(label) + '</span>' +
        '<span class="tool-button-status" aria-hidden="true">' + (connected ? '✅' : '❌') + '</span></span>';
};

HAEMA_CONSOLE.formatApiButtonLabel = function(value) {
    const text = typeof value === 'string' ? value : '';
    const limit = /^[\x00-\x7f]*$/.test(text) ? 5 : 3;
    const characters = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text), item => item.segment)
        : Array.from(text);
    return characters.length > limit ? characters.slice(0, limit).join('') + '...' : text;
};

HAEMA_CONSOLE.renderIntroductionButton = function() {
    if (typeof HAEMA_INTRODUCTION_MODAL === 'undefined') return '';
    const markup = HAEMA_INTRODUCTION_MODAL.button(this);
    const template = document.createElement('template');
    template.innerHTML = markup;
    const button = template.content.querySelector('#introductionBtn');
    const label = button?.querySelector('.tool-button-label');
    if (!button || !label || button.querySelector('.tool-button-content')) return markup;
    const name = label.textContent.replace(/^👤\s*:\s*/, '');
    const connected = button.classList.contains('is-connected');
    label.outerHTML = this.renderToolbarContent('👤', name, connected);
    button.setAttribute('aria-label', '자기소개: ' + name + (connected ? ', 저장됨' : ', 미설정'));
    return template.innerHTML;
};

HAEMA_CONSOLE.renderLeftPanel = function() {
    this.syncConversationPending();
    const test = !!this.selectedTestHost;
    const inputValue = test ? globalThis.HAEMA_TEST_HOST.state.draft : this.readMemoryDraft();
    const editor = this.escapeHtml(this.chatEditorKey());
    const placeholder = test ? '선택한 호스트에게 메시지를 입력하세요.' : '챗봇AI와 대화하는 것처럼 입력해주세요.';
    const isInputDisabled = !this.isStorageReady() || !this.isApiKeyReady();
    const storageLabel = this.storageConnected ? '연결' : '없음';
    const apiLabel = this.apiConfigured ? this.formatApiButtonLabel(this.apiKeyName || '설정') : '없음';
    const storageTitle = this.storageConnected ? '저장소 연결됨' : '저장소 연결하기';
    const apiTitle = this.apiConfigured ? 'AI 연결 설정됨' + (this.apiKeyName ? ': ' + this.apiKeyName : '') : 'AI 연결 설정';
    const storageBtn = '<button class="tool-button' + (this.storageConnected ? ' is-connected' : '') + '" id="storageBtn" type="button" title="' + this.escapeHtml(storageTitle) + '" aria-label="' + this.escapeHtml(storageTitle) + '"><span class="tool-button-art is-default" aria-hidden="true" style="--button-art:url(Resources/haema-design/button-raster-4x/storage-default.png);border-image-source:var(--button-art)"></span><span class="tool-button-art is-hover has-glow" aria-hidden="true" style="--button-art:url(Resources/haema-design/button-raster-4x/storage-hover-glow.png);border-image-source:var(--button-art)"></span><span class="tool-button-art is-hover" aria-hidden="true" style="--button-art:url(Resources/haema-design/button-raster-4x/storage-hover.png);border-image-source:var(--button-art)"></span><span class="tool-button-art is-connected-hover" aria-hidden="true" style="--button-art:url(Resources/haema-design/button-raster-4x/storage-connected-glow.png);border-image-source:var(--button-art)"></span>' + this.renderToolbarContent('🪣', storageLabel, this.storageConnected) + '</button>';
    const apiBtn = '<button class="tool-button api-key-button' + (this.apiConfigured ? ' is-connected' : '') + '" id="apiKeyBtn" type="button" title="' + this.escapeHtml(apiTitle) + '" aria-label="' + this.escapeHtml(apiTitle) + '"><span class="tool-button-art is-default" aria-hidden="true" style="--button-art:url(Resources/haema-design/button-raster-4x/key-default.png);border-image-source:var(--button-art)"></span><span class="tool-button-art is-hover" aria-hidden="true" style="--button-art:url(Resources/haema-design/button-raster-4x/key-hover.png);border-image-source:var(--button-art)"></span><span class="tool-button-art is-hover tool-button-glow" aria-hidden="true" style="--button-art:url(Resources/haema-design/button-raster-4x/key-hover-glow.png);border-image-source:var(--button-art)"></span><span class="tool-button-art is-connected-hover" aria-hidden="true" style="--button-art:url(Resources/haema-design/button-raster-4x/key-connected-glow.png);border-image-source:var(--button-art)"></span>' + this.renderToolbarContent('🗝️', apiLabel, this.apiConfigured, true) + '</button>';
    const introductionBtn = this.renderIntroductionButton();
    return '<section class="panel panel-left" aria-label="대화"><div class="conversation-toolbar">' + apiBtn + storageBtn + introductionBtn + '</div>' +
        '<div class="chat-panel-art" aria-hidden="true"><span class="panel-art-slices"></span></div>' +
        '<div class="panel-viewport chat-panel-viewport"><div class="chat-panel-layout">' +
        (test ? this.renderTestHostControls() : '') +
        '<div class="conversation-history" data-scroll-key="' + (test ? 'host-history-' + this.selectedTestHost : 'history') + '" aria-live="polite">' +
        (test ? this.renderTestHostHistory() : this.renderHaemaHistory()) + '</div>' +
        '<div class="typing-indicator" id="typingIndicator" aria-live="polite"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span>입력 중</span></div>' +
        '<div class="input-area"><span class="user-avatar-frame" title="테스터"><img class="user-avatar" src="Resources/haema-design/12-user-avatar.png" width="82" height="88" alt="테스터 프로필"></span><img class="user-bubble-art" src="Resources/haema-design/15-user-bubble-shape.svg" width="646" height="47.37" alt="" aria-hidden="true"><textarea class="user-input" id="userInput" rows="1" data-editor="' + editor + '" placeholder="' + placeholder + '" aria-label="메시지 입력"' + (isInputDisabled ? ' readonly' : '') + '>' + this.escapeHtml(inputValue) + '</textarea>' +
        '<button class="send-button' + (this.sendPressed ? ' is-pressed' : '') + '" id="sendBtn" type="button" aria-label="보내기" ' + (this.sending ? 'disabled' : '') + '><img src="Resources/haema-design/08-send-button.svg" width="61" height="45" alt=""><span aria-hidden="true">↵</span></button></div></div></div></section>';
};

HAEMA_CONSOLE.renderRecallSection = function() {
    const count = this.allJJums.length;
    return '<div class="jjum-section-heading"><span class="section-title">저장된 모든 쩜</span><span class="recall-count">' + count + '개</span></div>' +
        '<div class="recall-note">선택한 회상과 별도로 저장된 쩜을 모두 보여드려요.</div>';
};

HAEMA_CONSOLE.renderModal = function() {
    const modalContent = this.modalMode && this.modalData ? this.renderModalContent() : '';
    let modeText = '';
    let titlePrefix = '';
    let saveText = '';

    if (this.modalMode === 'introduction') {
        modeText = '자기소개';
        titlePrefix = '👤 ';
        saveText = '저장';
    }

    if (this.modalMode === 'create') {
        modeText = '✨ 새 쩜(JJum) 만들기';
        titlePrefix = '✨ ';
        saveText = '✨ 만들기';
    } else if (this.modalMode === 'edit') {
        modeText = '✏️ 쩜(JJum) 수정';
        titlePrefix = '✏️ ';
        saveText = '💾 저장';
    } else if (this.modalMode === 'apiKey') {
        modeText = 'AI 연결 설정';
        titlePrefix = '🔑 ';
        saveText = '💾 저장';
    }

    return '<div class="modal-overlay' + (this.modalMode === 'introduction' ? ' introduction-modal' : '') + '" id="modalOverlay">' +
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
        '<div class="modal-header">' +
        '<div class="modal-title" id="modalTitle">' + titlePrefix + modeText + '</div>' +
        '<button class="modal-close" id="modalClose" type="button" aria-label="닫기">✕</button>' +
        '</div>' +
        '<div class="modal-body" id="modalBody">' + modalContent + '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-secondary" id="modalCancel">' + (this.modalMode === 'introduction' ? '닫기' : '취소') + '</button>' +
        '<button class="btn btn-primary" id="modalSave">' + saveText + '</button>' +
        '</div>' +
        '</div>' +
        '</div>';
};

HAEMA_CONSOLE.seonTargetForEdit = function(seon, index) {
    const target = this.allJJums.find(jjum => jjum.jjumId === seon.targetId);
    return target ? target.jjumName : '현재 목록에 없는 연결 ' + (index + 1);
};

HAEMA_CONSOLE.formatSeonForEdit = function(seon, index) {
    return this.seonTargetForEdit(seon, index) + ' | ' + (seon.label || '연결') + ' | ' + seon.weight;
};

HAEMA_CONSOLE.renderModalContent = function() {
    if (this.modalMode === 'introduction') return HAEMA_INTRODUCTION_MODAL.render(this);
    // API 키 설정 모달인 경우, 이제 haema-api-key-modal.js에서 콘텐츠를 생성한다.
    if (this.modalMode === "apiKey") {
        if (typeof HAEMA_API_KEY_MODAL !== "undefined") {
            return HAEMA_API_KEY_MODAL.renderApiKeyModalContent(this.modalData || {});
        }
    }

    // 쩜 생성/수정 모달인 경우 기존 폼 반환
    const data = this.modalData || {};

    const aliasesStr = (data.aliases || []).join(', ');
    const tagsStr = (data.jjtags || data.tags || []).join(', ');
    const factsStr = (data.facts || []).map(f => f.text).join('\n');
    const seonsStr = (data.seons || []).map((seon, index) => this.formatSeonForEdit(seon, index)).join('\n');

    return '<div class="form-group">' +
        '<label class="form-label" for="modalJJumName">쩜 이름 *</label>' +
        '<input class="form-input" id="modalJJumName" type="text" value="' + this.escapeHtml(data.jjumName || '') + '" placeholder="예: 홍길동">' +
        '<div class="form-hint">쩜의 대표 이름입니다. 어떤 이름으로 불러도 이 쩜을 찾을 수 있습니다.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalAliases">별칭 (쉼표로 구분)</label>' +
        '<input class="form-input" id="modalAliases" type="text" value="' + this.escapeHtml(aliasesStr) + '" placeholder="예: 지수, 지슈, 그 친구">' +
        '<div class="form-hint">별칭을 입력하면 그 이름으로도 쩜을 찾을 수 있습니다.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalType">유형</label>' +
        '<input class="form-input" id="modalType" type="text" list="modalTypeSuggestions" value="' + this.escapeHtml(data.type || '') + '">' +
        '<datalist id="modalTypeSuggestions"><option value="인물"><option value="장소"><option value="조직"><option value="사건"><option value="개념"><option value="사물"><option value="기타"></datalist>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalTags">태그 (Tags) (쉼표로 구분)</label>' +
        '<input class="form-input" id="modalTags" type="text" value="' + this.escapeHtml(tagsStr) + '" placeholder="예: 친구, 동료, 맛집">' +
        '<div class="form-hint">쩜을 분류하는 태그입니다. 여러 개 입력 가능.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalSummary">한 줄 요약</label>' +
        '<input class="form-input" id="modalSummary" type="text" value="' + this.escapeHtml(data.summary || '') + '" placeholder="예: 월 1~2회 만나는 친한 친구">' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalFacts">사실 (Facts) - 한 줄에 하나씩</label>' +
        '<textarea class="form-textarea" id="modalFacts" rows="3" placeholder="예: 대학교 동창이다&#10;커피를 좋아한다">' + this.escapeHtml(factsStr) + '</textarea>' +
        '<div class="form-hint">쩜에 대한 사실 정보를 한 줄에 하나씩 입력하세요.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalSeons">쩜선 (Seons) - 연결된 쩜 (한 줄에 하나씩, 형식: 대상이름 | 연결라벨 | 누적 점수)</label>' +
        '<textarea class="form-textarea" id="modalSeons" rows="3" placeholder="예: 홍길동 | 친구 | 0.8&#10;김철수 | 동료 | 0.5">' + this.escapeHtml(seonsStr) + '</textarea>' +
        '<div class="form-hint">쩜과 다른 쩜을 연결하는 선입니다. 한 줄에 하나씩, 파이프(|)로 구분하세요.</div>' +
        '</div>';
};

//HAEMA_CONSOLE.generateHostPreview _삭제

// ===== 쩜 토글 =====
HAEMA_CONSOLE.toggleJJum = function(jjumId) {
    if (this.selectedJJumId === jjumId) {
        this.selectedJJumId = null;
    } else {
        this.selectedJJumId = jjumId;
    }
    this.render();
};

// ===== 쩜 삭제 확인 =====
HAEMA_CONSOLE.confirmDelete = async function(jjumId) {
    const jjum = this.allJJums.find(j => j.jjumId === jjumId);
    if (!jjum) return;

    if (await HAEMA_DIALOG.confirm('"' + jjum.jjumName + '" 쩜을 현재 목록에서 숨깁니다.\n파일은 보존되며 새로고침하면 다시 보입니다.', { title: '이 쩜을 잠시 숨길까요?', confirmText: '숨기기' })) {
        this.allJJums = this.allJJums.filter(j => j.jjumId !== jjumId);
        if (this.selectedJJumId === jjumId) {
            this.selectedJJumId = null;
        }
        this.render();
    }
};

// ===== 초기화 =====
HAEMA_CONSOLE.init = async function() {
    try { const selected = sessionStorage.getItem('haema_test_host'); if (globalThis.HAEMA_TEST_HOST.hosts.some(host => host.id === selected)) this.selectedTestHost = selected; } catch {}
    this.render();
    if (!!this.selectedTestHost) this.activateTestHost();
    await Promise.all([
        globalThis.HAEMA_TEST_HOST.loadHosts(),
        this.refreshApiStatus(),
        typeof HAEMA_STORAGE_MODAL !== "undefined" ? HAEMA_STORAGE_MODAL.autoConnect() : Promise.resolve(),
    ]);
    this.syncConversationPending();
    this.render();
};

// 선택한 서버 저장소의 쩜을 읽고, 완료 후 다음 처리를 진행한다.
HAEMA_CONSOLE.loadLocalServerData = async function() {
    const scope = this.getConversationScope();
    const epoch = this.conversationScopeEpoch;
    if (!scope) throw new Error('연결된 저장소를 확인해 주세요.');
    await this.verifyConversationScope(scope);
    const response = await HAEMA_LOCAL_CONNECTION.request('memory.list', { ownerId: scope.ownerId });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '저장소를 읽을 수 없습니다.');
    await this.verifyConversationScope(scope);
    if (epoch !== this.conversationScopeEpoch || !HAEMA_CONVERSATION_SESSION.sameScope(scope, this.getConversationScope())) throw new Error('저장소가 바뀌어 이전 목록은 적용하지 않았어요.');
    if (!Array.isArray(data.jjums)) throw new Error('기억 목록을 확인하지 못했어요.');
    this.allJJums = data.jjums;
    this.render();
    return this.allJJums;
};

// 쩜 목록 업데이트 함수
HAEMA_CONSOLE.updateJJumList = function(jjums) {
    this.allJJums = jjums || [];
    this.render();
};

// ===== 연쇄적 쩜선 확장 ===== 지움



HAEMA_CONSOLE.findMentionedJJums = function(inputValue) {
    const lowerInput = inputValue.toLowerCase();
    const mentioned = [];

    this.allJJums.forEach(jjum => {
        const name = (jjum.jjumName || '').toLowerCase();
        const aliases = (jjum.aliases || []).map(a => a.toLowerCase());

        if (lowerInput.includes(name) || aliases.some(a => lowerInput.includes(a))) {
            mentioned.push(jjum);
        }
    });

    return mentioned;
};


//HAEMA_CONSOLE.inferSeonLabel - 지움.


//HAEMA_CONSOLE.createDerivativeJJums 지움.

// ===== 다정한 대화 가이드 제공 ===== 지움.

//HAEMA_CONSOLE.generateHostPreview = 지움.


HAEMA_CONSOLE.mount = async function() {
    // API 키 모달 분리 파일에 콘솔 참조를 전달한다.
    // 분리 파일에서 저장 완료 후 상태 텍스트 갱신이나 render() 호출 시 사용한다.
    if (typeof HAEMA_API_KEY_MODAL !== "undefined" && typeof HAEMA_API_KEY_MODAL.setConsole === "function") {
        HAEMA_API_KEY_MODAL.setConsole(HAEMA_CONSOLE);
    }

    // 저장소 모달 분리 파일에 콘솔 참조를 전달한다.
    if (typeof HAEMA_STORAGE_MODAL !== "undefined" && typeof HAEMA_STORAGE_MODAL.setConsole === "function") {
        HAEMA_STORAGE_MODAL.setConsole(HAEMA_CONSOLE);
    }

    await HAEMA_CONSOLE.init();
    let previous = HAEMA_LOCAL_CONNECTION.status();
    HAEMA_LOCAL_CONNECTION.subscribe(state => {
        const wasReady = previous.aiReady;
        previous = state;
        this.localConnectionState = state;
        if (state.connection !== 'connected') {
            this.storageConnected = false;
            this.apiConfigured = false;
            this.incrementalController?.stop();
            this.incrementalController = null;
        } else if (!state.aiReady) {
            this.incrementalController?.stop();
            this.incrementalController = null;
        }
        if (state.aiReady && !wasReady) this.syncConversationPending();
        this.render();
    });
};


HAEMA_CONSOLE.memoryDraftKey = function() {
    const scope = this.getConversationScope();
    const conversationId = scope && this.conversationSession ? this.conversationSession.ensure(scope) : null;
    return 'haema_memory_draft:' + JSON.stringify(['haema-only', scope?.storageId ?? null, scope?.ownerId ?? null, conversationId]);
};
HAEMA_CONSOLE.readMemoryDraft = function() {
    try { return sessionStorage.getItem(this.memoryDraftKey()) ?? (!this.getConversationScope() ? localStorage.getItem('haema_input') : '') ?? ''; }
    catch { return this.lastInputValue || ''; }
};
