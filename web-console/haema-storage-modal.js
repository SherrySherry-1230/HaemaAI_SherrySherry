// @editedBy SherrySherry 2026-09-24
// @editedBy YAONG1230 2026-10-18
// @editedBy YAONG1230 2026-10-28: 저장소 모달 키보드와 초점 복원
// ============================================================
// haema-storage-modal.js
// 로컬 저장소(쩜통) 연결/생성 모달
// ============================================================

window.HAEMA_STORAGE_MODAL = (function () {
    let consoleRef = null;
    let storageRequestGeneration = 0;
    let pendingInit = null;
    const modalFocus = new WeakMap();

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

    // 폴더명 상수
    // 추후 영문명 전환 시 이 부분만 변경
    const FOLDER_NAMES = {
        longTerm: "🧠장기기억저장소_feat.해마🧠",
        jjum: "🪣쩜통🪣",
        endUser: "☺️♥️🤖엔드유저와의 관계를 위하여🤖♥️☺️",
        hiddenSystem: ".🫀해마_심층_중추신경계🫀",
        algorithm: ".📜해마.ai 핵심 13 알고리즘 계율📜",
    };

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
            const response = await fetch("/api/storage/status", { cache: "no-store" });
            if (!response.ok) throw new Error("저장소 상태를 확인할 수 없습니다.");
            const status = await response.json();
            if (generation !== storageRequestGeneration) return { stale: true };
            applyStorageStatus(status);
            return status;
        } catch {
            if (generation !== storageRequestGeneration) return { stale: true };
            applyStorageStatus({ connected: false });
            return { connected: false };
        }
    }

    // 브라우저 폴더 선택은 전체 경로를 제공하지 않으므로 서버 연결 경로를 별도로 받는다.
    async function handleFolderSelect(overlay) {
        const pathInput = overlay.querySelector("#storagePathInput");
        const hint = overlay.querySelector("#storageFolderHint");
        if (typeof window.showDirectoryPicker === "function") {
            try {
                const selected = await window.showDirectoryPicker();
                if (!isOpen(overlay)) return;
                hint.textContent = '선택한 "' + selected.name + '" 폴더의 전체 경로를 입력한 뒤 [생성 + 연결]을 눌러주세요.';
            } catch (error) {
                if (error.name === "AbortError") return;
                throw error;
            }
        } else {
            hint.textContent = "이 브라우저에서는 폴더의 전체 경로를 직접 입력해주세요.";
        }
        pathInput.disabled = false;
        pathInput.focus();
    }

    function handleDirectInput(storagePath, forceCreate = false, connectExisting = false) {
        const generation = ++storageRequestGeneration;
        const operation = (async function() {
            try {
                const response = await fetch("/api/storage/init", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ storageRoot: storagePath, forceCreate, connectExisting }),
                });
                const result = await response.json();
                if (generation !== storageRequestGeneration) return { stale: true };
                if (!response.ok || !result.success) {
                    throw new Error(result.error || "저장소 연결에 실패했습니다.");
                }
                if (result.exists && result.connected !== true && !forceCreate && !connectExisting) {
                    return { exists: true, path: result.path, result };
                }
                if (result.connected !== true) {
                    throw new Error(result.error || "저장소 연결 완료를 확인할 수 없습니다.");
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
            '        <label class="form-label">생성할 폴더 구조</label>',
            '        <div class="folder-list">',
            '          <div class="folder-item">',
            '            <span>' + FOLDER_NAMES.longTerm + '</span>',
            '          </div>',
            '          <div class="folder-item">',
            '            <span>├── ' + FOLDER_NAMES.jjum + '</span>',
            '          </div>',
            '          <div class="folder-item">',
            '            <span>├── ' + FOLDER_NAMES.endUser + '</span>',
            '          </div>',
            '          <div class="folder-item">',
            '            <span>└── ' + FOLDER_NAMES.hiddenSystem + ' [숨김]</span>',
            '          </div>',
            '          <div class="folder-item">',
            '            <span>│   └── ' + FOLDER_NAMES.algorithm + ' [숨김]</span>',
            '          </div>',
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

        folderHint.textContent = "※ 내부 제어 폴더인 " + FOLDER_NAMES.hiddenSystem + " 아래의 " + FOLDER_NAMES.algorithm + "도 숨김 폴더로 생성됩니다.";

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
            console.error("HAEMA_STORAGE_MODAL: 모달 요소 생성 실패");
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
        folderSelectBtn.addEventListener("click", async function() {
            try {
                createBtn.disabled = true;
                createBtn.textContent = "처리 중...";
                await handleFolderSelect(overlay);
            } catch (error) {
                if (isOpen(overlay)) await HAEMA_DIALOG.alert("폴더 선택에 실패했습니다: " + error.message, { tone: 'error' });
            } finally {
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
                console.error(
                    "HAEMA_STORAGE_MODAL: 저장소 초기화 실패",
                    error
                );

                await HAEMA_DIALOG.alert(
                    "저장소 초기화에 실패했습니다.\n\n" +
                    error.message,
                    { tone: 'error' }
                );
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
            '      <p>이미 해당 위치에 [' + FOLDER_NAMES.longTerm + '] 폴더가 존재합니다.</p>',
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
                if (isOpen(overlay)) await HAEMA_DIALOG.alert("기존 저장소 연결에 실패했습니다: " + error.message, { tone: 'error' });
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
                if (isOpen(overlay)) await HAEMA_DIALOG.alert("새 저장소 생성에 실패했습니다: " + error.message, { tone: 'error' });
            }
        });
        focusInside(overlay);
    }

    // API 키 이관 함수
    async function migrateApiKeysToStorage() {
        if (typeof ConsoleConfigStore === "undefined" || typeof WebCryptoCipher === "undefined") {
            console.warn("HAEMA_STORAGE_MODAL: 암호화 저장소를 사용할 수 없어 API 키 이관 스킵");
            return;
        }

        try {
            const cipher = new WebCryptoCipher();
            const store = new ConsoleConfigStore(cipher);
            const config = await store.load();

            if (!config.sets || config.sets.length === 0) {
                console.log("HAEMA_STORAGE_MODAL: 이관할 API 키가 없습니다");
                return;
            }

            // 암호화된 데이터를 서버로 전송
            const encryptedRaw = localStorage.getItem(window.STORAGE_KEY || "haema.console.config.v1");

            if (encryptedRaw) {
                const response = await fetch("/api/api-keys", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ encrypted: JSON.parse(encryptedRaw) }),
                });

                if (response.ok) {
                    console.log("HAEMA_STORAGE_MODAL: API 키 이관 성공");
                    // 브라우저 임시 저장소 정리
                    store.clear();
                } else {
                    console.error("HAEMA_STORAGE_MODAL: API 키 이관 실패");
                }
            }
        } catch (error) {
            console.error("HAEMA_STORAGE_MODAL: API 키 이관 중 오류", error);
        }
    }

    return {
        setConsole: setConsole,
        open: openModal,
        getPath: getStoredPath,
        autoConnect: autoConnectStorage,
    };
})();
