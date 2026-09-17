// HAEMA_CONSOLE - 해마.AI 콘솔 애플리케이션
HAEMA_CONSOLE = {
    status: 'resting',
    statusText: '해마 쉬는 중...',
    recallResults: [],
    answerGuide: null,
    allJJums: [],
    streamingJjums: new Set(),
    selectedJjumId: null,
    modalMode: null,
    modalData: null,
    throttleTimer: null,  // 실시간 타이핑 쓰로틀 타이머 (0.5초 간격)
    backgroundStreamTimer: null,  // 백그라운드 스트리밍 타이머
    lastInputValue: '',
    typingStartTime: 0,
    lastKeystrokeTime: 0,
    hesitationDetected: false,
    emotionContext: null,  // 감지된 감정 컨텍스트
    
    // 쩜 데이터는 외부에서 주입하거나 모달로 추가한다.
    // 초기 샘플 데이터는 넣지 않는다.
    
};

// ===== 렌더링 함수 =====
HAEMA_CONSOLE.render = function() {
    const app = document.getElementById("app");
    // allJJums가 초기화되지 않았으면 빈 배열로 초기화
    if (!this.allJJums) {
        this.allJJums = [];
    }
    // 입력창의 현재 값 보존 (렌더링 시 입력값 초기화 방지)
    const userInput = document.getElementById("userInput");
    const preservedValue = userInput ? userInput.value : "";
    const preservedFocus = userInput ? document.activeElement === userInput : false;
    
    app.innerHTML = this.renderHeader() + this.renderMainContainer() + this.renderModal();
    
    // 입력창 값 복원
    const restoredInput = document.getElementById("userInput");
    if (restoredInput && preservedValue !== undefined) {
        restoredInput.value = preservedValue;
        if (preservedFocus) {
            restoredInput.focus();
        }
    }
    
    this.attachEventListeners();
};

HAEMA_CONSOLE.renderHeader = function() {
    const statusClass = "status-" + this.status;
    const emojis = this.status === "working" ? "💛💚💛" : this.status === "error" ? "💔💔💔" : "💛💚💛";
    
    // API 키 설정 상태 확인
    const apiProvider = localStorage.getItem("haema_api_provider") || "";
    const apiModel = localStorage.getItem("haema_api_model") || "";
    const hasApiKey = localStorage.getItem("haema_api_key") ? true : false;
    
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
        apiBtnHtml = '<button class="btn btn-icon" id="apiKeyBtn" title="API 키 설정">🔑</button>';
    }
    
    return "<header class=\"header " + statusClass + "\">" +
        "<div class=\"header-left\">" +
            "<div class=\"logo-icon\"><img src=\"/resources/h_LOGO.png\" alt=\"HAEMA.AI 로고\"></div>" +
            "<div><div class=\"header-title\">HAEMA.AI</div><div class=\"header-subtitle\">해마.AI 실험실</div></div>" +
        "</div>" +
        "<div class=\"header-right\">" +
            apiBtnHtml +
        "</div>" +
        "<div class=\"status-bar\"><span class=\"status-emojis\">" + emojis + "</span><span class=\"status-text\">" + this.statusText + "</span></div>" +
    "</header>";
};

HAEMA_CONSOLE.renderMainContainer = function() {
    return "<div class=\"main-container\">" + this.renderLeftPanel() + this.renderRightPanel() + "</div>";
};

HAEMA_CONSOLE.renderRightPanel = function() {
    return "<div class=\"panel\">" +
        "<div class=\"panel-header\"><div class=\"panel-title\"><span class=\"icon\">📌</span> 쩜(JJum) 매니저 & 실시간 회상</div></div>" +
        "<div class=\"panel-content\">" + this.renderRecallSection() + this.renderJjumListSection() + "</div>" +
    "</div>";
};

