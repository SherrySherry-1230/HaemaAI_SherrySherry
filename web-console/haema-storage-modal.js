// @editedBy SherrySherry 2026-11-18
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
        if (missingConnections.has(error)) return "내 컴퓨터의 실행 프로그램에서 웹 콘솔을 다시 열어 연결해 주세요. 입력한 경로는 그대로 남아 있어요.";
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
        const reconnect = connectionFailure(error) && globalThis.HAEMA_RECONNECT_LOCAL;
        return HAEMA_DIALOG.alert(safeFailure(error, fallback), { tone: 'error',
            ...(typeof reconnect === 'function' ? { confirmText: '다시 연결', onConfirm: reconnect } : {}) });
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
        const preferred = overlay.querySelector("#storagePathInput:not(:disabled), #storageDirectInputBtn, #existingStorageConnectBtn");
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
            const controls = [...overlay.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
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
            return { connected: false, state: "unavailable" };
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

    function openModal() {
        const app = document.getElementById("app");
        if (!app) return;
        const existing = document.getElementById("storageModalOverlay");
        if (isOpen(existing)) {
            focusInside(document.getElementById("existingStorageModalOverlay") || existing);
            return;
        }
        // 닫힘 전환 중 재열어도 같은 ID의 폼이 두 개 남지 않는다.
        if (existing) existing.remove();
        const returnFocus = focusReference(document.activeElement);

        const modalHtml = [
            '<div class="modal-overlay" id="storageModalOverlay">',
            '  <div class="modal" id="storageModal" role="dialog" aria-modal="true" aria-labelledby="storageModalTitle">',
            '    <div class="modal-header">',
            '      <div class="modal-title" id="storageModalTitle">🪣 저장 폴더 연결</div>',
            '      <button class="modal-close" id="storageModalClose" type="button" aria-label="저장 폴더 연결 닫기">&times;</button>',
            '    </div>',

            '    <div class="modal-body">',

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
            '        <label class="form-label">기억 저장 위치</label>',
            '        <p class="form-hint">선택한 컴퓨터의 폴더에 쩜과 대화 기록을 보관합니다.</p>',
            '      </div>',

            '      <div class="form-group">',
            '        <button class="btn btn-create" id="storageCreateBtn" type="button">',
            '          생성 + 연결',
            '        </button>',
            '        <button class="btn btn-clear" id="storageClearBtn" type="button" style="display: none;">',
            '          캐시 지우기',
            '        </button>',
            '      </div>',

            '    </div>',
            '  </div>',
            '</div>',
        ].join("\n");

        app.insertAdjacentHTML("beforeend", modalHtml);

        const overlay = document.getElementById("storageModalOverlay");
        const modal = document.getElementById("storageModal");
        const closeBtn = document.getElementById("storageModalClose");
        const createBtn = document.getElementById("storageCreateBtn");
        const folderSelectBtn = document.getElementById("storageFolderSelectBtn");
        const directInputBtn = document.getElementById("storageDirectInputBtn");
        const pathInput = document.getElementById("storagePathInput");
        const pathClearBtn = document.getElementById("storagePathClearBtn");
        const clearBtn = document.getElementById("storageClearBtn");
        const folderHint = document.getElementById("storageFolderHint");


        if (
            !overlay ||
            !modal ||
            !closeBtn ||
            !createBtn ||
            !folderSelectBtn ||
            !directInputBtn ||
            !pathInput ||
            !pathClearBtn ||
            !clearBtn ||
            !folderHint
        ) {
            return;
        }

        overlay.classList.add("active");
        modalFocus.set(overlay, { returnFocus });

        // 이미 저장된 경로가 있으면 불러오기
        const storedPath = getStoredPath();
        if (storedPath) {
            pathInput.value = storedPath;
            pathInput.disabled = true;
            folderSelectBtn.textContent = "📁 다시 선택";
            pathClearBtn.style.display = "inline-block";
            clearBtn.style.display = "inline-block";
        }

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
        });

        // 지우기 버튼 클릭
        pathClearBtn.addEventListener("click", function() {
            pathInput.value = "";
            pathInput.disabled = false;
            folderSelectBtn.textContent = "📁 폴더 선택";
            pathClearBtn.style.display = "none";
            folderHint.textContent = "해마 장기기억 저장소가 생성될 상위 폴더 경로를 입력하거나 폴더를 선택하세요.";
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
        });

        closeBtn.addEventListener("click", () => closeModal(overlay));
        bindModalKeyboard(overlay, () => closeModal(overlay));

        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) {
                closeModal(overlay);
            }
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
