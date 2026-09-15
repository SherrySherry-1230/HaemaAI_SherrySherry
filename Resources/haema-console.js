// HAEMA_CONSOLE - 해마.AI 콘솔 애플리케이션
HAEMA_CONSOLE = {
    status: 'resting',
    statusText: '해마 쉬는 중...',
    recallResults: [],
    answerGuide: null,
    allJjums: [],
    selectedJjumId: null,
    modalMode: null,
    modalData: null,
    throttleTimer: null,  // 실시간 타이핑 쓰로틀 타이머 (0.5초 간격)
    lastSnapshotTime: 0,  // 마지막 스냅샷 전송 시각 (timestamp 기반 throttle)
    typingStopTimer: null,  // 타이핑 멈춤 감지 타이머 (감정 상태 업데이트용)
    streamingJjums: new Set(),  // 실시간 스트리밍 중인 JJum ID 집합 (애니메이션용)
    
    // 점 데이터는 외부에서 주입하거나 모달로 추가한다.
    // 초기 샘플 데이터는 넣지 않는다.
    
};

// ===== 렌더링 함수 =====
HAEMA_CONSOLE.render = function() {
    const app = document.getElementById("app");
    app.innerHTML = this.renderHeader() + this.renderMainContainer() + this.renderModal();
    this.attachEventListeners();
};

HAEMA_CONSOLE.renderHeader = function() {
    const statusClass = "status-" + this.status;
    const emojis = this.status === "working" ? "💛💚💛" : this.status === "error" ? "💔💔💔" : "💛💚💛";
    return "<header class=\"header " + statusClass + "\">" +
        "<div class=\"header-left\">" +
            "<div class=\"logo-icon\"><img src=\"h_LOGO.png\" alt=\"HAEMA.AI 로고\"></div>" +
            "<div><div class=\"header-title\">HAEMA.AI</div><div class=\"header-subtitle\">해마.AI 실험실</div></div>" +
        "</div>" +
        "<div class=\"status-bar\"><span class=\"status-emojis\">" + emojis + "</span><span class=\"status-text\">" + this.statusText + "</span></div>" +
    "</header>";
};

HAEMA_CONSOLE.renderMainContainer = function() {
    return "<div class=\"main-container\">" + this.renderLeftPanel() + this.renderRightPanel() + "</div>";
};

HAEMA_CONSOLE.renderRightPanel = function() {
    return "<div class=\"panel\">" +
        "<div class=\"panel-header\"><div class=\"panel-title\"><span class=\"icon\">📌</span> 점(JJum) 매니저 & 실시간 회상</div></div>" +
        "<div class=\"panel-content\">" + this.renderRecallSection() + this.renderJjumListSection() + "</div>" +
    "</div>";
};