HAEMA_CONSOLE.renderJjumListSection = function() {
    // allJJums가 초기화되지 않았으면 빈 배열로 처리
    const jjums = this.allJJums || [];
    const sortedJjums = jjums.slice().sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
    if (sortedJjums.length === 0) {
        return "<div class=\"jjum-list-section\"><div class=\"create-btn-wrapper\"><button class=\"btn btn-create\" id=\"createJjumBtn\">+ 새 쩜(JJum) 만들기</button></div><div class=\"empty-state\"><div class=\"empty-icon\">🧩</div><div class=\"empty-text\">저장된 쩜이 없습니다.<br>[+ 새 쩜 만들기] 버튼으로 쩜을 추가해보세요.</div></div></div>";
    }
    const accordionHtml = sortedJjums.map(jjum => {
        const isExpanded = this.selectedJjumId === jjum.jjumId;
        let seonsHtml = "";
        if (jjum.seons && jjum.seons.length > 0) {
            seonsHtml = jjum.seons.map(t => {
                const target = this.allJJums.find(j => j.jjumId === t.targetId);
                const targetName = target ? target.jjumName : "알 수 없음";
                const weightPercent = (t.weight * 100).toFixed(0);
                return "<div class=\"seon-item\"><div class=\"seon-weight-bar\"><div class=\"seon-weight-fill\" style=\"width: " + weightPercent + "%\"></div></div><span class=\"seon-target\">" + this.escapeHtml(targetName) + "</span><span class=\"seon-label\">" + (t.label || "연결") + "</span><span style=\"margin-left: auto; font-size: 11px; color: var(--text-secondary);\">" + weightPercent + "%</span></div>";
            }).join("");
        } else {
            seonsHtml = "<div style=\"color: var(--text-secondary); font-size: 12px;\">연결된 쩜선 없음</div>";
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
                "<div class=\"jjum-info\"><div class=\"jjum-icon\">📌</div><div class=\"jjum-main\"><div class=\"jjum-name\">" + this.escapeHtml(jjum.jjumName) + "</div><div class=\"jjum-meta\">" + jjum.type + " · 생성 " + this.formatDate(jjum.firstSeen) + " · " + jjum.mentionCount + "회 언급" + (jjum.pinned ? " · 📌 고정" : "") + "</div></div></div>" +
                "<span class=\"expand-icon\">▼</span>" +
            "</div>" +
            "<div class=\"jjum-details\"><div class=\"jjum-details-content\">" +
                "<div class=\"detail-section\"><div class=\"detail-label\">🏷️ 태그 (Tags)</div><div class=\"detail-tags\">" + tagsHtml + "</div></div>" +
                "<div class=\"detail-section\"><div class=\"detail-label\">📝 한 줄 요약</div><div class=\"detail-text\">" + this.escapeHtml(jjum.summary || "요약 없음") + "</div></div>" +
                "<div class=\"detail-section\"><div class=\"detail-label\">📚 사실 (Facts)</div>" + factsHtml + "</div>" +
                "<div class=\"detail-section\"><div class=\"detail-label\">🔗 쩜선 (Seons) - 연결된 쩜</div><div class=\"seons-list\">" + seonsHtml + "</div></div>" +
                "<div class=\"detail-section\" style=\"display: flex; gap: 8px; margin-top: 12px;\">" +
                    "<button class=\"btn btn-secondary\" style=\"flex: 1;\" onclick=\"event.stopPropagation(); HAEMA_CONSOLE.openEditModal(\"" + jjum.jjumId + "\");\">✏️ 수정</button>" +
                    "<button class=\"btn btn-secondary\" style=\"flex: 1; color: #ff6b6b;\" onclick=\"event.stopPropagation(); HAEMA_CONSOLE.confirmDelete(\"" + jjum.jjumId + "\");\">🗑️ 삭제</button>" +
                "</div>" +
            "</div></div>" +
        "</div>";
    }).join("");
    return "<div class=\"jjum-list-section\">" +
        "<div class=\"create-btn-wrapper\"><button class=\"btn btn-create\" id=\"createJjumBtn\">+ 새 쩜(JJum) 만들기</button></div>" +
        "<div class=\"section-label\"><span>📂</span> 전체 쩜(JJum) 목록 (" + sortedJjums.length + "개, 생성순)</div>" +
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
    const apiKeyBtn = document.getElementById("apiKeyBtn");
    if (apiKeyBtn) apiKeyBtn.addEventListener("click", () => this.openApiKeyModal());
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

    // 1. 회상 시뮬레이션 (기존 기능)
    setTimeout(() => {
        this.simulateRecall(text);
    }, 500);

    // 2. 새로운 JJum 생성 (입력된 텍스트에서 새 점 후보 감지)
    // 간단히 첫 문장/구절을 JJum 이름으로 사용하여 생성
    setTimeout(() => {
        this.createJjumFromInput(text);
    }, 800);
};

// ===== 입력 텍스트에서 새 JJum 생성 =====
// 사용자가 입력한 텍스트에서 새로운 점(JJum) 후보를 생성하여 로컬 서버에 저장
HAEMA_CONSOLE.createJjumFromInput = function(text) {
    // 간단한 heuristics: 입력 텍스트에서 첫 번째 명사구/이름 추출
    // 예: "오늘 내가 키우던 고양이 뇸뇸이가" → "뇸뇸이"
    // 예: "성수 카페 갔었는데" → "성수 카페"

    // 공백/조사 기준으로 첫 의미 있는 구절 추출
    const words = text.split(/\s+/);
    let candidateName = '';

    // 2~4단어 범위에서 후보 추출 (너무 짧거나 길면 제외)
    if (words.length >= 2 && words.length <= 6) {
        // 마지막 1~2단어를 후보로 (이름/장소일 가능성 높음)
        const lastWords = words.slice(-2).join(' ');
        // 조사가 붙어있으면 제거
        candidateName = lastWords.replace(/(이|가|은|는|을|를|에|에서|하고|와|과)$/, '').trim();
    } else if (words.length === 1) {
        candidateName = words[0];
    }

    // 후보가 유효하면 JJum 생성
    if (candidateName && candidateName.length >= 1 && candidateName.length <= 30) {
        // 기존 JJum과 중복 체크
        const existing = this.allJJums.find(j =>
            j.jjumName === candidateName ||
            j.aliases?.some(a => a === candidateName)
        );

        if (!existing) {
            // 새 JJum 생성 API 호출
            fetch('/api/owners/demo/jjums', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jjumName: candidateName,
                    aliases: [candidateName],
                    type: '인물',
                    tags: [],
                    summary: text.slice(0, 100),
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.jjum) {
                    this.allJJums.push(data.jjum);
                    this.render();
                    console.log('새 JJum 생성 완료:', data.jjum.jjumName);
                    this.statusText = `✅ 새 점 생성: ${data.jjum.jjumName}`;
                    this.render();
                }
            })
            .catch(err => {
                console.error('JJum 생성 실패:', err);
            });
        }
    }
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
// 최적의 쩜(JJum) TOP 1~3을 실시간으로 갱신
// 해마 실시간 인지 쓰로틀: 논블로킹 백그라운드 스트리밍 + 실시간 쩜 생성 + 감정선 감지
HAEMA_CONSOLE.handleInput = function(inputValue) {
    // 빈 입력값은 무시
    if (!inputValue || !inputValue.trim()) {
        this.recallResults = [];
        this.answerGuide = null;
        this.status = "resting";
        this.statusText = "해마 쉬는 중...";
        this.emotionContext = null;
        this.stopBackgroundStream();
        this.render();
        return;
    }
    
    // 타이핑 시작 시간 기록
    if (!this.typingStartTime) {
        this.typingStartTime = Date.now();
    }
    this.lastKeystrokeTime = Date.now();
    this.lastInputValue = inputValue;
    
    // 상태 업데이트: 백그라운드 스트리밍 중
    if (this.status !== "working") {
        this.status = "working";
        this.statusText = "🧠 해마 실시간 인지 중... (타이핑 호흡에 맞춰 배경 작업)";
        this.render();
    }
    
    // 1. 논블로킹 백그라운드 스트리밍: 0.5초 간격으로 스냅샷 전달
    this.startBackgroundStream(inputValue);
    
    // 2. 실시간 키워드 감지 및 쩜 자동 생성 (입력 도중 키워드 포착)
    this.detectAndCreateKeywords(inputValue);
    
    // 3. 망설임 및 감정선 감지 (입력 호흡 변화 캐치)
    this.detectHesitationAndEmotion(inputValue);
    
    // 4. 연쇄적 쩜선 확장 (문장 완성 시 파생 정보 연결)
    this.extendSeonsFromContext(inputValue);
    
    // 5. 다정한 대화 가이드 제공 (감정/맥락 기반 호스트 챗봇 가이드)
    this.generateCompassionateGuide(inputValue);
    
    // 쓰로틀 타이머 설정 (0.5초)
    if (this.throttleTimer) {
        clearTimeout(this.throttleTimer);
    }
    this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
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
        
        // 가벼운 회상 시뮬레이션 (메인 스레드 블로킹 방지)
        setTimeout(() => {
            this.simulateRecall(inputValue);
        }, 0);
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

HAEMA_CONSOLE.openCreateModal = function() {
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
    this.modalMode = "apiKey";
    this.modalData = {
        apiKey: localStorage.getItem("haema_api_key") || "",
        provider: localStorage.getItem("haema_api_provider") || "",
        model: localStorage.getItem("haema_api_model") || "",
        baseURL: localStorage.getItem("haema_api_base_url") || "",
    };
    this.render();
    const overlay = document.getElementById("modalOverlay");
    if (overlay) {
        overlay.classList.add("active");
        overlay.style.display = "flex";
    }
};

HAEMA_CONSOLE.openEditModal = function(jjumId) {
    const jjum = this.allJJums.find(j => j.jjumId === jjumId);
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
HAEMA_CONSOLE.saveApiKeyModal = function() {
    const provider = document.getElementById("modalApiProvider")?.value || "";
    const model = document.getElementById("modalApiModel")?.value.trim() || "";
    const apiKey = document.getElementById("modalApiKey")?.value || "";
    const baseURL = document.getElementById("modalApiBaseUrl")?.value.trim() || "";

    if (!provider) {
        alert("API 제공자를 선택해주세요!");
        return;
    }

    // localStorage에 저장
    localStorage.setItem("haema_api_provider", provider);
    localStorage.setItem("haema_api_model", model);
    localStorage.setItem("haema_api_key", apiKey);
    localStorage.setItem("haema_api_base_url", baseURL);

    console.log("API 키 설정 저장 완료:", { provider, model, apiKey: apiKey ? "(저장됨)" : "", baseURL });

    this.closeModal();
    this.render();
};
    if (this.modalMode === "apiKey") {
        this.saveApiKeyModal();
        return;
    }

    const jjumName = document.getElementById("modalJjumName")?.value.trim();
    const aliasesStr = document.getElementById("modalAliases")?.value.trim() || "";
    const type = document.getElementById("modalType")?.value || "인물";
    const tagsStr = document.getElementById("modalTags")?.value.trim() || "";
    const summary = document.getElementById("modalSummary")?.value.trim() || "";
    const factsStr = document.getElementById("modalFacts")?.value.trim() || "";
    const seonsStr = document.getElementById("modalSeons")?.value.trim() || "";

    if (!jjumName) {
        alert("쩜 이름을 입력해주세요!");
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
        const target = this.allJJums.find(j => j.jjumName === parts[0] || j.aliases.includes(parts[0]));
        if (!target) return null;
        const weight = parseFloat(parts[2]);
        if (isNaN(weight) || weight < 0 || weight > 1) return null;
        return { targetId: target.jjumId, weight: weight, label: parts[1] || "연결" };
    }).filter(t => t);

    if (this.modalMode === "create") {
        const newJjum = {
            jjumId: "jjum_" + Date.now(),
            jjumName: jjumName,
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
        this.allJJums.push(newJjum);
    } else {
        const idx = this.allJJums.findIndex(j => j.jjumId === this.modalData.jjumId);
        if (idx !== -1) {
            this.allJJums[idx] = {
                ...this.allJJums[idx],
                jjumName: jjumName,
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
    if (!inputText || !this.allJJums) {
        this.recallResults = [];
        this.render();
        return;
    }

    const words = inputText.split(/\s+/);
    const scoredJjums = this.allJJums
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

    scoredJjums.sort((a, b) => b.simulationScore - a.simulationScore);
    this.recallResults = scoredJjums.filter(j => j.simulationScore > 0).slice(0, 13);

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
            '<div class="rank-name">' + this.escapeHtml(jjum.jjumName) + '</div>' +
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
        (remaining > 0 ? '<div style="text-align: center; font-size: 12px; color: var(--text-secondary); padding: 8px;">↓ 아래 쩜 목록에서 전체 ' + this.recallResults.length + '개 확인</div>' : '') +
        '</div>';
};

HAEMA_CONSOLE.renderModal = function() {
    const modalContent = this.modalMode && this.modalData ? this.renderModalContent() : '';
    let modeText = '';
    let titlePrefix = '';
    let saveText = '';

    if (this.modalMode === 'create') {
        modeText = '✨ 새 쩜(JJum) 만들기';
        titlePrefix = '✨ ';
        saveText = '✨ 만들기';
    } else if (this.modalMode === 'edit') {
        modeText = '✏️ 쩜(JJum) 수정';
        titlePrefix = '✏️ ';
        saveText = '💾 저장';
    } else if (this.modalMode === 'apiKey') {
        modeText = '🔑 API 키 설정';
        titlePrefix = '🔑 ';
        saveText = '💾 저장';
    }

    return '<div class="modal-overlay" id="modalOverlay">' +
        '<div class="modal">' +
        '<div class="modal-header">' +
        '<div class="modal-title">' + titlePrefix + modeText + '</div>' +
        '<div class="modal-close" id="modalClose">✕</div>' +
        '</div>' +
        '<div class="modal-body" id="modalBody">' + modalContent + '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-secondary" id="modalCancel">취소</button>' +
        '<button class="btn btn-primary" id="modalSave">' + saveText + '</button>' +
        '</div>' +
        '</div>' +
        '</div>';
};

HAEMA_CONSOLE.renderModalContent = function() {
    // API 키 설정 모달인 경우 API 제공자 선택 UI 반환
    if (this.modalMode === "apiKey") {
        const data = this.modalData || {};
        const savedProvider = data.provider || localStorage.getItem("haema_api_provider") || "";
        const savedModel = data.model || localStorage.getItem("haema_api_model") || "";
        const savedBaseUrl = data.baseURL || localStorage.getItem("haema_api_base_url") || "";
        
        return '<div class="form-group">' +
            '<label class="form-label" for="modalApiProvider">API 제공자 (Provider)</label>' +
            '<select class="form-select" id="modalApiProvider">' +
            '<option value="">선택하세요</option>' +
            '<optgroup label="주요 제공자">' +
            '<option value="openai" ' + (savedProvider === 'openai' ? 'selected' : '') + '>OpenAI</option>' +
            '<option value="anthropic" ' + (savedProvider === 'anthropic' ? 'selected' : '') + '>Anthropic</option>' +
            '<option value="google" ' + (savedProvider === 'google' ? 'selected' : '') + '>Google Gemini</option>' +
            '<option value="grok" ' + (savedProvider === 'grok' ? 'selected' : '') + '>Grok</option>' +
            '<option value="deepseek" ' + (savedProvider === 'deepseek' ? 'selected' : '') + '>DeepSeek</option>' +
            '</optgroup>' +
            '<optgroup label="프록시/호환">' +
            '<option value="openrouter" ' + (savedProvider === 'openrouter' ? 'selected' : '') + '>OpenRouter</option>' +
            '<option value="litellm" ' + (savedProvider === 'litellm' ? 'selected' : '') + '>LiteLLM</option>' +
           '<option value="ollama" ' + (savedProvider === 'ollama' ? 'selected' : '') + '>Ollama</option>' +
            '<option value="aws-bedrock" ' + (savedProvider === 'aws-bedrock' ? 'selected' : '') + '>AWS Bedrock</option>' +
            '<option value="openai-compatible" ' + (savedProvider === 'openai-compatible' ? 'selected' : '') + '>OpenAI Compatible</option>' +
            '</optgroup>' +
            '<optgroup label="기타">' +
            '<option value="302ai" ' + (savedProvider === '302ai' ? 'selected' : '') + '>302.AI</option>' +
            '<option value="abacus" ' + (savedProvider === 'abacus' ? 'selected' : '') + '>Abacus</option>' +
            '<option value="custom" ' + (savedProvider === 'custom' ? 'selected' : '') + '>직접 입력 (Custom)</option>' +
            '</optgroup>' +
            '</select>' +
            '<div class="form-hint">사용할 API 제공자를 선택하세요.</div>' +
            '</div>' +
            '<div class="form-group" id="modalModelGroup">' +
            '<label class="form-label" for="modalApiModel">모델</label>' +
            '<input class="form-input" id="modalApiModel" type="text" value="' + this.escapeHtml(savedModel) + '" placeholder="예: gpt-4o, claude-3-opus, gemini-pro">' +
            '<div class="form-hint">사용할 모델 이름을 입력하세요.</div>' +
            '</div>' +
            '<div class="form-group">' +
            '<label class="form-label" for="modalApiKey">API 키</label>' +
            '<input class="form-input" id="modalApiKey" type="password" value="' + this.escapeHtml(data.apiKey || localStorage.getItem("haema_api_key") || "") + '" placeholder="sk-...">' +
            '<div class="form-hint">API 키를 입력하세요.</div>' +
            '</div>' +
            '<div class="form-group" id="modalBaseUrlGroup">' +
            '<label class="form-label" for="modalApiBaseUrl">Base URL (선택사항)</label>' +
            '<input class="form-input" id="modalApiBaseUrl" type="url" value="' + this.escapeHtml(savedBaseUrl) + '" placeholder="https://api.example.com/v1">' +
            '<div class="form-hint">OpenAI 호환 API나 자체 서버의 Base URL입니다.</div>' +
            '</div>';
    }

    // 쩜 생성/수정 모달인 경우 기존 폼 반환
    const data = this.modalData || {};
    
    // API 키 모달인 경우 provider select 렌더링
    if (this.modalMode === 'apiKey') {
        return this.renderApiKeyModalContent(data);
    }
    
    const aliasesStr = (data.aliases || []).join(', ');
    const tagsStr = (data.tags || []).join(', ');
    const factsStr = (data.facts || []).map(f => f.text).join('\n');
    const seonsStr = (data.seons || []).map(t => {
        const target = this.allJJums.find(j => j.jjumId === t.targetId);
        const targetName = target ? target.jjumName : '';
        return targetName + ' | ' + (t.label || '연결') + ' | ' + t.weight;
    }).join('\n');
    
    return '<div class="form-group">' +
        '<label class="form-label" for="modalJjumName">쩜 이름 *</label>' +
        '<input class="form-input" id="modalJjumName" type="text" value="' + this.escapeHtml(data.jjumName || '') + '" placeholder="예: 홍길동">' +
        '<div class="form-hint">쩜의 대표 이름입니다. 어떤 이름으로 불러도 이 쩜을 찾을 수 있습니다.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalAliases">별칭 (쉼표로 구분)</label>' +
        '<input class="form-input" id="modalAliases" type="text" value="' + this.escapeHtml(aliasesStr) + '" placeholder="예: 지수, 지슈, 그 친구">' +
        '<div class="form-hint">별칭을 입력하면 그 이름으로도 쩜을 찾을 수 있습니다.</div>' +
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
        '<div class="form-group">' +
        '<label class="form-label" for="modalSeons">쩜선 (Seons) - 연결된 쩜 (한 줄에 하나씩, 형식: 대상이름 | 연결라벨 | 가중치(0~1))</label>' +
        '<textarea class="form-textarea" id="modalSeons" rows="3" placeholder="예: 홍길동 | 친구 | 0.8&#10;김철수 | 동료 | 0.5">' + this.escapeHtml(seonsStr) + '</textarea>' +
        '<div class="form-hint">쩜과 다른 쩜을 연결하는 선입니다. 한 줄에 하나씩, 파이프(|)로 구분하세요.</div>' +
        '</div>' +
    '</div>';
};

// ===== API 키 모달 콘텐츠 렌더링 =====
HAEMA_CONSOLE.renderApiKeyModalContent = function(data) {
    const providers = [
        { value: 'openai', label: 'OpenAI ChatGPT Subscription' },
        { value: 'deepseek', label: 'DeepSeek' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'openrouter', label: 'OpenRouter' },
        { value: 'grok', label: 'Grok' },
        { value: 'ollama', label: 'Ollama' },
        { value: 'aws-bedrock', label: 'AWS Bedrock' },
        { value: 'openai-compatible', label: 'OpenAI Compatible' },
        { value: 'litellm', label: 'LiteLLM' },
        { value: 'google-gemini', label: 'Google Gemini' },
        { value: '302ai', label: '302.AI' },
        { value: 'abacus', label: 'Abacus' },
        { value: 'abliteration', label: 'abliteration.ai' },
        { value: 'abovedev', label: 'above.dev' },
        { value: 'agenterouter', label: 'AgentRouter' },
        { value: 'agnes-ai', label: 'Agnes AI' },
        { value: 'aihub-mix', label: 'AI Hub Mix' },
        { value: 'ai-router', label: 'AI-ROUTER' },
        { value: 'ai-and', label: 'ai&' },
        { value: 'aixy', label: 'Aixy' },
        { value: 'aki-io', label: 'AKI.IO' },
        { value: 'alibaba', label: 'Alibaba' },
        { value: 'alibaba-china', label: 'Alibaba (China)' },
        { value: 'alibaba-coding-plan', label: 'Alibaba Coding Plan' },
        { value: 'alibaba-coding-plan-china', label: 'Alibaba Coding Plan (China)' },
        { value: 'alibaba-qwen', label: 'Alibaba Qwen' },
        { value: 'alibaba-qwen-code', label: 'Alibaba Qwen Code' },
        { value: 'custom', label: 'Custom' }
    ];
    
    const providerOptions = providers.map(p => 
        '<option value="' + p.value + '"' + (data.provider === p.value ? ' selected' : '') + '>' + p.label + '</option>'
    ).join('');
    
    return '<div class="form-group">' +
        '<label class="form-label" for="modalProvider">API 제공자 (Provider) *</label>' +
        '<select class="form-select" id="modalProvider">' +
        providerOptions +
        '</select>' +
        '<div class="form-hint">사용할 AI API 제공자를 선택하세요.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalModel">모델 *</label>' +
        '<input class="form-input" id="modalModel" type="text" value="' + this.escapeHtml(data.model || '') + '" placeholder="예: gpt-4o, claude-3-opus, gemini-pro">' +
        '<div class="form-hint">사용할 모델 이름입니다.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalApiKey">API 키 *</label>' +
        '<input class="form-input" id="modalApiKey" type="password" value="' + this.escapeHtml(data.apiKey || '') + '" placeholder="sk-...">' +
        '<div class="form-hint">API 키를 입력하세요.</div>' +
        '</div>' +
        '<div class="form-group">' +
        '<label class="form-label" for="modalBaseURL">Base URL (선택)</label>' +
        '<input class="form-input" id="modalBaseURL" type="url" value="' + this.escapeHtml(data.baseURL || '') + '" placeholder="https://api.example.com/v1">' +
        '<div class="form-hint">OpenAI 호환 제공자의 경우 baseURL을 입력하세요.</div>' +
        '</div>';
};
};
HAEMA_CONSOLE.generateHostPreview = function(inputText) {
    const topRecall = this.recallResults.slice(0, 3);
    if (topRecall.length === 0) {
        return '음... 그 이야기는 잘 기억나지 않네요. 좀 더 자세히 말해줄 수 있나요?';
    }
    
    const names = topRecall.map(j => j.jjumName);
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

// ===== 쩜 토글 =====
HAEMA_CONSOLE.toggleJjum = function(jjumId) {
    if (this.selectedJjumId === jjumId) {
        this.selectedJjumId = null;
    } else {
        this.selectedJjumId = jjumId;
    }
    this.render();
};

// ===== 쩜 삭제 확인 =====
HAEMA_CONSOLE.confirmDelete = function(jjumId) {
    const jjum = this.allJJums.find(j => j.jjumId === jjumId);
    if (!jjum) return;
    
    if (confirm('정말 "' + jjum.jjumName + '" 쩜을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        this.allJJums = this.allJJums.filter(j => j.jjumId !== jjumId);
        if (this.selectedJjumId === jjumId) {
            this.selectedJjumId = null;
        }
        this.render();
    }
};

// ===== 초기화 =====
HAEMA_CONSOLE.init = function() {
    this.render();
    // 로컬 서버에서 JJum 데이터 로딩 시도
    this.loadLocalServerData();
    console.log("HAEMA_CONSOLE 초기화 완료");
};

// ===== 로컬 서버 데이터 로딩 =====
// 로컬 서버(local-server/haema/)에 저장된 JJum 데이터를 불러옴
// 브라우저에서 직접 파일 시스템 접근은 불가능하므로,
// 로컬 서버 API를 통해 데이터를 받아오는 방식으로 구현 예정
// 현재는 fetch()로 로컬 서버 API 호출하는 구조만 잡아둠
HAEMA_CONSOLE.loadLocalServerData = function() {
    // 로컬 서버 API에서 데이터 로딩
    // 서버 실행 전에는 실패해도 무시
    fetch('/api/owners/demo/jjums')
        .then(response => {
            if (!response.ok) throw new Error('API 응답 오류');
            return response.json();
        })
        .then(data => {
            this.allJJums = data.jjums || [];
            this.render();
            console.log('로컬 서버 데이터 로딩 완료:', this.allJJums.length, '개 쩜');
        })
        .catch(err => {
            // 로컬 서버가 실행되지 않았으면 조용히 무시
            console.log('로컬 서버 미실행 — 데이터 로딩 건너뜀:', err.message);
        });
};

// ===== 연쇄적 쩜선 확장 =====
// 문장이 완성됨에 따라 파생 정보(예: 뇸뇸이_건강상태.jj)를 추가 점으로 연결하고
// 쩜선으로 엮어 입체적인 기억 구조를 구축
HAEMA_CONSOLE.extendSeonsFromContext = function(inputValue) {
    if (!inputValue || !inputValue.trim()) return;
    
    const mentionedJjums = this.findMentionedJjums(inputValue);
    
    if (mentionedJjums.length >= 2) {
        const sourceJjum = mentionedJjums[0];
        for (let i = 1; i < mentionedJjums.length; i++) {
            const targetJjum = mentionedJjums[i];
            this.createSeonConnection(sourceJjum, targetJjum, inputValue);
        }
    }
    
    this.createDerivativeJjums(inputValue, mentionedJjums);
};

HAEMA_CONSOLE.findMentionedJjums = function(inputValue) {
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

HAEMA_CONSOLE.createSeonConnection = function(sourceJjum, targetJjum, context) {
    const existingSeon = sourceJjum.seons?.find(s => s.targetId === targetJjum.jjumId);
    if (existingSeon) {
        existingSeon.weight = Math.min(1, (existingSeon.weight || 0.5) + 0.1);
        existingSeon.lastActivated = new Date().toISOString();
        return;
    }
    
    if (!sourceJjum.seons) {
        sourceJjum.seons = [];
    }
    sourceJjum.seons.push({
        targetId: targetJjum.jjumId,
        weight: 0.5,
        label: this.inferSeonLabel(sourceJjum, targetJjum, context),
        lastActivated: new Date().toISOString(),
    });
    
    this.statusText = `🔗 쩜선 연결: ${sourceJjum.jjumName || sourceJjum.jjumName} ↔ ${targetJjum.jjumName || targetJjum.jjumName}`;
    this.render();
};

HAEMA_CONSOLE.inferSeonLabel = function(sourceJjum, targetJjum, context) {
    const lowerContext = context.toLowerCase();
    if (lowerContext.includes('건강') || lowerContext.includes('병원') || lowerContext.includes('상태')) return '건강상태';
    if (lowerContext.includes('키우') || lowerContext.includes('내') || lowerContext.includes('나의')) return '소유/관계';
    return '연결';
};

HAEMA_CONSOLE.createDerivativeJjums = function(inputValue, mentionedJjums) {
    const lowerInput = inputValue.toLowerCase();
    
    if (lowerInput.includes('건강') || lowerInput.includes('병원') || lowerInput.includes('상태') || lowerInput.includes('진료')) {
        mentionedJjums.forEach(jjum => {
            const baseName = jjum.jjumName || jjum.jjumName || '';
            const derivativeName = `${baseName}_건강상태`;
            
            const existing = this.allJJums.find(j => 
                j.jjumName === derivativeName || 
                j.jjumName === derivativeName
            );
            
            if (!existing) {
                this.createKeywordJjum(derivativeName, `${baseName}의 건강 상태 관련 정보`);
                
                if (!jjum.seons) {
                    jjum.seons = [];
                }
                const existingSeon = jjum.seons.find(s => s.label === '건강상태');
                if (!existingSeon) {
                    jjum.seons.push({
                        targetId: derivativeName,
                        weight: 0.7,
                        label: '건강상태',
                        lastActivated: new Date().toISOString(),
                    });
                }
            }
        });
    }
};

// ===== 다정한 대화 가이드 제공 =====
// 해마가 분석한 실시간 감정과 기억 맥락을 바탕으로,
// 호스트 챗봇이 건넬 수 있는 최적의 위로와 다정한 대화 가이드를 도출
HAEMA_CONSOLE.generateCompassionateGuide = function(inputValue) {
    if (!inputValue || !inputValue.trim()) {
        this.answerGuide = null;
        return;
    }
    
    const guide = {
        input: inputValue,
        timestamp: new Date().toISOString(),
        recallCount: this.recallResults.length,
        topRecall: this.recallResults.slice(0, 3).map(j => j.jjumName || j.jjumName),
        emotionContext: this.emotionContext,
        hostPreview: this.generateHostPreview(inputValue),
    };
    
    this.answerGuide = guide;
};

HAEMA_CONSOLE.generateHostPreview = function(inputText) {
    const lowerInput = inputText.toLowerCase();
    const guideParts = [];
    
    if (lowerInput.includes('걱정') || lowerInput.includes('불안') || lowerInput.includes('무서')) {
        guideParts.push('💛 걱정되는 마음이 느껴져요. 천천히 이야기해 주세요.');
    }
    if (lowerInput.includes('병원') || lowerInput.includes('진료') || lowerInput.includes('건강')) {
        if (lowerInput.includes('고양이') || lowerInput.includes('강아지') || lowerInput.includes('뇸뇸')) {
            guideParts.push('🐱 반려동물 건강 걱정이시군요. 병원 다녀오신 후 어떠셨나요?');
            guideParts.push('💡 너무 가슴 아파할 수 있으니, 일단 위로나 건네보는 건 어떨까요?');
        } else {
            guideParts.push('🏥 병원/건강 관련 이야기시군요. 어떤 점이 가장 걱정되시나요?');
        }
    }
    if (lowerInput.includes('슬픔') || lowerInput.includes('힘들') || lowerInput.includes('괴롭')) {
        guideParts.push('💚 힘든 마음이 느껴져요. 제가 여기 있어요.');
    }
    if (lowerInput.includes('놀람') || lowerInput.includes('깜짝') || lowerInput.includes('갑자기')) {
        guideParts.push('✨ 갑작스러운 일이 있었군요. 놀라고 당황스러우셨겠어요.');
    }
    
    if (guideParts.length === 0) {
        if (lowerInput.includes('고양이') || lowerInput.includes('강아지') || lowerInput.includes('뇸뇸')) {
            guideParts.push('🐾 반려동물 이야기시군요! 어떤 아이인가요?');
        } else {
            guideParts.push('💛 말씀해 주신 내용 잘 들었어요. 더 나누고 싶은 이야기가 있으신가요?');
        }
    }
    
    return guideParts.join(' ');
};

// ===== API 키 저장 =====
HAEMA_CONSOLE.saveApiKeyModal = function() {
    const provider = document.getElementById("modalProvider")?.value;
    const model = document.getElementById("modalModel")?.value.trim();
    const apiKey = document.getElementById("modalApiKey")?.value;
    const baseURL = document.getElementById("modalBaseURL")?.value.trim();

    if (!provider) {
        alert("API 제공자를 선택해주세요!");
        return;
    }
    if (!model) {
        alert("모델 이름을 입력해주세요!");
        return;
    }
    if (!apiKey) {
        alert("API 키를 입력해주세요!");
        return;
    }

    const savedKey = localStorage.getItem("haema_api_key") || "";
    const existingProvider = localStorage.getItem("haema_api_provider") || "";
    const existingModel = localStorage.getItem("haema_api_model") || "";
    const existingBaseURL = localStorage.getItem("haema_api_base_url") || "";

    // 새 설정 저장
    localStorage.setItem("haema_api_key", apiKey);
    localStorage.setItem("haema_api_provider", provider);
    localStorage.setItem("haema_api_model", model);
    localStorage.setItem("haema_api_base_url", baseURL || "");

    this.statusText = `✅ API 키 저장 완료: ${provider} / ${model}`;
    this.render();
    this.closeModal();
};

document.addEventListener("DOMContentLoaded", () => {
    HAEMA_CONSOLE.init();
});
