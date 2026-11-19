// @editedBy SherrySherry 2026-11-19
// @editedBy SherrySherry 2026-09-24
// @editedBy YAONG1230 2026-10-18
// @editedBy YAONG1230 2026-10-28: 저장소 모달 키보드와 초점 복원
// @editedBy SherrySherry 2026-11-17
// ============================================================
// haema-storage-modal.js
// 로컬 저장소(쩜통) 연결/생성 모달
// ============================================================

window.HAEMA_STORAGE_MODAL = (function () {
    let consoleRef = null;
    let storageRequestGeneration = 0;
    let pendingInit = null;
    const modalFocus = new WeakMap();
    const safeMessages = new WeakMap();
    const missingConnections = new WeakSet();

    function connectionFailure(error) {
        if (missingConnections.has(error)) return "쩜통 버튼에서 쩜통을 다운로드한 뒤 압축을 풀고 시작 파일을 열어 주세요. 이미 준비했다면 같은 시작 파일을 다시 열어 주세요. 입력한 경로는 그대로 남아 있어요.";
        try {
            const message = globalThis.HAEMA_LOCAL_CONNECTION?.describeFailure?.(error);
            return typeof message === "string" && message ? message : null;
        } catch { return null; }
    }
    function safeError(message, status) {
        const http = Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : "";
        const error = new Error("STORAGE_OPERATION_FAILED");
        safeMessages.set(error, message + http);
        return error;
    }
    function safeFailure(error, fallback) { return connectionFailure(error) || safeMessages.get(error) || fallback; }
    function showFailure(error, fallback) {
        const state = globalThis.HAEMA_LOCAL_CONNECTION?.status?.();
        const openDownload = connectionFailure(error) && (missingConnections.has(error)
            || state?.connection === 'setup-required' && !state.remembered);
        const reconnect = openDownload ? openModal : connectionFailure(error) && globalThis.HAEMA_RECONNECT_LOCAL;
        return HAEMA_DIALOG.alert(safeFailure(error, fallback), { tone: 'error',
            ...(typeof reconnect === 'function' ? { confirmText: openDownload ? '쩜통 다운로드' : '다시 연결', onConfirm: reconnect } : {}) });
    }

    async function requestLocal(operation, input = {}) {
        const connection = globalThis.HAEMA_LOCAL_CONNECTION;
        if (!connection || typeof connection.request !== "function") {
            const error = new Error("CONNECTION_REQUIRED");
            missingConnections.add(error);
            throw error;
        }
        return connection.request(operation, input);
    }

    function isOpen(overlay) {
        return !!overlay && overlay.isConnected && overlay.classList.contains("active");
    }

    function availableControl(element) {
        return element && element !== document.body && !element.disabled && element.isConnected && element.getClientRects().length &&
            getComputedStyle(element).visibility !== "hidden";
    }

    function focusReference(element) {
        return { element, id: element?.id || "" };
    }

    function focusInside(overlay) {
        if (!isOpen(overlay) || document.querySelector("dialog[open]")) return;
        const options = overlay.querySelector("#storageManageOptions");
        const preferred = options && !options.open ? overlay.querySelector("#storageManageSummary") :
            overlay.querySelector("#storageDownloadPlatform, #storagePathInput:not(:disabled), #storageDirectInputBtn, #existingStorageConnectBtn");
        const target = availableControl(preferred) ? preferred : overlay.querySelector("button:not(:disabled)");
        if (availableControl(target)) target.focus({ preventScroll: true });
    }

    function restoreFocus(reference, fallbackOverlay) {
        if (document.querySelector("dialog[open]")) return;
        const target = availableControl(reference?.element) ? reference.element :
            reference?.id ? document.getElementById(reference.id) : null;
        if (availableControl(target) && (!fallbackOverlay || fallbackOverlay.contains(target))) {
            target.focus({ preventScroll: true });
        } else if (isOpen(fallbackOverlay)) {
            focusInside(fallbackOverlay);
        } else {
            const storageButton = document.getElementById("storageBtn");
            if (availableControl(storageButton)) storageButton.focus({ preventScroll: true });
        }
    }

    function bindModalKeyboard(overlay, close) {
        overlay.addEventListener("keydown", function(event) {
            const top = [...document.querySelectorAll(".modal-overlay.active")].at(-1);
            if (!isOpen(overlay) || top !== overlay || event.defaultPrevented || event.isComposing ||
                event.keyCode === 229 || document.querySelector("dialog[open]")) return;
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
            }
            if (event.key !== "Tab") return;
            const controls = [...overlay.querySelectorAll("button, input, select, textarea, summary, a[href], [tabindex]")]
                .filter(element => element.tabIndex >= 0 && availableControl(element));
            const first = controls[0], last = controls.at(-1);
            if (!first) return;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
    }

    // 실제 저장소 연결 상태 표시용
    const STORAGE_PATH_KEY = "haema_storage_root";

    function setConsole(consoleObj) {
        storageRequestGeneration += 1;
        consoleRef = consoleObj;
    }

    function getStoredPath() {
        return localStorage.getItem(STORAGE_PATH_KEY) || "";
    }

    function clearStoredPath() {
        localStorage.removeItem(STORAGE_PATH_KEY);
    }

    // 서버가 확인한 저장소 상태만 연결 상태로 사용한다.
    function applyStorageStatus(status) {
        const connected = status.connected === true;
        if (connected) {
            localStorage.setItem(STORAGE_PATH_KEY, status.storageRoot);
            localStorage.setItem("haema_storage_path", status.storageRoot);
            localStorage.setItem("haema_storage_mode", "direct_input");
        } else {
            clearStoredPath();
            localStorage.removeItem("haema_storage_path");
        }
        if (consoleRef) {
            consoleRef.storageConnected = connected;
            const hasIdentity = connected && typeof status.storageRoot === "string" && status.storageRoot.length > 0 &&
                typeof status.storageId === "string" && status.storageId.length > 0 &&
                status.storageId.length <= 512 && status.storageId.trim() === status.storageId;
            consoleRef.storageIdentity = hasIdentity
                ? { storageRoot: status.storageRoot, storageId: status.storageId }
                : null;
            consoleRef.updateJJumList(connected ? status.jjums || [] : []);
        }
        const overlay = document.getElementById("storageModalOverlay");
        if (isOpen(overlay)) modalFocus.get(overlay)?.showStatus?.(status);
    }

    async function autoConnectStorage() {
        // 연결 도중의 이전 상태를 읽어 실제 연결 완료 응답을 덮지 않는다.
        while (pendingInit) {
            try { await pendingInit; } catch { /* 연결 오류는 해당 모달에서 안내한다. */ }
        }
        const generation = ++storageRequestGeneration;
        try {
            const response = await requestLocal("storage.status");
            if (!response.ok) throw safeError("저장소 상태를 확인할 수 없습니다.", response.status);
            const status = await response.json();
            if (generation !== storageRequestGeneration) return { stale: true };
            if (!status || typeof status.connected !== "boolean" ||
                (status.connected && (typeof status.storageRoot !== "string" || !status.storageRoot.trim() ||
                    typeof status.storageId !== "string" || !status.storageId.trim() ||
                    (status.jjums !== undefined && !Array.isArray(status.jjums))))) {
                throw safeError("저장소 상태를 확인할 수 없습니다.", response.status);
            }
            applyStorageStatus(status);
            return status;
        } catch {
            if (generation !== storageRequestGeneration) return { stale: true };
            // A failed check must not clear saved paths or the visible memory list.
            if (consoleRef) {
                consoleRef.storageConnected = false;
                consoleRef.storageIdentity = null;
            }
            const unavailable = { connected: false, state: "unavailable" };
            const overlay = document.getElementById("storageModalOverlay");
            if (isOpen(overlay)) modalFocus.get(overlay)?.showStatus?.(unavailable);
            return unavailable;
        }
    }

    async function handleFolderSelect(overlay) {
        const pathInput = overlay.querySelector("#storagePathInput");
        const hint = overlay.querySelector("#storageFolderHint");
        const response = await requestLocal("storage.pick");
        if (!isOpen(overlay)) return false;
        if (!response.ok) {
            throw safeError("폴더 선택 기능을 사용할 수 없어요. 실행 프로그램을 최신 파일로 업데이트하고 다시 연결해 주세요.", response.status);
        }
        const selected = await response.json();
        if (!isOpen(overlay)) return false;
        if (selected?.cancelled === true) return false;
        if (selected?.success !== true || selected?.cancelled !== false ||
            typeof selected.storageRoot !== "string" || !selected.storageRoot.trim() ||
            /[\u0000-\u001f\u007f]/.test(selected.storageRoot)) {
            throw safeError("선택한 폴더 경로를 확인할 수 없어요. 다시 선택해 주세요.", response.status);
        }
        pathInput.value = selected.storageRoot;
        pathInput.disabled = false;
        hint.textContent = "폴더가 선택됐어요. [생성 + 연결]을 눌러주세요.";
        pathInput.focus();
        return true;
    }

    function handleDirectInput(storagePath, forceCreate = false, connectExisting = false) {
        const generation = ++storageRequestGeneration;
        const operation = (async function() {
            try {
                const response = await requestLocal("storage.init", {
                    storageRoot: storagePath, forceCreate, connectExisting
                });
                const result = await response.json();
                if (generation !== storageRequestGeneration) return { stale: true };
                if (!response.ok || !result.success) {
                    throw safeError("저장소 연결 요청을 완료하지 못했어요. 입력한 경로는 그대로 남아 있어요.", response.status);
                }
                if (result.exists && result.connected !== true && !forceCreate && !connectExisting) {
                    return { exists: true, path: result.path, result };
                }
                if (result.connected !== true) {
                    throw safeError("저장소 연결 완료를 확인할 수 없어요.", response.status);
                }
                applyStorageStatus(result);
                if (consoleRef && typeof consoleRef.refreshApiStatus === "function") {
                    await consoleRef.refreshApiStatus();
                }
                if (generation !== storageRequestGeneration) return { stale: true };
                return { exists: false, connected: true, path: result.path, result };
            } catch (error) {
                if (generation !== storageRequestGeneration) return { stale: true };
                throw error;
            }
        })();
        const pending = operation.finally(function() {
            if (pendingInit === pending) pendingInit = null;
        });
        pendingInit = pending;
        return pending;
    }

    function bindDownloads(overlay) {
        const platform = overlay.querySelector("#storageDownloadPlatform");
        const link = overlay.querySelector("#storageDownloadLink");
        const notice = overlay.querySelector("#storageDownloadNotice");
        const downloads = globalThis.HAEMA_STORAGE_DOWNLOADS;
        let release = { state: "loading" };
        platform.value = downloads?.detectPlatform?.() || "";

        function updateLink() {
            const asset = release.downloads?.[platform.value];
            link.textContent = asset?.restricted ? "Windows 테스트용 쩜통 다운로드" : "쩜통 다운로드";
            link.removeAttribute("download");
            if (asset) {
                link.href = asset.url;
                link.setAttribute("aria-disabled", "false");
                if (asset.restricted) {
                    notice.textContent = "공유받은 Google 계정으로 파일을 다운로드해 주세요. 압축을 풀고 대화 테스트는 StartAI.cmd, 설정만 확인할 때는 Start.cmd를 여세요. 처음 선택한 폴더에 이 PC의 실행 프로그램과 쩜통을 설치해요.";
                    return;
                }
                link.download = asset.fileName;
                const startFile = platform.value === "windows" ? "Start.cmd" : "Start.command";
                notice.textContent = "압축을 풀고 " + startFile + " 파일을 여세요. 폴더 선택 창에서 쩜통을 보관할 위치를 고른 뒤, 다시 열린 웹콘솔에서 연결을 허용해 주세요.";
                return;
            }
            link.removeAttribute("href");
            link.setAttribute("aria-disabled", "true");
            if (release.state === "loading") notice.textContent = "다운로드할 수 있는 파일을 확인하고 있어요.";
            else if (release.state === "unavailable") notice.textContent = "다운로드 파일을 확인할 수 없어요. 잠시 후 쩜통 버튼을 다시 열어 주세요.";
            else if (!platform.value) notice.textContent = "사용할 컴퓨터의 운영체제를 선택해 주세요.";
            else notice.textContent = "이 운영체제용 파일은 아직 공개되지 않았어요.";
        }

        platform.addEventListener("change", updateLink);
        link.addEventListener("click", event => {
            if (!link.href) event.preventDefault();
        });
        overlay.querySelector("#storageReconnectBtn")?.addEventListener("click", () => {
            globalThis.HAEMA_RECONNECT_LOCAL?.();
        });
        updateLink();
        void (async () => {
            try { release = await downloads.load(); }
            catch { release = { state: "unavailable" }; }
            if (isOpen(overlay)) updateLink();
        })();
    }

    function openModal(previous) {
        const app = document.getElementById("app");
        if (!app) return;
        const existing = document.getElementById("storageModalOverlay");
        if (isOpen(existing)) {
            focusInside(document.getElementById("existingStorageModalOverlay") || existing);
            return;
        }
        // 닫힘 전환 중 재열어도 같은 ID의 폼이 두 개 남지 않는다.
        if (existing) existing.remove();
        const returnFocus = previous?.returnFocus || focusReference(document.activeElement);
        const connected = globalThis.HAEMA_LOCAL_CONNECTION?.status?.().connection === 'connected';
        const downloadControls = [
            '        <label class="form-label" for="storageDownloadPlatform">내 컴퓨터의 운영체제</label>',
            '        <select class="form-input" id="storageDownloadPlatform">',
            '          <option value="">운영체제를 선택해 주세요</option>',
            '          <option value="windows">Windows (64비트)</option>',
            '          <option value="macos">macOS (Apple Silicon / Intel)</option>',
            '        </select>',
            '        <a class="btn" id="storageDownloadLink" target="_blank" rel="noopener noreferrer" aria-disabled="true">쩜통 다운로드</a>',
            '        <p class="form-hint" id="storageDownloadNotice" role="status"></p>',
        ].join("\n");
        const body = !connected ? [
            '      <div class="form-group" id="storageDownloadSetup">',
            downloadControls,
            '        <button class="btn" id="storageReconnectBtn" type="button">이미 설치한 쩜통 연결</button>',
            '      </div>',
        ].join("\n") : [
            '      <p class="form-hint" id="storageConfirmedPath" role="status"></p>',
            '      <details id="storageManageOptions">',
            '        <summary id="storageManageSummary">저장 폴더 설정</summary>',
            '      <div class="form-group">',
            '        <label class="form-label" for="storagePathInput">저장소 경로</label>',
            '        <div class="input-group">',
            '          <input type="text" class="form-input" id="storagePathInput" placeholder="/Users/yourname/Documents/해마" />',
            '          <button class="btn" id="storageFolderSelectBtn" type="button">',
            '            📁 폴더 선택',
            '          </button>',
            '          <button class="btn" id="storageDirectInputBtn" type="button">',
            '            ✏️ 직접 입력',
            '          </button>',
            '          <button class="btn" id="storagePathClearBtn" type="button" style="display: none;">',
            '            ❌ 지우기',
            '          </button>',
            '        </div>',
            '        <div class="form-hint" id="storageFolderHint">',
            '          해마 장기기억 저장소가 생성될 상위 폴더 경로를 입력하거나 폴더를 선택하세요.',
            '        </div>',
            '      </div>',

            '      <div class="form-group">',
            '        <button class="btn btn-create" id="storageCreateBtn" type="button">',
            '          생성 + 연결',
            '        </button>',
            '        <button class="btn btn-clear" id="storageClearBtn" type="button" style="display: none;">',
            '          캐시 지우기',
            '        </button>',
            '      </div>',

            '      </details>',
            '      <details id="storageDownloadOptions">',
            '        <summary>쩜통 설치 파일 다운로드</summary>',
            downloadControls,
            '      </details>',
        ].join("\n");

        const modalHtml = [
            '<div class="modal-overlay" id="storageModalOverlay">',
            '  <div class="modal" id="storageModal" role="dialog" aria-modal="true" aria-labelledby="storageModalTitle">',
            '    <div class="modal-header">',
            '      <div class="modal-title" id="storageModalTitle">🪣 ' + (connected ? "내 쩜통" : "쩜통 다운로드") + '</div>',
            '      <button class="modal-close" id="storageModalClose" type="button" aria-label="쩜통 창 닫기">&times;</button>',
            '    </div>',

            '    <div class="modal-body">',
            body,
            '    </div>',
            '  </div>',
            '</div>',
        ].join("\n");

        app.insertAdjacentHTML("beforeend", modalHtml);

        const overlay = document.getElementById("storageModalOverlay");
        const closeBtn = document.getElementById("storageModalClose");
        if (!overlay || !closeBtn) return;
        overlay.classList.add("active");
        const state = { returnFocus, draft: previous?.draft };
        modalFocus.set(overlay, state);
        closeBtn.addEventListener("click", () => closeModal(overlay));
        bindModalKeyboard(overlay, () => closeModal(overlay));
        overlay.addEventListener("click", event => {
            if (event.target === overlay) closeModal(overlay);
        });

        state.unsubscribe = globalThis.HAEMA_LOCAL_CONNECTION?.subscribe?.(next => {
            if (!isOpen(overlay) || (next.connection === "connected") === connected) return;
            const child = document.getElementById("existingStorageModalOverlay");
            if (modalFocus.get(child)?.parent === overlay) closeExistingModal(child, false);
            state.unsubscribe?.();
            overlay.remove();
            openModal({ returnFocus, draft: state.draft });
        });
        if (!connected) {
            bindDownloads(overlay);
            focusInside(overlay);
            return;
        }

        const downloadOptions = overlay.querySelector("#storageDownloadOptions");
        function openDownloads() {
            if (!downloadOptions.open) return;
            downloadOptions.removeEventListener("toggle", openDownloads);
            bindDownloads(overlay);
        }
        downloadOptions.addEventListener("toggle", openDownloads);

        const createBtn = overlay.querySelector("#storageCreateBtn");
        const folderSelectBtn = overlay.querySelector("#storageFolderSelectBtn");
        const directInputBtn = overlay.querySelector("#storageDirectInputBtn");
        const pathInput = overlay.querySelector("#storagePathInput");
        const pathClearBtn = overlay.querySelector("#storagePathClearBtn");
        const clearBtn = overlay.querySelector("#storageClearBtn");
        const folderHint = overlay.querySelector("#storageFolderHint");

        const confirmed = overlay.querySelector("#storageConfirmedPath");
        const options = overlay.querySelector("#storageManageOptions");
        const storedPath = getStoredPath();
        function setInitialPath(value) {
            pathInput.value = value;
            pathInput.disabled = !!value;
            folderSelectBtn.textContent = value ? "📁 다시 선택" : "📁 폴더 선택";
            pathClearBtn.style.display = value ? "inline-block" : "none";
            clearBtn.style.display = value ? "inline-block" : "none";
        }
        function keepDraft() {
            state.draft = { value: pathInput.value, hint: folderHint.textContent };
        }
        state.showStatus = status => {
            if (status?.connected === true && typeof status.storageRoot === "string" && status.storageRoot.trim()) {
                confirmed.textContent = "연결된 쩜통 위치 · " + status.storageRoot;
                if (!state.draft) setInitialPath(status.storageRoot);
            } else if (status?.state === "unavailable") {
                confirmed.textContent = "저장 위치를 확인하지 못했어요.";
            } else if (status?.connected === false) {
                confirmed.textContent = "연결된 저장 폴더가 없어요.";
                options.open = true;
            } else {
                confirmed.textContent = "실행 프로그램에서 확인된 저장 위치가 여기에 표시돼요.";
            }
        };
        setInitialPath(storedPath);
        state.showStatus(consoleRef?.storageConnected && consoleRef.storageIdentity
            ? { connected: true, storageRoot: consoleRef.storageIdentity.storageRoot } : null);
        if (state.draft) {
            options.open = true;
            pathInput.disabled = false;
            pathInput.value = state.draft.value;
            folderHint.textContent = state.draft.hint;
            pathClearBtn.style.display = pathInput.value ? "inline-block" : "none";
        }
        pathInput.addEventListener("input", keepDraft);

        // [📁 폴더 선택] 버튼 클릭
        let selectingFolder = false;
        folderSelectBtn.addEventListener("click", async function() {
            if (selectingFolder || createBtn.disabled) return;
            selectingFolder = true;
            const inputWasDisabled = pathInput.disabled;
            let selected = false;
            try {
                folderSelectBtn.disabled = true;
                directInputBtn.disabled = true;
                pathClearBtn.disabled = true;
                clearBtn.disabled = true;
                pathInput.disabled = true;
                createBtn.disabled = true;
                createBtn.textContent = "폴더 선택 중...";
                selected = await handleFolderSelect(overlay);
                if (selected && isOpen(overlay)) {
                    keepDraft();
                    folderSelectBtn.textContent = "📁 다시 선택";
                    pathClearBtn.style.display = "inline-block";
                }
            } catch (error) {
                if (isOpen(overlay)) await showFailure(error, "폴더 선택을 완료하지 못했어요. 입력한 경로는 그대로 남아 있어요.");
            } finally {
                selectingFolder = false;
                folderSelectBtn.disabled = false;
                directInputBtn.disabled = false;
                pathClearBtn.disabled = false;
                clearBtn.disabled = false;
                pathInput.disabled = selected ? false : inputWasDisabled;
                createBtn.disabled = false;
                createBtn.textContent = "생성 + 연결";
            }
        });

        // [✏️ 직접 입력] 버튼 클릭
        directInputBtn.addEventListener("click", function() {
            pathInput.disabled = false;
            pathInput.placeholder = "/Users/yourname/Documents/해마";
            pathInput.focus();
            folderHint.textContent = "실제 절대 경로를 직접 입력해주세요.";
            folderHint.style.color = "";
            folderHint.style.fontWeight = "normal";
            keepDraft();
        });

        // 지우기 버튼 클릭
        pathClearBtn.addEventListener("click", function() {
            pathInput.value = "";
            pathInput.disabled = false;
            folderSelectBtn.textContent = "📁 폴더 선택";
            pathClearBtn.style.display = "none";
            folderHint.textContent = "해마 장기기억 저장소가 생성될 상위 폴더 경로를 입력하거나 폴더를 선택하세요.";
            keepDraft();
        });

        // 캐시 지우기 버튼 클릭
        clearBtn.addEventListener("click", function() {
            clearStoredPath();
            pathInput.value = "";
            pathInput.disabled = false;
            folderSelectBtn.textContent = "📁 폴더 선택";
            pathClearBtn.style.display = "none";
            clearBtn.style.display = "none";
            folderHint.textContent = "캐시가 지워졌습니다. 새로운 저장소를 설정하세요.";
            keepDraft();
        });

        createBtn.addEventListener("click", async function() {
            const storagePath = pathInput ? pathInput.value.trim() : "";

            if (!storagePath) {
                await HAEMA_DIALOG.alert("저장소 경로를 입력해주세요.", { tone: 'warning' });
                return;
            }

            // 버튼 비활성화
            createBtn.disabled = true;
            createBtn.textContent = "처리 중...";

            try {
                // 직접입력 방식 사용
                const result = await handleDirectInput(storagePath);
                if (result.stale || !isOpen(overlay)) return;

                if (result.exists) {
                    // 기존 저장소 존재 - 중첩 모달 표시
                    showExistingStorageModal(result.path, overlay, createBtn);
                } else {
                    // 새 저장소 생성 성공
                    closeModal(overlay);
                }

            } catch (error) {
                if (!isOpen(overlay)) return;

                await showFailure(error, "저장소 연결을 완료하지 못했어요. 입력한 경로는 그대로 남아 있어요.");
            } finally {
                // 버튼 활성화
                createBtn.disabled = false;
                createBtn.textContent = "생성 + 연결";
            }
        });
        focusInside(overlay);
    }

    function closeModal(overlay) {
        if (isOpen(overlay)) {
            modalFocus.get(overlay)?.unsubscribe?.();
            const child = document.getElementById("existingStorageModalOverlay");
            if (modalFocus.get(child)?.parent === overlay) closeExistingModal(child, false);
            overlay.classList.remove("active");
            setTimeout(() => overlay.remove(), 180);
            restoreFocus(modalFocus.get(overlay)?.returnFocus);
        }
    }

    function closeExistingModal(overlay, restore = true) {
        if (!isOpen(overlay)) return;
        const state = modalFocus.get(overlay);
        overlay.classList.remove("active");
        overlay.remove();
        if (restore) restoreFocus(state?.returnFocus, state?.parent);
    }

    // 기존 저장소 중첩 모달 표시
    function showExistingStorageModal(existingPath, parent, trigger) {
        const app = document.getElementById("app");
        if (!app || !isOpen(parent)) return;
        const existing = document.getElementById("existingStorageModalOverlay");
        if (isOpen(existing)) { focusInside(existing); return; }
        const returnFocus = focusReference(trigger || document.activeElement);

        const modalHtml = [
            '<div class="modal-overlay active" id="existingStorageModalOverlay">',
            '  <div class="modal" id="existingStorageModal" role="dialog" aria-modal="true" aria-labelledby="existingStorageModalTitle">',
            '    <div class="modal-header">',
            '      <div class="modal-title" id="existingStorageModalTitle">⚠️ 기존 저장소 발견</div>',
            '      <button class="modal-close" id="existingStorageModalClose" type="button" aria-label="기존 저장소 확인 닫기">&times;</button>',
            '    </div>',
            '    <div class="modal-body">',
            '      <div class="haema-modal-character"><img src="Resources/haema-emoji/haema-default.svg" width="104" height="104" alt="" aria-hidden="true"></div>',
            '      <p>이미 해당 위치에 기억 저장소가 있습니다.</p>',
            '      <p>기존 저장소를 연결하시겠습니까, 아니면 새로 만드시겠습니까?</p>',
            '      <div class="form-group">',
            '        <button class="btn" id="existingStorageConnectBtn" type="button">',
            '          기존 저장소 연결',
            '        </button>',
            '        <button class="btn" id="existingStorageCreateBtn" type="button">',
            '          새로 만들기',
            '        </button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '</div>',
        ].join("\n");

        app.insertAdjacentHTML("beforeend", modalHtml);

        const overlay = document.getElementById("existingStorageModalOverlay");
        const modal = document.getElementById("existingStorageModal");
        const closeBtn = document.getElementById("existingStorageModalClose");
        const connectBtn = document.getElementById("existingStorageConnectBtn");
        const createBtn = document.getElementById("existingStorageCreateBtn");
        modalFocus.set(overlay, { returnFocus, parent });
        bindModalKeyboard(overlay, () => closeExistingModal(overlay));

        closeBtn.addEventListener("click", function() {
            closeExistingModal(overlay);
        });

        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) {
                closeExistingModal(overlay);
            }
        });

        // 기존 저장소 연결
        connectBtn.addEventListener("click", async function() {
            try {
                const result = await handleDirectInput(existingPath, false, true);
                if (result.stale || !isOpen(overlay) || !isOpen(parent)) return;
                closeExistingModal(overlay, false);
                closeModal(parent);
            } catch (error) {
                if (isOpen(overlay)) await showFailure(error, "기존 저장소 연결을 완료하지 못했어요.");
            }
        });

        // 새로 만들기
        createBtn.addEventListener("click", async function() {
            try {
                const result = await handleDirectInput(existingPath, true);
                if (result.stale || !isOpen(overlay) || !isOpen(parent)) return;
                closeExistingModal(overlay, false);
                closeModal(parent);
            } catch (error) {
                if (isOpen(overlay)) await showFailure(error, "새 저장소 생성을 완료하지 못했어요.");
            }
        });
        focusInside(overlay);
    }

    // API 키 이관 함수
    async function migrateApiKeysToStorage() {
        if (typeof ConsoleConfigStore === "undefined" || typeof WebCryptoCipher === "undefined") {
            return;
        }

        try {
            const cipher = new WebCryptoCipher();
            const store = new ConsoleConfigStore(cipher);
            const config = await store.load();

            if (!config.sets || config.sets.length === 0) {
                return;
            }

            // 암호화된 데이터를 서버로 전송
            const encryptedRaw = localStorage.getItem(window.STORAGE_KEY || "haema.console.config.v1");

            if (encryptedRaw) {
                const response = await requestLocal("credentials.save", {
                    encrypted: JSON.parse(encryptedRaw)
                });

                if (response.ok) {
                    // Keep the existing browser profiles available after copying.
                } else {
                }
            }
        } catch (error) {
        }
    }

    return {
        setConsole: setConsole,
        open: openModal,
        getPath: getStoredPath,
        autoConnect: autoConnectStorage,
    };
})();
