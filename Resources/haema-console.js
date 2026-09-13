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
        return "<div class=\"jjum-item " + (isExpanded ? "expanded" : "") + "\" data-jjum-id=\"" + jjum.jjumId + "\">" +
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
HAEMA_CONSOLE.handleInput = function(inputValue) {
    // 쓰로틀 체크: 이미 0.5초 이내에 호출되었으면 무시
    if (this.throttleTimer) {
        return;
    }
    
    // 빈 입력값은 무시
    if (!inputValue || !inputValue.trim()) {
        this.recallResults = [];
        this.answerGuide = null;
        this.status = "resting";
        this.statusText = "해마 쉬는 중...";
        this.render();
        return;
    }
    
    // 상태 업데이트: MCTS 시뮬레이션 중
    this.status = "working";
    this.statusText = "🧠 MCTS 시뮬레이션 중... (0.5초마다 실시간 갱신)";
    this.render();
    
    // 백엔드 MCTS 시뮬레이션 API 호출 (현재 로컬 시뮬레이션)
    this.simulateRecall(inputValue);
    
    // 0.5초(500ms) 동안 쓰로틀 잠금
    this.throttleTimer = true;
    setTimeout(() => {
        this.throttleTimer = null;
    }, 500);
};

HAEMA_CONSOLE.openCreateModal = function() {
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
        '<textarea class="form-textarea" id="modalSeons" rows="3" placeholder="예: 친구 | 친구 관계 | 0.8&#10;장소 | 만난 곳 | 0.6">' + this.escapeHtml(tailsStr) + '</textarea>' +
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
