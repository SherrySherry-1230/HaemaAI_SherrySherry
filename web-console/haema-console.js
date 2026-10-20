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
// HAEMA_CONSOLE - 해마.AI 콘솔 애플리케이션
HAEMA_CONSOLE = {
    status: 'resting',
    statusText: '해마 쉬는 중...',
    recallResults: [],
    answerGuide: null,
    latestResult: null,
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
    conversationScopeEpoch: 0,
    conversationSessionError: '',
    conversationSessionNotice: '',
    conversationPersistenceBlocked: false,
    activeConversationScope: null,
    draftVersion: 0,
    activeMobilePanel: 'chat',
    typingTimer: null,
    isComposing: false,
    apiKeyName: '',

    // 쩜 데이터는 외부에서 주입하거나 모달로 추가한다.
    // 초기 샘플 데이터는 넣지 않는다.

};

// ===== 렌더링 함수 =====
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
    const storageOverlay = document.getElementById('storageModalOverlay');
    const sameModal = this.renderedModalMode === this.modalMode && this.renderedModalData === this.modalData;
    const modalDrafts = (sameModal ? [...document.querySelectorAll('.modal-overlay.active input, .modal-overlay.active textarea, .modal-overlay.active select')] : [])
        .filter(node => node.id).map(node => [node.id,
            node.id === 'modalApiModel' ? node.value || node.dataset.selectedModel || '' : node.value,
            node.selectionStart, node.selectionEnd, node.selectionDirection]);

    app.innerHTML = this.renderHeader() + this.renderMainContainer() + this.renderModal();
    if (typeof HAEMA_TOKEN_METER !== 'undefined' && typeof HAEMA_TOKEN_METER.animate === 'function') {
        const scope = this.getConversationScope();
        HAEMA_TOKEN_METER.animate(app, scope ? JSON.stringify([scope.ownerId, scope.storageRoot, scope.storageId ?? null]) : '');
    }
    this.renderedModalMode = this.modalMode;
    this.renderedModalData = this.modalData;
    if (storageOverlay) app.appendChild(storageOverlay);

    // 입력창 값 복원
    const restoredInput = document.getElementById("userInput");
    if (restoredInput && preservedValue !== undefined) {
        restoredInput.value = preservedValue;
        if (preservedFocus) {
            restoredInput.focus();
            if (selection) restoredInput.setSelectionRange(selection[0], selection[1], selection[2]);
        }
    }
    scrollPositions.forEach(([key, top, left]) => {
        const node = [...document.querySelectorAll('[data-scroll-key]')].find(item => item.dataset.scrollKey === key);
        if (node) { node.scrollTop = top; node.scrollLeft = left; }
    });
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
        '<div class="header-left">',
        '<div class="logo-icon"><img src="Resources/haema-design/11-haema-logo.svg" width="89" height="101" alt="해마 로고"></div>',
        '<div class="brand-copy"><div class="header-title">해마.ai</div><p class="header-subtitle">당신의 기억을 보존하고,<br>필요한 순간 다시 연결합니다.</p><p class="header-subtitle">인공지능의 인공 해마.<br>당신을 기억하게 하세요.</p></div>',
        '</div>',
        '<div class="header-right">',
        '<a class="repo-link" href="https://github.com/sherry1230/HaemaAI_SherrySherry" target="_blank" rel="noreferrer">GitHub 저장소</a>',
        '<div class="status-bar"><img class="status-art" src="Resources/haema-design/17-haema-status-pill.svg" width="161.83" height="26" alt=""><span class="status-emojis">' + emojis + '</span><span class="status-text">' + this.escapeHtml(this.statusText) + '</span></div>',
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
    return '<section class="panel panel-right" aria-label="해마 기억 목록"><div class="right-panel-art" aria-hidden="true"><img src="Resources/haema-design/18-haema-panel-shape.svg" width="726.119" height="847" alt=""></div>' + this.renderTransmissionStatus() + '<div class="panel-heading">' +
        '<div><h1 class="panel-title">해마의 기억</h1><div class="panel-caption">저장된 쩜과 연결을 확인해요</div></div>' +
        '<div class="jjum-list-tools"><span class="jjum-list-count" title="최근 저장순">모든 쩜 ' + (this.allJJums || []).length + '</span><div class="create-btn-wrapper"><button class="btn btn-create" id="createJJumBtn">+ 새 쩜(JJum) 만들기</button></div></div>' +
        '</div>' + this.renderHostPreview() +
        '<div class="haema-scroll" data-scroll-key="haema">' + this.renderRecallSection() + this.renderJJumListSection() + '</div></section>';
};

HAEMA_CONSOLE.renderTransmissionStatus = function() {
    let label = this.statusText;
    if (label === '대화를 보내고 있어요') label = '전송 중';
    else if (label === '대화를 보냈어요') label = '전송 완료';
    else if (label === '대화는 보냈지만 결과를 표시하지 못했어요. 기억 목록을 다시 확인해 주세요.') label = '전송 완료 · 확인 필요';
    const detail = label === this.statusText ? label : label + ' · ' + this.statusText;
    return '<div class="top-state-area" data-figma-frame="top_State_Area"><div class="haema-status-pill status-' + this.status + '" role="status" aria-live="polite" aria-atomic="true" aria-label="' + this.escapeHtml(detail) + '" title="' + this.escapeHtml(detail) + '">' +
        '<span class="status-emojis" aria-hidden="true">' + this.getStatusEmojis() + '</span><span class="status-text">' + this.escapeHtml(label) + '</span></div></div>';
};