HAEMA_CONSOLE.renderJjumListSection = function() {
    const sortedJjums = this.allJjums.slice().sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
    if (sortedJjums.length === 0) {
        return "<div class=\"jjum-list-section\"><div class=\"create-btn-wrapper\"><button class=\"btn btn-create\" id=\"createJjumBtn\">+ 새 점(JJum) 만들기</button></div><div class=\"empty-state\"><div class=\"empty-icon\">🧩</div><div class=\"empty-text\">저장된 점이 없습니다.<br>[+ 새 점 만들기] 버튼으로 점을 추가해보세요.</div></div></div>";
    }
    const accordionHtml = sortedJjums.map(jjum => {
        const isExpanded = this.selectedJjumId === jjum.jjumId;
        let seonsHtml = "";
        if (jjum.seons && jjum.seons.length > 0) {
            seonsHtml = jjum.seons.map(t => {
                const target = this.allJjums.find(j => j.jjumId === t.targetId);
                const targetName = target ? target.canonicalName : "알 수 없음";
                const weightPercent = (t.weight * 100).toFixed(0);
                return "<div class=\"seon-item\"><div class=\"seon-weight-bar\"><div class=\"seon-weight-fill\" style=\"width: " + weightPercent + "%\"></div></div><span class=\"seon-target\">" + this.escapeHtml(targetName) + "</span><span class=\"seon-label\">" + (t.label || "연결") + "</span><span style=\"margin-left: auto; font-size: 11px; color: var(--text-secondary);\">" + weightPercent + "%</span></div>";
            }).join("");
        } else {
            seonsHtml = "<div style=\"color: var(--text-secondary); font-size: 12px;\">연결된 선 없음</div>";
        }
        let factsHtml = "";
        if (jjum.facts && jjum.facts.length > 0) {
            factsHtml = jjum.facts.map(f => "<div class=\"detail-text\">" + this.escapeHtml(f.text) + "</div>").join("");
        } else {
            factsHtml = "<div style=\"color: var(--text-secondary); font-size: 12px;\">사실 정보 없음</div>";
        }
        const tagsHtml = jjum.tags.map(t => "<span class=\"h-tag\">" + this.escapeHtml(t) + "</span>").join("");
        return "<div class=\"jjum-item " + (isExpanded ? "expanded" : "") + (this.streamingJjums.has(jjum.jjumId) ? " streaming" : "") + "\" data-jjum-id=\"" + jjum.jjumId + "\">" +
            "<div class=\"jjum-header\" onclick=\"HAEMA_CONSOLE.toggleJjum(\"" + jjum.jjumId + "\");\">" +
                "<div class=\"jjum-info\"><div class=\"jjum-icon\">📌</div><div class=\"jjum-main\"><div class=\"jjum-name\">" + this.escapeHtml(jjum.canonicalName) + "</div><div class=\"jjum-meta\">" + jjum.type + " · 생성 " + this.formatDate(jjum.firstSeen) + " · " + jjum.mentionCount + "회 언급" + (jjum.pinned ? " · 📌 고정" : "") + "</div></div></div>" +
                "<span class=\"expand-icon\">▼</span>" +
            "</div>" +
            "<div class=\"jjum-details\"><div class=\"jjum-details-content\">" +
                "<div class=\"detail-section\"><div class=\"detail-label\">🏷️ 태그 (Tags)</div><div class=\"detail-tags\">" + tagsHtml + "</div></div>" +
                "<div class=\"detail-section\"><div class=\"detail-label\">📝 한 줄 요약</div><div class=\"detail-text\">" + this.escapeHtml(jjum.summary || "요약 없음") + "</div></div>" +
                "<div class=\"detail-section\"><div class=\"detail-label\">📚 사실 (Facts)</div>" + factsHtml + "</div>" +
                "<div class=\"detail-section\"><div class=\"detail-label\">🔗 선 (Seons) - 연결된 점</div><div class=\"seons-list\">" + seonsHtml + "</div></div>" +
                "<div class=\"detail-section\" style=\"display: flex; gap: 8px; margin-top: 12px;\">" +
                    "<button class=\"btn btn-secondary\" style=\"flex: 1;\" onclick=\"event.stopPropagation(); HAEMA_CONSOLE.openEditModal(\"" + jjum.jjumId + "\");\">✏️ 수정</button>" +
                    "<button class=\"btn btn-secondary\" style=\"flex: 1; color: #ff6b6b;\" onclick=\"event.stopPropagation(); HAEMA_CONSOLE.confirmDelete(\"" + jjum.jjumId + "\");\">🗑️ 삭제</button>" +
                "</div>" +
            "</div></div>" +
        "</div>";
    }).join("");
    return "<div class=\"jjum-list-section\">" +
        "<div class=\"create-btn-wrapper\"><button class=\"btn btn-create\" id=\"createJjumBtn\">+ 새 점(JJum) 만들기</button></div>" +
        "<div class=\"section-label\"><span>📂</span> 전체 점(JJum) 목록 (" + sortedJjums.length + "개, 생성순)</div>" +
        "<div class=\"jjum-accordion\">" + accordionHtml + "</div>" +
    "</div>";
};

