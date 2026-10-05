// @editedBy SherrySherry 2026-09-24
// ============================================================
// haema-storage-modal.js
// 로컬 저장소(쩜통) 연결/생성 모달
// ============================================================

window.HAEMA_STORAGE_MODAL = (function () {
    let consoleRef = null;

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
            consoleRef.updateJJumList(connected ? status.jjums || [] : []);
        }
    }

    async function autoConnectStorage() {
        try {
            const response = await fetch("/api/storage/status");
            if (!response.ok) throw new Error("저장소 상태를 확인할 수 없습니다.");
            const status = await response.json();
            applyStorageStatus(status);
            return status;
        } catch {
            applyStorageStatus({ connected: false });
            return { connected: false };
        }
    }

    // 브라우저 폴더 선택은 전체 경로를 제공하지 않으므로 서버 연결 경로를 별도로 받는다.
    async function handleFolderSelect() {
        const pathInput = document.getElementById("storagePathInput");
        const hint = document.getElementById("storageFolderHint");
        if (typeof window.showDirectoryPicker === "function") {
            try {
                const selected = await window.showDirectoryPicker();
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

    async function handleDirectInput(storagePath, forceCreate = false, connectExisting = false) {
        const response = await fetch("/api/storage/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storageRoot: storagePath, forceCreate, connectExisting }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || "저장소 연결에 실패했습니다.");
        }
        if (result.exists && !result.connected && !forceCreate && !connectExisting) {
            return { exists: true, path: result.path, result };
        }
        applyStorageStatus({ ...result, connected: true });
        if (consoleRef && typeof consoleRef.refreshApiStatus === "function") {
            await consoleRef.refreshApiStatus();
        }
        return { exists: false, connected: true, path: result.path, result };
    }

    function openModal() {
        const app = document.getElementById("app");
        if (!app) return;

        const modalHtml = [
            '<div class="modal-overlay" id="storageModalOverlay">',
            '  <div class="modal" id="storageModal">',
            '    <div class="modal-header">',
            '      <div class="modal-title">🪣 저장 폴더 연결</div>',
            '      <button class="modal-close" id="storageModalClose">&times;</button>',
            '    </div>',

            '    <div class="modal-body">',

            '      <div class="form-group">',
            '        <label class="form-label">저장소 경로</label>',
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
                await handleFolderSelect();
            } catch (error) {
                alert("폴더 선택에 실패했습니다: " + error.message);
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

        closeBtn.addEventListener("click", closeModal);

        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) {
                closeModal();
            }
        });

        createBtn.addEventListener("click", async function() {
            const pathInput = document.getElementById("storagePathInput");
            const storagePath = pathInput ? pathInput.value.trim() : "";

            if (!storagePath) {
                alert("저장소 경로를 입력해주세요.");
                return;
            }

            // 버튼 비활성화
            createBtn.disabled = true;
            createBtn.textContent = "처리 중...";

            try {
                // 직접입력 방식 사용
                const result = await handleDirectInput(storagePath);

                if (result.exists) {
                    // 기존 저장소 존재 - 중첩 모달 표시
                    showExistingStorageModal(result.path);
                } else {
                    // 새 저장소 생성 성공
                    closeModal();
                }

            } catch (error) {
                console.error(
                    "HAEMA_STORAGE_MODAL: 저장소 초기화 실패",
                    error
                );

                alert(
                    "저장소 초기화에 실패했습니다.\n\n" +
                    error.message
                );
            } finally {
                // 버튼 활성화
                createBtn.disabled = false;
                createBtn.textContent = "생성 + 연결";
            }
        });
    }

    function closeModal() {
        const overlay = document.getElementById("storageModalOverlay");

        if (overlay) {
            overlay.classList.remove("active");
            setTimeout(() => overlay.remove(), 180);
        }
    }

    // 기존 저장소 중첩 모달 표시
    function showExistingStorageModal(existingPath) {
        const app = document.getElementById("app");
        if (!app) return;

        const modalHtml = [
            '<div class="modal-overlay" id="existingStorageModalOverlay">',
            '  <div class="modal" id="existingStorageModal">',
            '    <div class="modal-header">',
            '      <div class="modal-title">⚠️ 기존 저장소 발견</div>',
            '      <button class="modal-close" id="existingStorageModalClose">&times;</button>',
            '    </div>',
            '    <div class="modal-body">',
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

        closeBtn.addEventListener("click", function() {
            overlay.remove();
        });

        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        // 기존 저장소 연결
        connectBtn.addEventListener("click", async function() {
            try {
                const result = await handleDirectInput(existingPath, false, true);
                // 기존 저장소 연결 시에도 쩜 목록 로드
                if (consoleRef && typeof consoleRef.loadLocalServerData === "function") {
                    await consoleRef.loadLocalServerData();
                }
                overlay.remove();
                closeModal();
            } catch (error) {
                alert("기존 저장소 연결에 실패했습니다: " + error.message);
            }
        });

        // 새로 만들기
        createBtn.addEventListener("click", async function() {
            try {
                const result = await handleDirectInput(existingPath, true);
                overlay.remove();
                closeModal();
            } catch (error) {
                alert("새 저장소 생성에 실패했습니다: " + error.message);
            }
        });
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