HAEMA_CONSOLE.getTopicName = function(topic) {
    if (typeof topic === 'string') return topic;
    return topic?.jjum?.jjumName || topic?.jjumName || topic?.name || topic?.topic || '';
};

HAEMA_CONSOLE.renderHostPreview = function() {
    const state = this.previewState;
    const result = state === 'success' ? this.latestResult : null;
    let body = '<p class="haema-preview-summary">대화를 보내면 호스트에게 전달할 기억을 확인할 수 있어요.</p>';
    if (state === 'loading') {
        body = '<p class="haema-preview-summary">이번 대화의 기억을 확인하고 있어요.</p>';
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
            body += '<div class="haema-preview-chips">' + candidates.slice(0, 3).map(candidate =>
                '<span class="haema-preview-chip"' + (candidate.summary ? ' title="' + this.escapeHtml(candidate.summary) + '"' : '') + '>' + this.escapeHtml(this.maskJJumName(candidate.name)) + '</span>'
            ).join('') + (candidates.length > 3 ? '<span class="haema-preview-more">외 ' + (candidates.length - 3) + '개</span>' : '') + '</div>';
        }
        if (topics.length) {
            body += '<p class="haema-preview-topics">주제 · ' + topics.slice(0, 2).map(topic => this.escapeHtml(topic)).join(' · ') + (topics.length > 2 ? ' 외 ' + (topics.length - 2) + '개' : '') + '</p>';
        }
        body += '<button class="haema-preview-details" id="previewDetailsBtn" type="button">' + (result.guide ? '응답 가이드 · 결과 보기' : '결과 보기') + '</button>';
    }
    const meter = typeof HAEMA_TOKEN_METER !== 'undefined' ? HAEMA_TOKEN_METER.render(this.readTokenUsage(), state === 'loading') : '';
    return '<div class="haema-preview' + (meter ? ' has-token-meter' : '') + '" data-preview-state="' + state + '"><span class="haema-preview-background" aria-hidden="true"></span>' +
        '<span class="haema-preview-avatar" aria-hidden="true"><img src="Resources/haema-design/haema-preview-character.png" width="244" height="441" alt=""></span>' +
        '<div class="haema-preview-content"><div class="haema-preview-heading"><strong class="haema-preview-title">호스트에게 전달할 기억</strong></div><div class="haema-preview-body">' + body + '</div>' + meter + '</div></div>';
};

HAEMA_CONSOLE.openLatestResult = function() {
    if (!this.latestResult || this.previewState !== 'success') return;
    this.activeMobilePanel = 'chat';
    this.render();
    const cards = [...document.querySelectorAll('.haema-history-card')];
    const card = cards.reverse().find(item => item.dataset.resultAt === String(this.latestResult.at));
    if (!card) return;
    card.open = true;
    const guide = card.querySelector('.guide-detail');
    if (guide) guide.open = true;
    card.scrollIntoView({ block: 'nearest' });
    card.querySelector('summary')?.focus({ preventScroll: true });
};