// ===== 이벤트 리스너 =====
HAEMA_CONSOLE.attachEventListeners = function() {
    const sendBtn = document.getElementById("sendBtn");
    const clearBtn = document.getElementById("clearBtn");
    const createBtn = document.getElementById("createJjumBtn");
    const modalOverlay = document.getElementById("modalOverlay");
    const modalClose = document.getElementById("modalClose");
    const modalCancel = document.getElementById("modalCancel");
    const modalSave = document.getElementById("modalSave");
    const userInput = document.getElementById("userInput");

    if (sendBtn) sendBtn.addEventListener("click", () => this.handleSend());
    if (clearBtn) clearBtn.addEventListener("click", () => this.handleClear());
    if (createBtn) createBtn.addEventListener("click", () => this.openCreateModal());
    if (modalOverlay) modalOverlay.addEventListener("click", (e) => {
        if (e.target === modalOverlay) this.closeModal();
    });
    if (modalClose) modalClose.addEventListener("click", () => this.closeModal());
    if (modalCancel) modalCancel.addEventListener("click", () => this.closeModal());
    if (modalSave) modalSave.addEventListener("click", () => this.saveModal());
    
    // 실시간 타이핑 쓰로틀 (Throttle 500ms - 타이핑 중에도 0.5초마다 계속 호출)
    if (userInput) {
        userInput.addEventListener("input", (e) => this.handleInput(e.target.value));
    }
};

HAEMA_CONSOLE.handleSend = function() {
    const input = document.getElementById("userInput");
    if (!input) return;
    const text = input.value.trim();
    if (!text) {
        this.status = "error";
        this.statusText = "⚠️ 입력할 내용을 작성해주세요!";
        this.render();
        return;
    }
    localStorage.setItem("haema_input", text);
    this.status = "working";
    this.statusText = "🔍 해마 자극 분석 중...";
    this.render();

    setTimeout(() => {
        this.simulateRecall(text);
    }, 500);
};

HAEMA_CONSOLE.handleClear = function() {
    const input = document.getElementById("userInput");
    if (input) input.value = "";
    localStorage.removeItem("haema_input");
    this.answerGuide = null;
    this.recallResults = [];
    this.status = "resting";
    this.statusText = "해마 쉬는 중...";
    this.render();
};

// ===== 실시간 타이핑 쓰로틀 (Throttle 500ms) =====
// 타이핑 중에도 0.5초마다 백엔드 MCTS 시뮬레이션을 계속 호출하여
// 최적의 점(JJum) TOP 1~3을 실시간으로 갱신

    // ===== 타이핑 이벤트 처리 (Non-blocking, 0.5s Throttle) =====
    // UI 스레드 차단 없이 백그라운드로 타이핑 스냅샷을 스트리밍한다.
    // timestamp 기반 throttle로 입력 씹힘 없이 Event Loop를 점유하지 않는다.
    HAEMA_CONSOLE.handleInput = function(inputValue) {
        // 빈 입력 처리: 상태 초기화 및 타이핑 멈춤 타이머 해제
        if (!inputValue || !inputValue.trim()) {
            this.recallResults = [];
            this.answerGuide = null;
            this.status = "resting";
            this.statusText = "대기 중...";
            this.render();
            this.clearTypingStopTimer();
            this.lastSnapshotTime = 0;
            return;
        }

        // timestamp 기반 throttle: 0.5초 간격으로만 스냅샷 전송
        const now = Date.now();
        if (this.lastSnapshotTime && (now - this.lastSnapshotTime) < 500) {
            return;  // 아직 throttle 기간 내 - 입력 씹힘 없이 무시
        }

        // Fire-and-Forget: 백그라운드 비동기 파이프라인으로 스냅샷 전송
        this.streamSnapshot(inputValue);

        // 마지막 스냅샷 시간 기록
        this.lastSnapshotTime = now;

        // 타이핑 멈춤 감지: 1.5초 동안 입력이 없으면 감정 상태 업데이트
        this.clearTypingStopTimer();
        this.typingStopTimer = setTimeout(() => {
            this.detectTypingStop();
        }, 1500);
    };