// @editedBy YAONG1230 2026-10-16: Figma 52:547 / 25:46 / 49:526, 내부 스크롤
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
        const name = String(jjum.jjumName || '이름 없는 쩜');
        const visibleName = isExpanded ? name : this.maskJJumName(name);
        const aliases = Array.isArray(jjum.aliases) ? jjum.aliases : [];
        const tags = Array.isArray(jjum.jjtags) ? jjum.jjtags : Array.isArray(jjum.tags) ? jjum.tags : [];
        const metadata = [
            ...aliases.map(alias => ({ label: '별명', text: isExpanded ? alias : this.maskJJumName(alias) })),
            ...(jjum.type ? [{ label: '유형', text: jjum.type }] : []),
            ...tags.map(tag => ({ label: '태그', text: tag }))
        ];
        const chip = item => '<span class="jjum-chip is-' + ({ '별명': 'alias', '유형': 'type', '태그': 'tag' })[item.label] + '" style="--chip-outline:url(\'Resources/haema-design/' + parts[2] + '\')"><span class="sr-only">' + item.label + ': </span><span>' + escape(item.text) + '</span></span>';
        const metadataHtml = metadata.map(chip).join('');
        const nameHtml = '<span class="jjum-name" style="--name-shape:url(\'Resources/haema-design/' + parts[1] + '\')"><span>' + escape(visibleName) + '</span></span>';
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
        const seons = (Array.isArray(jjum.seons) ? jjum.seons : []).map(relation => {
            const target = jjums.find(item => item.jjumId === relation.targetId);
            // 공개 계약의 0~1 관계 강도만 표시한다. 추천 점수/추천 단계로 환산하지 않는다.
            const weight = typeof relation.weight === 'number' && Number.isFinite(relation.weight) && relation.weight >= 0 && relation.weight <= 1
                ? Math.round(relation.weight * 100) : null;
            return '<div class="seon-item"><span class="seon-target">' + escape(target?.jjumName || '목록 밖의 쩜') + '</span><span class="seon-label">' + escape(relation.label || '연결') + '</span>' +
                (weight === null ? '' : '<span class="seon-strength" aria-label="연결 강도 ' + weight + '%"><span class="seon-weight-bar"><span class="seon-weight-fill" style="width:' + weight + '%"></span></span>' + weight + '%</span>') + '</div>';
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
            '<span class="jjum-card-art" style="--card-shape:url(\'Resources/haema-design/jjum-display/' + shapeAsset + '\')" aria-hidden="true"></span>' +
            '<div class="jjum-card-scroll"' + (isExpanded ? ' tabindex="0" role="region" aria-label="' + escape(name) + ' 전체 정보" data-scroll-key="jjum:' + escape(id) + '" id="jjum-scroll-' + regionKey + '"' : '') + '>' +
            '<button class="jjum-card-head" type="button" data-action="toggle" aria-expanded="' + isExpanded + '"' + (isExpanded ? ' aria-controls="' + detailsId + '"' : '') + ' aria-label="' + escape(visibleName) + (isExpanded ? ' 접기' : ' 펼치기') + '">' +
                '<span class="jjum-card-row">' + scoreHtml + '<span class="jjum-header-metadata">' + nameHtml + metadataHtml + '</span>' + ellipsisHtml + '</span>' +
                (isExpanded ? '' : summaryHtml) + '</button>' + detailsHtml + '</div>' +
            '<button class="jjum-expand" type="button" data-action="toggle" aria-expanded="' + isExpanded + '" aria-label="' + escape(visibleName) + (isExpanded ? ' 접기' : ' 펼치기') + '"><img src="Resources/haema-design/card-toggle/' + (isExpanded ? 'collapse-' : 'expand-') + state + '.svg" width="29.3827" height="17.0097" alt=""></button></article>';
    }).join('');
    const connectorsHtml = sortedJJums.flatMap(jjum => (jjum.seons || []).map(relation => {
        if (relation.targetId === jjum.jjumId || !sortedJJums.some(item => item.jjumId === relation.targetId)) return '';
        return '<path data-source-id="' + escape(jjum.jjumId) + '" data-target-id="' + escape(relation.targetId) + '" vector-effect="non-scaling-stroke"></path>';
    })).join('');
    return '<div class="jjum-list-section"><div class="jjum-list">' + (connectorsHtml ? '<svg class="seon-connections" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + connectorsHtml + '</svg>' : '') + accordionHtml + '</div></div>';
};

// 카드가 펼쳐지거나 화면 폭이 달라져도 실제 쩜의 위치를 따라가는 부드러운 곡선.
HAEMA_CONSOLE.updateSeonLayout = function() {
    const list = document.querySelector('.jjum-list');
    const drawing = list?.querySelector('.seon-connections');
    if (!drawing) return;
    const listRect = list.getBoundingClientRect();
    if (listRect.width <= 0 || listRect.height <= 0) return;
    drawing.setAttribute('viewBox', '0 0 ' + listRect.width + ' ' + listRect.height);
    const cards = new Map([...list.querySelectorAll('.jjum-card')].map(card => [card.dataset.jjumId, card]));
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
        routes.push({ path, startX, startY, endX, endY, anchorX, span: Math.abs(endY - startY), room: Math.max(0, listRect.width - anchorX - 4) });
    });
    if (!routes.length) return;
    routes.sort((a, b) => a.span - b.span);
    const groups = [];
    routes.forEach(route => {
        const previous = groups[groups.length - 1];
        if (previous && Math.abs(previous[0].span - route.span) < 0.01) previous.push(route);
        else groups.push([route]);
    });
    const maxLane = Math.min(64, ...routes.map(route => route.room));
    const minLane = Math.min(18, maxLane);
    const lastGroup = groups[groups.length - 1];
    const maxRank = groups.length - 1 + (lastGroup.length > 1 ? 0.08 : 0);
    groups.forEach((group, groupIndex) => group.forEach((route, duplicateIndex) => {
        // 짧은 연결부터 안쪽에 놓고, 같은 길이의 연결만 작은 간격으로 나눈다.
        const duplicateOffset = group.length > 1 ? duplicateIndex / (group.length - 1) * 0.08 : 0;
        const lane = groups.length === 1
            ? Math.min(maxLane, minLane + duplicateIndex * 2)
            : minLane + (maxLane - minLane) * (groupIndex + duplicateOffset) / maxRank;
        const curveX = route.anchorX + lane * 4 / 3;
        route.path.setAttribute('d', 'M ' + route.startX + ' ' + route.startY + ' C ' + curveX + ' ' + route.startY + ', ' + curveX + ' ' + route.endY + ', ' + route.endX + ' ' + route.endY);
    }));
};

// 접힘의 한 줄에는 테두리까지 온전히 들어가는 정보만 두고, 나머지는 펼침에서 읽는다.
HAEMA_CONSOLE.updateJJumMetadataLayout = function() {
    const scroll = document.querySelector('.haema-scroll');
    const panelArt = document.querySelector('.right-panel-art');
    if (scroll && panelArt) {
        const artBounds = panelArt.getBoundingClientRect();
        const scrollBounds = scroll.getBoundingClientRect();
        scroll.style.setProperty('--list-mask-width', artBounds.width + 'px');
        scroll.style.setProperty('--list-mask-height', artBounds.height + 'px');
        scroll.style.setProperty('--list-mask-left', artBounds.left - scrollBounds.left + 'px');
    }
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
    // The server connection is shared: do not switch this tab's storage during a send.
    if (storageBtn) storageBtn.disabled = this.sending;
    if (clearBtn) clearBtn.addEventListener("click", () => this.handleClear());
    if (createBtn) createBtn.addEventListener("click", () => this.openCreateModal());
    document.getElementById('previewDetailsBtn')?.addEventListener('click', () => this.openLatestResult());
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
    if (inputArea) {
        inputArea.addEventListener("click", (e) => {
            const disabledOverlay = e.target.closest(".input-disabled-overlay");
            if (disabledOverlay) {
                this.handleInputAreaClick();
                return;
            }

            const input = document.getElementById("userInput");
            if (e.target.id === "userInput") {
                if (input && input.disabled) {
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
    if (userInput) {
        userInput.addEventListener("compositionstart", () => { this.isComposing = true; });
        userInput.addEventListener("compositionend", (e) => {
            this.isComposing = false;
            this.handleInput(e.target.value);
            if (this.deferredCompositionRender) this.render();
        });
        userInput.addEventListener("input", (e) => { this.draftVersion += 1; if (!this.isComposing) this.handleInput(e.target.value); });
        userInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !this.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                if (!e.repeat) this.activateSend();
            }
        });
    }
};

// ===== 저장소/API 키 준비 상태 체크 =====
HAEMA_CONSOLE.isStorageReady = function() {
    return this.storageConnected === true;
};

HAEMA_CONSOLE.isApiKeyReady = function() {
    return this.apiConfigured === true;
};

HAEMA_CONSOLE.refreshApiStatus = async function() {
    try {
        const response = await fetch("/api/config/status");
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
        localStorage.setItem("haema_api_configured", "false");
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

    userInput.disabled = !isReady;
    const sendBtn = document.getElementById("sendBtn");
    if (sendBtn) sendBtn.disabled = !isReady || this.sending;

    // disabled 상태일 때 title 속성으로 안내 추가
    if (!isReady) {
        const reasons = [];
        if (!storageReady) {
            reasons.push("🪣저장소🪣 연결을 다시 확인해 주세요😢💦");
        }
        if (!apiKeyReady) {
            reasons.push("🗝️API🗝️를 다시 확인해 주세요 😢💦");
        }
        userInput.title = reasons.join("\n");
    } else {
        userInput.title = "";
    }
};

// ===== input-area 클릭 시 처리 =====
HAEMA_CONSOLE.handleInputAreaClick = async function() {
    const storageReady = this.isStorageReady();
    const apiKeyReady = this.isApiKeyReady();

    if (!storageReady && !apiKeyReady) {
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
    if (!this.storageConnected || !storageRoot) return null;
    const identity = this.storageIdentity;
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

HAEMA_CONSOLE.readTokenUsage = function() {
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
        const query = new URLSearchParams({ ownerId: scope.ownerId, conversationId });
        const response = await fetch('/api/conversation/usage?' + query, { cache: 'no-store' });
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
        if (JSON.stringify(scope) !== JSON.stringify(this.activeConversationScope)) {
            this.conversationScopeEpoch += 1;
            this.tokenUsageRestoreKey = null;
        }
        if (!scope || (this.activeConversationScope && !HAEMA_CONVERSATION_SESSION.sameScope(scope, this.activeConversationScope))) {
            this.latestResult = null;
            this.previewState = 'idle';
            this.recallResults = [];
            this.answerGuide = null;
        }
        this.activeConversationScope = scope;
        this.conversationSessionNotice = '';
        if (!scope) return;
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
    const response = await fetch('/api/storage/status', { cache: 'no-store' });
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

HAEMA_CONSOLE.handleSend = async function() {
    if (this.sending || this.isComposing) return;
    if (!this.isStorageReady() || !this.isApiKeyReady()) {
        this.handleInputAreaClick();
        return;
    }
    const input = document.getElementById("userInput");
    if (!input) return;
    const text = input.value.trim();
    if (!text) {
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
    const draftVersion = this.draftVersion;
    this.sending = true;
    this.status = 'working';
    this.statusText = '전송 준비 중이에요';
    this.render();
    try {
        const scope = this.getConversationScope();
        await this.verifyConversationScope(scope);
        const request = this.conversationSession.prepare(scope, text);
        const message = { type: 'user', text, at: request.turns[0].at, request, scope, draftVersion, failed: false };
        this.conversationHistory.push(message);
        await this.sendConversationRequest(message, false, true);
    } catch (error) {
        this.sending = false;
        this.status = 'error';
        this.statusText = error.message || '전송을 준비하지 못했어요.';
        if (error.code === 'CONVERSATION_SESSION') {
            this.conversationSessionError = this.statusText;
            this.conversationPersistenceBlocked = true;
        }
        await this.waitForConversationComposition();
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
        const response = await fetch("/api/conversation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Retrying suppresses recall touches even when the first attempt never reached the server.
            body: JSON.stringify(retry ? { ...request, touch: false } : request)
        });
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
                name: jjum.jjumName || candidates[index]?.jjumName || '이름 없는 쩜',
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
        this.latestResult = resultSnapshot;
        this.previewState = 'success';
        const historyPanel = document.querySelector('.conversation-history');
        this.pendingConversationScroll = !historyPanel || historyPanel.scrollHeight - historyPanel.scrollTop - historyPanel.clientHeight <= 48;
        this.conversationHistory.push({ type: 'result', ...resultSnapshot, scope: message.scope, count: resultSnapshot.candidates.length });
        const currentInput = document.getElementById("userInput");
        if (!retry && !this.isComposing && message.draftVersion === this.draftVersion && currentInput && currentInput.value.trim() === text) currentInput.value = "";
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
        if (accepted && !retry && !this.isComposing && message.draftVersion === this.draftVersion && currentInput && currentInput.value.trim() === text) currentInput.value = "";
        this.render();
    }
};


HAEMA_CONSOLE.handleClear = function() {
    const input = document.getElementById("userInput");
    if (input) input.value = "";
    localStorage.removeItem("haema_input");
    this.answerGuide = null;
    this.recallResults = [];
    this.latestResult = null;
    this.previewState = 'idle';
    this.status = "resting";
    this.statusText = "해마 쉬는 중...";
    this.render();
};

// 입력 표시만 제어한다. 실제 회상 요청은 전송 버튼 또는 Enter를 눌렀을 때 시작한다.
HAEMA_CONSOLE.handleInput = function(inputValue) {
    this.lastInputValue = inputValue;
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
            console.warn('[HAEMA] streamSnapshot: 입력값이 null/undefined입니다.');
            return;
        }

        const trimmed = typeof inputValue === 'string' ? inputValue.trim() : String(inputValue);
        if (!trimmed) {
            console.debug('[HAEMA] streamSnapshot: 빈 입력값 - 스냅샷 전송 생략');
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

                console.debug('[HAEMA] streamSnapshot: 스냅샷 전송 완료 -', trimmed.substring(0, 30) + (trimmed.length > 30 ? '...' : ''));
            } catch (error) {
                console.error('[HAEMA] streamSnapshot 오류:', error.message || error);
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
                console.warn('[HAEMA] streamJJumUpdate: 유효하지 않은 JJum 데이터 -', newJJum);
                return;
            }

            // 2. 스키마 검증
            const validation = this.validateJJumSchema(newJJum);
            if (!validation.valid) {
                console.warn('[HAEMA] streamJJumUpdate: 스키마 검증 실패 -', validation.reason);
                return;
            }

            // 3. ID 추출 (jjumName 또는 jjumName 중 하나 사용)
            const jjumId = newJJum.jjumId;
            const displayName = newJJum.jjumName || '알 수 없음';

            // 4. 중복 체크: 이미 존재하는 JJum이면 스킵
            const existing = this.allJJums.find(j => j.jjumId === jjumId);
            if (existing) {
                console.debug('[HAEMA] streamJJumUpdate: 중복 JJum 스킵 -', displayName);
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

            console.debug('[HAEMA] streamJJumUpdate: 신규 JJum 스트리밍 -', displayName, '(ID:', jjumId + ')');

            // 8. 스트리밍 완료 표시 제거 (1.2초 후)
            setTimeout(() => {
                try {
                    this.streamingJJums.delete(jjumId);
                    this.render();
                } catch (cleanupError) {
                    console.warn('[HAEMA] streamJJumUpdate cleanup 오류:', cleanupError.message);
                }
            }, 1200);

        } catch (error) {
            console.error('[HAEMA] streamJJumUpdate 처리 중 오류:', error.message || error);
            this.handleBackendError('streamJJumUpdate', error);
        }
    };

    // ===== 백엔드 오류 처리 =====
    // 네트워크 오류, 데이터 파싱 실패 등 백엔드 관련 오류를 통합 처리한다.
    HAEMA_CONSOLE.handleBackendError = function(context, error) {
        console.error('[HAEMA] 백엔드 오류 [' + context + ']:', error.message || error);

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
            console.warn('[HAEMA] setupBackendHandlers: backendClient가 없습니다.');
            return;
        }

        // 스트리밍 JJum 수신 핸들러
        if (typeof backendClient.onJJumStream === 'function') {
            backendClient.onJJumStream((newJJum) => {
                console.debug('[HAEMA] 백엔드 JJum 스트림 수신:', newJJum);
                this.streamJJumUpdate(newJJum);
            });
        }

        // 스냅샷 응답 핸들러 (백엔드가 처리한 결과 수신)
        if (typeof backendClient.onSnapshotResponse === 'function') {
            backendClient.onSnapshotResponse((response) => {
                console.debug('[HAEMA] 백엔드 스냅샷 응답:', response);
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
                console.debug('[HAEMA] 백엔드 연결 상태:', connected ? '연결됨' : '연결 끊김');
                if (!connected) {
                    this.status = 'resting';
                    this.statusText = '백엔드 연결 대기 중... ⏳';
                    this.render();
                }
            });
        }

        console.debug('[HAEMA] 백엔드 이벤트 핸들러 설정 완료');
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
        if (parts.length !== 3 || !name || !rawWeight || !Number.isFinite(weight) || weight < 0 || weight > 1) {
            error = "대상이름 | 연결라벨 | 가중치(0~1) 형식으로 입력해주세요.";
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
        const endpoint = "/api/owners/demo/jjums" + (existing ? "/" + encodeURIComponent(existing.jjumId) : "");
        const response = await fetch(endpoint, {
            method: existing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
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
/* HAEMA_CONSOLE.simulateRecall = function(inputText) {
    if (!inputText || !this.allJJums) {
        this.recallResults = [];
        this.render();
        return;
    }

    const words = inputText.split(/\s+/);
    const scoredJJums = this.allJJums
        .filter(jjum => jjum && jjum.jjumId)
        .map(jjum => {
        let score = 0;
        const lowerInput = inputText.toLowerCase();
        const lowerName = (jjum.jjumName || '').toLowerCase();
        const lowerAliases = (jjum.aliases || []).map(a => a.toLowerCase());

        if (lowerInput.includes(lowerName)) score += 0.5;
        lowerAliases.forEach(alias => {
            if (lowerInput.includes(alias)) score += 0.3;
        });

        if (jjum.tags) {
            jjum.tags.forEach(tag => {
                if (lowerInput.includes(tag.toLowerCase())) score += 0.2;
            });
        }

        if (jjum.summary && lowerInput.includes(jjum.summary.toLowerCase().substring(0, 10))) {
            score += 0.1;
        }

        jjum.facts.forEach(fact => {
            if (fact.text && lowerInput.includes(fact.text.toLowerCase().substring(0, 8))) {
                score += 0.15;
            }
        });

        const mentionBonus = Math.min(jjum.mentionCount / 20, 0.3);
        const recallBonus = Math.min(jjum.recallCount / 10, 0.2);
        const pinnedBonus = jjum.pinned ? 0.1 : 0;

        const simulationScore = Math.min(score + mentionBonus + recallBonus + pinnedBonus, 1);

        return {
            ...jjum,
            simulationScore: simulationScore
        };
    });

    scoredJJums.sort((a, b) => b.simulationScore - a.simulationScore);
    this.recallResults = scoredJJums.filter(j => j.simulationScore > 0).slice(0, 13);

    this.status = "working";
    this.statusText = "✅ 회상 완료! " + this.recallResults.length + "개 쩜 발견";
    this.answerGuide = {
        input: inputText,
        timestamp: new Date().toISOString(),
        recallCount: this.recallResults.length,
        topRecall: this.recallResults.slice(0, 3).map(j => j.jjumName),
        hostPreview: this.generateHostPreview(inputText)
    };
    this.render();
};*/

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

HAEMA_CONSOLE.maskJJumName = function(value) {
    const name = String(value || '');
    const chars = Array.from(name);
    if (chars.length <= 1) return '•';
    return chars[0] + '•'.repeat(Math.min(chars.length - 1, 4));
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
    const candidates = (item.candidates || []).map(candidate => {
        const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : candidate.reasons ? [candidate.reasons] : [];
        const relations = Array.isArray(candidate.relations) ? candidate.relations : [];
        return '<details class="result-jjum"><summary><span>' + this.escapeHtml(this.maskJJumName(candidate.name)) + '</span><span class="result-score">—</span></summary>' +
            '<div class="result-jjum-detail"><div class="result-full-name">' + this.escapeHtml(candidate.name) + '</div>' +
            (candidate.summary ? '<p>' + this.escapeHtml(candidate.summary) + '</p>' : '') +
            (reasons.length ? '<div class="result-detail-label">회상 근거</div><div class="history-jjum-list">' + reasons.map(reason => '<span class="history-jjum-chip">' + this.escapeHtml(typeof reason === 'string' ? reason : JSON.stringify(reason)) + '</span>').join('') + '</div>' : '') +
            (relations.length ? '<div class="result-detail-label">쩜선 연결</div><div class="history-jjum-list">' + relations.map(relation => '<span class="history-jjum-chip">' + this.escapeHtml(relation.targetName || relation.label || '연결된 쩜') + '</span>').join('') + '</div>' : '') +
            (candidate.tags?.length ? '<div class="history-jjum-list">' + candidate.tags.map(tag => '<span class="history-jjum-chip">' + this.escapeHtml(tag) + '</span>').join('') + '</div>' : '') +
            '</div></details>';
    }).join('');
    const topics = (item.topics || []).map(topic => {
        const label = this.getTopicName(topic);
        const reason = typeof topic?.reason === 'string' ? topic.reason : '';
        return label ? '<span class="history-jjum-chip"' + (reason ? ' title="' + this.escapeHtml(reason) + '"' : '') + '>' + this.escapeHtml(label) + '</span>' : '';
    }).join('');
    const newJJums = (item.newJJums || []).map(jjum => {
        const label = typeof jjum === 'string' ? jjum : jjum?.jjumName || jjum?.name || '';
        return label ? '<span class="history-jjum-chip">' + this.escapeHtml(this.maskJJumName(label)) + '</span>' : '';
    }).join('');
    const guideHtml = item.guide ? '<details class="guide-detail"><summary>호스트 응답 가이드</summary><div class="response-guide-content">' + this.renderResponseGuide(item.guide) + '</div></details>' : '';
    const usageBadge = item.conversationId && item.utteranceId && typeof HAEMA_TOKEN_METER !== 'undefined'
        ? HAEMA_TOKEN_METER.badge(this.getTokenUsageStore()?.turn(item.scope, item.conversationId, item.utteranceId)) : '';
    return '<details class="haema-history-card" data-result-at="' + this.escapeHtml(String(item.at || '')) + '"><summary><span class="haema-history-title">해마 회상 결과' + usageBadge + '</span><span class="haema-history-count">쩜 ' + (item.candidates || []).length + '개 발견 · 펼쳐보기</span></summary><div class="haema-history-detail">' +
        (candidates ? '<div class="history-detail-title">회상된 쩜 · 회상 점수 —</div><div class="history-results">' + candidates + '</div>' : '<p class="recall-note">이번 대화에서 회상된 쩜이 없어요.</p>') +
        (topics ? '<div class="history-detail-title">주제</div><div class="history-jjum-list">' + topics + '</div>' : '') +
        (newJJums ? '<div class="history-detail-title">새 쩜</div><div class="history-jjum-list">' + newJJums + '</div>' : '') +
        guideHtml + '</div></details>';
};

HAEMA_CONSOLE.renderLeftPanel = function() {
    const inputValue = localStorage.getItem('haema_input') || '';
    const isInputDisabled = !this.isStorageReady() || !this.isApiKeyReady();
    const disabledOverlay = isInputDisabled ? '<div class="input-disabled-overlay" title="저장소와 AI 연결을 모두 준비해 주세요" aria-label="저장소와 AI 연결을 모두 준비해 주세요"></div>' : '';
    const storageLabel = '🪣 : ' + (this.storageConnected ? '연결✅' : '없음❌');
    const apiLabel = '🗝️ : ' + (this.apiConfigured ? (this.apiKeyName || '설정✅') : '없음❌');
    const storageTitle = this.storageConnected ? '저장소 연결됨' : '저장소 연결하기';
    const apiTitle = this.apiConfigured ? 'AI 연결 설정됨' + (this.apiKeyName ? ': ' + this.apiKeyName : '') : 'AI 연결 설정';
    const storageBtn = '<button class="tool-button" id="storageBtn" type="button" title="' + this.escapeHtml(storageTitle) + '" aria-label="' + this.escapeHtml(storageTitle) + '"><img src="Resources/haema-design/10-storage-button.svg" width="103" height="26" alt=""><span>' + this.escapeHtml(storageLabel) + '</span></button>';
    const apiBtn = '<button class="tool-button" id="apiKeyBtn" type="button" title="' + this.escapeHtml(apiTitle) + '" aria-label="' + this.escapeHtml(apiTitle) + '"><img src="Resources/haema-design/09-api-key-button.svg" width="103" height="26" alt=""><span class="api-key-label">' + this.escapeHtml(apiLabel) + '</span></button>';
    this.syncConversationPending();
    const conversationScope = this.getConversationScope();
    const visibleHistory = this.conversationHistory.filter(item => !item.scope || HAEMA_CONVERSATION_SESSION.sameScope(item.scope, conversationScope));
    const messages = visibleHistory.map(item => {
        if (item.type === 'user') {
            const retry = item.failed && !item.acknowledged && item.request ? '<button class="conversation-retry" type="button" data-retry-utterance="' + this.escapeHtml(item.request.turns[0].utteranceId) + '"' + (this.sending ? ' disabled' : '') + '>다시 보내기</button>' : '';
            return '<div class="message-row user"><div class="message-bubble' + (item.failed ? ' message-error' : '') + '"><span class="message-meta">나 · ' + this.escapeHtml(new Date(item.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })) + '</span>' + this.escapeHtml(item.text) + (item.failed || item.notice ? '<span class="message-meta">' + this.escapeHtml(item.error || item.notice || '') + '</span>' : '') + retry + '</div></div>';
        }
        if (item.type === 'result') return this.renderConversationResult(item);
        return '';
    }).join('');
    const empty = visibleHistory.length ? '' : '<div class="conversation-empty"><span class="conversation-empty-mark">~</span><strong>해마와 대화를 시작해 보세요</strong><br>보낸 메시지는 이곳에 차곡차곡 쌓여요.</div>';
    const sessionError = this.conversationSessionError ? '<p class="conversation-session-error" role="alert">' + this.escapeHtml(this.conversationSessionError) + '</p>' : '';
    const sessionNotice = this.conversationSessionNotice ? '<p class="message-meta" role="status">' + this.escapeHtml(this.conversationSessionNotice) + '</p>' : '';
    const introductionBtn = typeof HAEMA_INTRODUCTION_MODAL !== 'undefined' ? HAEMA_INTRODUCTION_MODAL.button(this) : '';
    return '<section class="panel panel-left" aria-label="대화"><div class="conversation-toolbar">' + introductionBtn + storageBtn + apiBtn + '</div>' +
        '<div class="chat-panel-art" aria-hidden="true"><img src="Resources/haema-design/13-chat-panel-shape.svg" width="725.44" height="853" alt=""></div>' +
        '<div class="conversation-history" data-scroll-key="history" aria-live="polite">' + sessionError + sessionNotice + empty + messages + '</div>' +
        '<div class="typing-indicator" id="typingIndicator" aria-live="polite"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span>입력 중</span></div>' +
        '<div class="input-area' + (isInputDisabled ? ' input-area-disabled' : '') + '"><span class="user-avatar-frame" title="테스터"><img class="user-avatar" src="Resources/haema-design/12-user-avatar.png" width="82" height="88" alt="테스터 프로필"></span><img class="user-bubble-art" src="Resources/haema-design/15-user-bubble-shape.svg" width="646" height="47.37" alt="" aria-hidden="true"><textarea class="user-input" id="userInput" rows="1" placeholder="챗봇AI와 대화하는 것처럼 입력해주세요." aria-label="메시지 입력">' + this.escapeHtml(inputValue) + '</textarea>' +
        '<button class="send-button' + (this.sendPressed ? ' is-pressed' : '') + '" id="sendBtn" type="button" aria-label="보내기" ' + (this.sending ? 'disabled' : '') + '><img src="Resources/haema-design/08-send-button.svg" width="61" height="45" alt=""><span aria-hidden="true">↵</span></button>' + disabledOverlay + '</div></section>';
};

HAEMA_CONSOLE.renderRecallSection = function() {
    const count = this.recallResults.length;
    if (!count) return '';
    return '<div class="jjum-section-heading"><span class="section-title">이번 대화의 회상</span><span class="recall-count">' + (count ? count + '개' : '결과 대기') + '</span></div>' +
        (count ? '<div class="recall-note">회상 점수는 아직 전달되지 않았어요. <strong>—</strong>로 표시합니다.</div>' : '<div class="recall-note">메시지를 보내면 회상된 쩜이 여기에 표시됩니다.</div>');
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
        '<label class="form-label" for="modalSeons">쩜선 (Seons) - 연결된 쩜 (한 줄에 하나씩, 형식: 대상이름 | 연결라벨 | 가중치(0~1))</label>' +
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
    this.render();
    await Promise.all([
        this.refreshApiStatus(),
        typeof HAEMA_STORAGE_MODAL !== "undefined" ? HAEMA_STORAGE_MODAL.autoConnect() : Promise.resolve(),
    ]);
    this.syncConversationPending();
    this.render();
};

// 선택한 서버 저장소의 쩜을 읽고, 완료 후 다음 처리를 진행한다.
HAEMA_CONSOLE.loadLocalServerData = async function() {
    const response = await fetch('/api/owners/demo/jjums');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '저장소를 읽을 수 없습니다.');
    this.allJJums = data.jjums || [];
    this.render();
    return this.allJJums;
};

// 쩜 목록 업데이트 함수
HAEMA_CONSOLE.updateJJumList = function(jjums) {
    this.allJJums = jjums || [];
    this.render();
    console.log('쩜 목록 업데이트 완료:', this.allJJums.length, '개 쩜');
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

HAEMA_CONSOLE.createSeonConnection = function(sourceJJum, targetJJum, context) {
    const existingSeon = sourceJJum.seons?.find(s => s.targetId === targetJJum.jjumId);
    if (existingSeon) {
        existingSeon.weight = Math.min(1, (existingSeon.weight || 0.5) + 0.1);
        existingSeon.lastActivated = new Date().toISOString();
        return;
    }

    if (!sourceJJum.seons) {
        sourceJJum.seons = [];
    }
    sourceJJum.seons.push({
        targetId: targetJJum.jjumId,
        weight: 0.5,
        label: this.inferSeonLabel(sourceJJum, targetJJum, context),
        lastActivated: new Date().toISOString(),
    });

    this.statusText = `🔗 쩜선 연결: ${sourceJJum.jjumName} ↔ ${targetJJum.jjumName}`;
    this.render();
};

//HAEMA_CONSOLE.inferSeonLabel - 지움.


//HAEMA_CONSOLE.createDerivativeJJums 지움.

// ===== 다정한 대화 가이드 제공 ===== 지움.

//HAEMA_CONSOLE.generateHostPreview = 지움.


document.addEventListener("DOMContentLoaded", () => {
    // API 키 모달 분리 파일에 콘솔 참조를 전달한다.
    // 분리 파일에서 저장 완료 후 상태 텍스트 갱신이나 render() 호출 시 사용한다.
    if (typeof HAEMA_API_KEY_MODAL !== "undefined" && typeof HAEMA_API_KEY_MODAL.setConsole === "function") {
        HAEMA_API_KEY_MODAL.setConsole(HAEMA_CONSOLE);
    }

    // 저장소 모달 분리 파일에 콘솔 참조를 전달한다.
    if (typeof HAEMA_STORAGE_MODAL !== "undefined" && typeof HAEMA_STORAGE_MODAL.setConsole === "function") {
        HAEMA_STORAGE_MODAL.setConsole(HAEMA_CONSOLE);
    }

    HAEMA_CONSOLE.init();
});