HAEMA_CONSOLE.openCreateModal = function() {


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
                // 현재는 simulateRecall을 비동기 컨텍스트에서 호출 (백엔드 연동 전)
                if (typeof this.simulateRecall === 'function') {
                    this.simulateRecall(trimmed);
                }
                
                console.debug('[HAEMA] streamSnapshot: 스냅샷 전송 완료 -', trimmed.substring(0, 30) + (trimmed.length > 30 ? '...' : ''));
            } catch (error) {
                console.error('[HAEMA] streamSnapshot 오류:', error.message || error);
                this.handleBackendError('snapshot', error);
            }
        }, 0);
    };

    // ===== JJum 데이터 스키마 검증 =====
    // 백엔드에서 수신하는 JJum 데이터의 필수 필드 및 타입 검증
    HAEMA_CONSOLE.validateJjumSchema = function(jjum) {
        if (!jjum || typeof jjum !== 'object') {
            return { valid: false, reason: 'JJum이 객체가 아닙니다.' };
        }

        // 필수 필드 검증
        if (!jjum.jjumId || typeof jjum.jjumId !== 'string') {
            return { valid: false, reason: 'jjumId가 없거나 문자열이 아닙니다.' };
        }

        if (!jjum.jjumName && !jjum.canonicalName) {
            return { valid: false, reason: 'jjumName/canonicalName이 없습니다.' };
        }

        // 선택적 필드 타입 검증 (있으면 검증)
        if (jjum.jjumName && typeof jjum.jjumName !== 'string') {
            return { valid: false, reason: 'jjumName이 문자열이 아닙니다.' };
        }
        if (jjum.canonicalName && typeof jjum.canonicalName !== 'string') {
            return { valid: false, reason: 'canonicalName이 문자열이 아닙니다.' };
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
    HAEMA_CONSOLE.streamJjumUpdate = function(newJjum) {
        try {
            // 1. 기본 존재 검증
            if (!newJjum || typeof newJjum !== 'object') {
                console.warn('[HAEMA] streamJjumUpdate: 유효하지 않은 JJum 데이터 -', newJjum);
                return;
            }

            // 2. 스키마 검증
            const validation = this.validateJjumSchema(newJjum);
            if (!validation.valid) {
                console.warn('[HAEMA] streamJjumUpdate: 스키마 검증 실패 -', validation.reason);
                return;
            }

            // 3. ID 추출 (canonicalName 또는 jjumName 중 하나 사용)
            const jjumId = newJjum.jjumId;
            const displayName = newJjum.canonicalName || newJjum.jjumName || '알 수 없음';

            // 4. 중복 체크: 이미 존재하는 JJum이면 스킵
            const existing = this.allJjums.find(j => j.jjumId === jjumId);
            if (existing) {
                console.debug('[HAEMA] streamJjumUpdate: 중복 JJum 스킵 -', displayName);
                return;
            }

            // 5. 신규 JJum 구성 (백엔드 필드명 차이 대응)
            const jjum = {
                jjumId: jjumId,
                jjumName: newJjum.jjumName || displayName,
                canonicalName: newJjum.canonicalName || displayName,
                type: newJjum.type || 'unknown',
                tags: Array.isArray(newJjum.tags) ? newJjum.tags : [],
                summary: newJjum.summary || '',
                facts: Array.isArray(newJjum.facts) ? newJjum.facts : [],
                events: Array.isArray(newJjum.events) ? newJjum.events : [],
                seons: Array.isArray(newJjum.seons) ? newJjum.seons : [],
                mentionCount: typeof newJjum.mentionCount === 'number' ? newJjum.mentionCount : 0,
                firstSeen: newJjum.firstSeen || new Date().toISOString(),
                lastMentioned: newJjum.lastMentioned || newJjum.firstSeen || new Date().toISOString(),
                pinned: !!newJjum.pinned,
                status: newJjum.status || 'active',
                mergedFrom: Array.isArray(newJjum.mergedFrom) ? newJjum.mergedFrom : [],
                editHistory: Array.isArray(newJjum.editHistory) ? newJjum.editHistory : [],
                meta: typeof newJjum.meta === 'object' && newJjum.meta ? newJjum.meta : {},
                ownerId: newJjum.ownerId || 'demo',
                sourceService: newJjum.sourceService || 'unknown',
                schemaVersion: newJjum.schemaVersion || 3
            };

            // 6. JJum 추가 및 스트리밍 표시
            this.allJjums.push(jjum);
            this.streamingJjums.add(jjumId);

            // 7. 애니메이션 클래스 적용을 위해 재렌더링
            this.render();

            console.debug('[HAEMA] streamJjumUpdate: 신규 JJum 스트리밍 -', displayName, '(ID:', jjumId + ')');

            // 8. 스트리밍 완료 표시 제거 (1.2초 후)
            setTimeout(() => {
                try {
                    this.streamingJjums.delete(jjumId);
                    this.render();
                } catch (cleanupError) {
                    console.warn('[HAEMA] streamJjumUpdate cleanup 오류:', cleanupError.message);
                }
            }, 1200);

        } catch (error) {
            console.error('[HAEMA] streamJjumUpdate 처리 중 오류:', error.message || error);
            this.handleBackendError('streamJjumUpdate', error);
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
        if (typeof backendClient.onJjumStream === 'function') {
            backendClient.onJjumStream((newJjum) => {
                console.debug('[HAEMA] 백엔드 JJum 스트림 수신:', newJjum);
                this.streamJjumUpdate(newJjum);
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
        canonicalName: "",
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

HAEMA_CONSOLE.openEditModal = function(jjumId) {
    const jjum = this.allJjums.find(j => j.jjumId === jjumId);
    if (!jjum) return;
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
        setTimeout(() => {
            overlay.style.display = "none";
        }, 200);
    }
    this.modalMode = null;
    this.modalData = null;
};

HAEMA_CONSOLE.saveModal = function() {
    const canonicalName = document.getElementById("modalCanonicalName")?.value.trim();
    const aliasesStr = document.getElementById("modalAliases")?.value.trim() || "";
    const type = document.getElementById("modalType")?.value || "인물";
    const tagsStr = document.getElementById("modalTags")?.value.trim() || "";
    const summary = document.getElementById("modalSummary")?.value.trim() || "";
    const factsStr = document.getElementById("modalFacts")?.value.trim() || "";
    const seonsStr = document.getElementById("modalSeons")?.value.trim() || "";

    if (!canonicalName) {
        alert("점 이름을 입력해주세요!");
        return;
    }

    const aliases = aliasesStr.split(",").map(a => a.trim()).filter(a => a);
    const tags = tagsStr.split(",").map(t => t.trim()).filter(t => t);
    const facts = factsStr.split("\n").map(f => f.trim()).filter(f => f).map(f => ({
        text: f,
        addedAt: new Date().toISOString().split("T")[0],
        source: "manual"
    }));
    const seons = seonsStr.split("\n").map(line => {
        const parts = line.split("|").map(p => p.trim());
        if (parts.length < 3) return null;
        const target = this.allJjums.find(j => j.canonicalName === parts[0] || j.aliases.includes(parts[0]));
        if (!target) return null;
        const weight = parseFloat(parts[2]);
        if (isNaN(weight) || weight < 0 || weight > 1) return null;
        return { targetId: target.jjumId, weight: weight, label: parts[1] || "연결" };
    }).filter(t => t);

    if (this.modalMode === "create") {
        const newJjum = {
            jjumId: "jjum_" + Date.now(),
            canonicalName: canonicalName,
            aliases: aliases,
            type: type,
            tags: tags,
            summary: summary,
            facts: facts,
            seons: seons,
            mentionCount: 0,
            firstSeen: new Date().toISOString(),
            lastMentioned: new Date().toISOString(),
            recallCount: 0,
            pinned: false,
            status: "active",
            ownerId: "demo_user",
            sourceService: "haema_console",
            schemaVersion: 3
        };
        this.allJjums.push(newJjum);
    } else {
        const idx = this.allJjums.findIndex(j => j.jjumId === this.modalData.jjumId);
        if (idx !== -1) {
            this.allJjums[idx] = {
                ...this.allJjums[idx],
                canonicalName: canonicalName,
                aliases: aliases,
                type: type,
                tags: tags,
                summary: summary,
                facts: facts,
                seons: seons,
                lastMentioned: new Date().toISOString()
            };
        }
    }

    this.closeModal();
    this.render();
};

// ===== 시뮬레이션 로직 =====
HAEMA_CONSOLE.simulateRecall = function(inputText) {
    const words = inputText.split(/\s+/);
    const scoredJjums = this.allJjums.map(jjum => {
        let score = 0;
        const lowerInput = inputText.toLowerCase();
        const lowerName = jjum.canonicalName.toLowerCase();
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

    scoredJjums.sort((a, b) => b.simulationScore - a.simulationScore);
    this.recallResults = scoredJjums.filter(j => j.simulationScore > 0).slice(0, 13);

    this.status = "working";
    this.statusText = "✅ 회상 완료! " + this.recallResults.length + "개 점 발견";
    this.answerGuide = {
        input: inputText,
        timestamp: new Date().toISOString(),
        recallCount: this.recallResults.length,
        topRecall: this.recallResults.slice(0, 3).map(j => j.canonicalName),
        hostPreview: this.generateHostPreview(inputText)
    };
    this.render();
};

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

HAEMA_CONSOLE.renderLeftPanel = function() {
    const inputValue = localStorage.getItem('haema_input') || '';
    const jsonViewerContent = this.answerGuide ? this.syntaxHighlight(JSON.stringify(this.answerGuide, null, 2)) : '<span style="color: #6b6560;">전송하면 JSON 답변 가이드가 여기에 표시됩니다</span>';
    const hostPreview = this.answerGuide && this.answerGuide.hostPreview ? this.answerGuide.hostPreview : '';
    
    return '<div class="panel">' +
        '<div class="panel-header"><div class="panel-title"><span class="icon">💬</span> 사용자 입력 & 답변 가이드</div></div>' +
        '<div class="panel-content">' +
        '<div class="input-area">' +
        '<textarea class="user-input" id="userInput" placeholder="사용자에게 받은 메시지나 자극을 입력하세요... (예: 친구랑 카페 갔었는데)">' + this.escapeHtml(inputValue) + '</textarea>' +
        '<div class="action-buttons">' +
        '<button class="btn btn-primary" id="sendBtn">🧠 해마 자극 전송</button>' +
        '<button class="btn btn-secondary" id="clearBtn">🗑️ 지우기</button>' +
        '</div>' +
        '</div>' +
        '<div class="output-section">' +
        '<div class="section-label"><span>📋</span> JSON 답변 가이드</div>' +
        '<div class="json-viewer" id="jsonViewer">' + jsonViewerContent + '</div>' +
        (hostPreview ? '<div class="preview-card"><div class="preview-label">🤖 호스트 AI 예상 발화</div><div class="preview-text">' + this.escapeHtml(hostPreview) + '</div></div>' : '') +
        '</div>' +
        '</div>' +
        '</div>';
};

HAEMA_CONSOLE.renderRecallSection = function() {
    if (this.recallResults.length === 0) {
        return '<div class="recall-section">' +
            '<div class="recall-header">' +
            '<div class="section-label"><span>🔍</span> 실시간 회상 결과</div>' +
            '<div class="recall-count">대기 중</div>' +
            '</div>' +
            '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px; background: var(--bg-light); border-radius: 10px;">' +
            '💬 메시지를 전송하면 해마가 관련 기억을 찾아드립니다' +
            '</div>' +
            '</div>';
    }
    
    const top3 = this.recallResults.slice(0, 3);
    const rankClasses = ['gold', 'silver', 'bronze'];
    const rankLabels = ['🥇 TOP 1', '🥈 TOP 2', '🥉 TOP 3'];
    
    const cardsHtml = top3.map((jjum, idx) => {
        const rankClass = rankClasses[idx] || '';
        const tagsHtml = (jjum.tags || []).map(t => '<span class="h-tag">' + this.escapeHtml(t) + '</span>').join('');
        return '<div class="rank-card ' + rankClass + '">' +
            '<div class="rank-badge">' + (idx + 1) + '</div>' +
            '<div class="rank-title">' + rankLabels[idx] + '</div>' +
            '<div class="rank-name">' + this.escapeHtml(jjum.canonicalName) + '</div>' +
            '<div class="rank-stats">' +
            '<div class="stat-item"><span class="stat-value">' + jjum.simulationScore.toFixed(2) + '</span><span class="stat-label">스코어</span></div>' +
            '<div class="stat-item"><span class="stat-value">' + jjum.mentionCount + '</span><span class="stat-label">언급</span></div>' +
            '<div class="stat-item"><span class="stat-value">' + jjum.recallCount + '</span><span class="stat-label">회상</span></div>' +
            '</div>' +
            (tagsHtml ? '<div style="margin-top: 8px;">' + tagsHtml + '</div>' : '') +
            '</div>';
    }).join('');
    
    const remaining = this.recallResults.length > 3 ? this.recallResults.length - 3 : 0;
    
    return '<div class="recall-section">' +
        '<div class="recall-header">' +
        '<div class="section-label"><span>🔍</span> 실시간 회상 결과</div>' +
        '<div class="recall-count">' + this.recallResults.length + '개 발견' + (remaining > 0 ? ' (' + remaining + '개 더)' : '') + '</div>' +
        '</div>' +
        '<div class="top3-cards">' + cardsHtml + '</div>' +
        (remaining > 0 ? '<div style="text-align: center; font-size: 12px; color: var(--text-secondary); padding: 8px;">↓ 아래 점 목록에서 전체 ' + this.recallResults.length + '개 확인</div>' : '') +
        '</div>';
};

HAEMA_CONSOLE.renderModal = function() {
    const modalContent = this.modalMode && this.modalData ? this.renderModalContent() : '';
    const modeText = this.modalMode === 'create' ? '새 점(JJum) 만들기' : '점(JJum) 수정';
    
    return '<div class="modal-overlay" id="modalOverlay">' +
        '<div class="modal">' +
        '<div class="modal-header">' +
        '<div class="modal-title">' + (this.modalMode === 'create' ? '✨ ' : '✏️ ') + modeText + '</div>' +
        '<div class="modal-close" id="modalClose">✕</div>' +
        '</div>' +
        '<div class="modal-body" id="modalBody">' + modalContent + '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-secondary" id="modalCancel">취소</button>' +
        '<button class="btn btn-primary" id="modalSave">' + (this.modalMode === 'create' ? '✨ 만들기' : '💾 저장') + '</button>' +
        '</div>' +
        '</div>' +
        '</div>';
};

HAEMA_CONSOLE.renderModalContent = function() {
    const data = this.modalData || {};
    const aliasesStr = (data.aliases || []).join(', ');
    const tagsStr = (data.tags || []).join(', ');
    const factsStr = (data.facts || []).map(f => f.text).join('\n');
    const seonsStr = (data.seons || []).map(t => {
        const target = this.allJjums.find(j => j.jjumId === t.targetId);
        const targetName = target ? target.canonicalName : '';
        return targetName + ' | ' + (t.label || '연결') + ' | ' + t.weight;
    }).join('\n');
    
    return '<div class="form-group">' +
        '<label class="form-label" for="modalCanonicalName">점 이름 *</label>' +
        '<input class="form-input" id="modalCanonicalName" type="text" value="' + this.escapeHtml(data.canonicalName || '') + '" placeholder="예: 홍길동">' +
        '<div class="form-hint">점의 대표 이름입니다. 어떤 이름으로 불러도 이 점을 찾을 수 있습니다.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalAliases">별칭 (쉼표로 구분)</label>' +
        '<input class="form-input" id="modalAliases" type="text" value="' + this.escapeHtml(aliasesStr) + '" placeholder="예: 지수, 지슈, 그 친구">' +
        '<div class="form-hint">별칭을 입력하면 그 이름으로도 점을 찾을 수 있습니다.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalType">유형</label>' +
        '<select class="form-select" id="modalType">' +
        '<option value="인물"' + (data.type === '인물' ? ' selected' : '') + '>인물</option>' +
        '<option value="장소"' + (data.type === '장소' ? ' selected' : '') + '>장소</option>' +
        '<option value="조직"' + (data.type === '조직' ? ' selected' : '') + '>조직</option>' +
        '<option value="사건"' + (data.type === '사건' ? ' selected' : '') + '>사건</option>' +
        '<option value="개념"' + (data.type === '개념' ? ' selected' : '') + '>개념</option>' +
        '<option value="사물"' + (data.type === '사물' ? ' selected' : '') + '>사물</option>' +
        '<option value="기타"' + (!data.type || data.type === '기타' ? ' selected' : '') + '>기타</option>' +
        '</select>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalTags">태그 (Tags) (쉼표로 구분)</label>' +
        '<input class="form-input" id="modalTags" type="text" value="' + this.escapeHtml(tagsStr) + '" placeholder="예: 친구, 동료, 맛집">' +
        '<div class="form-hint">점을 분류하는 태그입니다. 여러 개 입력 가능.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalSummary">한 줄 요약</label>' +
        '<input class="form-input" id="modalSummary" type="text" value="' + this.escapeHtml(data.summary || '') + '" placeholder="예: 월 1~2회 만나는 친한 친구">' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalFacts">사실 (Facts) - 한 줄에 하나씩</label>' +
        '<textarea class="form-textarea" id="modalFacts" rows="3" placeholder="예: 대학교 동창이다&#10;커피를 좋아한다">' + this.escapeHtml(factsStr) + '</textarea>' +
        '<div class="form-hint">점에 대한 사실 정보를 한 줄에 하나씩 입력하세요.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalSeons">선 (Seons) - 연결된 점 (한 줄에 하나씩)</label>' +
        '<textarea class="form-textarea" id="modalSeons" rows="3" placeholder="예: 친구 | 친구 관계 | 0.8&#10;장소 | 만난 곳 | 0.6">' + this.escapeHtml(seonsStr) + '</textarea>' +
        '<div class="form-hint">다른 점과 연결하는 선입니다. 형식: 대상점이름 | 라벨 | 가중치(0~1)</div>' +
        '</div>';
};

HAEMA_CONSOLE.generateHostPreview = function(inputText) {
    const topRecall = this.recallResults.slice(0, 3);
    if (topRecall.length === 0) {
        return '음... 그 이야기는 잘 기억나지 않네요. 좀 더 자세히 말해줄 수 있나요?';
    }
    
    const names = topRecall.map(j => j.canonicalName);
    const primary = names[0];
    const secondary = names.length > 1 ? names[1] : null;
    
    const templates = [
        '아, ' + primary + '요! 기억나요. ' + (secondary ? secondary + '도 같이 생각나네요.' : '그때 일이 떠오르는데요.'),
        primary + ' 이야기 말이죠. ' + (topRecall[0].summary ? topRecall[0].summary + ' ' : '') + '맞아요, 그런 일이 있었죠.',
        '네, ' + primary + '요. ' + (topRecall[0].facts && topRecall[0].facts.length > 0 ? topRecall[0].facts[0].text + ' 그리고...' : '그거요!') + ' 좀 더 얘기해 볼까요?'
    ];
    
    const idx = Math.floor(Math.random() * templates.length);
    return templates[idx];
};

// ===== 점 토글 =====
HAEMA_CONSOLE.toggleJjum = function(jjumId) {
    if (this.selectedJjumId === jjumId) {
        this.selectedJjumId = null;
    } else {
        this.selectedJjumId = jjumId;
    }
    this.render();
};

// ===== 점 삭제 확인 =====
HAEMA_CONSOLE.confirmDelete = function(jjumId) {
    const jjum = this.allJjums.find(j => j.jjumId === jjumId);
    if (!jjum) return;
    
    if (confirm('정말 "' + jjum.canonicalName + '" 점을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        this.allJjums = this.allJjums.filter(j => j.jjumId !== jjumId);
        if (this.selectedJjumId === jjumId) {
            this.selectedJjumId = null;
        }
        this.render();
    }
};

// ===== 초기화 =====
HAEMA_CONSOLE.init = function() {
    this.render();
    console.log("HAEMA_CONSOLE 초기화 완료");
};

// DOM 로드 후 초기화
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => HAEMA_CONSOLE.init());
} else {
    HAEMA_CONSOLE.init();
}
