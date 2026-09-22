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
        hiddenSystem: "🫀해마_심층_중추신경계🫀",
        algorithm: "📜해마.ai 핵심 13 알고리즘 계율📜",
    };

    // 실제 저장소 연결 상태 표시용
    const STORAGE_PATH_KEY = "haema_storage_path";

    function setConsole(consoleObj) {
        consoleRef = consoleObj;
    }

    function getStoredPath() {
        return localStorage.getItem(STORAGE_PATH_KEY) || "";
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
            '        <label class="form-label">저장소 생성 위치</label>',
            '        <button class="btn" id="storageFolderSelectBtn" type="button">',
            '          📁 폴더 선택',
            '        </button>',
            '        <div class="form-hint" id="storageFolderHint">',
            '          선택한 폴더 안에 해마 장기기억 저장소를 생성합니다.',
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
        const folderHint = document.getElementById("storageFolderHint");

        folderHint.textContent = "※ 내부 제어 폴더인 " + FOLDER_NAMES.hiddenSystem + " [숨김] 아래의 " + FOLDER_NAMES.algorithm + " [숨김]은 일반 사용자 화면에서 보이지 않습니다.";

        if (
            !overlay ||
            !modal ||
            !closeBtn ||
            !createBtn ||
            !folderSelectBtn ||
            !folderHint
        ) {
            console.error("HAEMA_STORAGE_MODAL: 모달 요소 생성 실패");
            return;
        }

        overlay.classList.add("active");

        // 이미 연결된 저장소가 있으면 상태 표시
        HAEMA_STORAGE_DB.getStorageStatus().then(status => {
            if (status.connected) {
                folderHint.textContent = "✅ 저장소가 연결되어 있습니다. " + FOLDER_NAMES.longTerm + " 폴더가 준비됨.";
                folderSelectBtn.textContent = "📁 폴더 다시 선택";
            } else if (status.needsRepermission) {
                folderHint.textContent = "⚠️ 저장소 접근 권한이 필요합니다. 다시 선택해주세요.";
                folderSelectBtn.textContent = "📁 권한 재요청";
            } else {
                folderHint.textContent = "선택한 폴더 안에 해마 장기기억 저장소를 생성합니다.";
                folderSelectBtn.textContent = "📁 폴더 선택";
            }
        });

        closeBtn.addEventListener("click", closeModal);

        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) {
                closeModal();
            }
        });

        folderSelectBtn.addEventListener("click", handleCreate);

        createBtn.addEventListener("click", handleCreate);
    }

    function closeModal() {
        const overlay = document.getElementById("storageModalOverlay");

        if (overlay) {
            overlay.classList.remove("active");
            setTimeout(() => overlay.remove(), 180);
        }
    }

    async function writeTextFile(folderHandle, fileName, content) {
        const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        return fileHandle;
    }

    async function createStorageFiles(
        rootHandle,
        jjumHandle,
        endUserHandle,
        hiddenSystemHandle,
        algorithmHandle
    ) {
        await writeTextFile(
            rootHandle,
            "README.md",
            [
                "# HAEMA 장기기억 저장소",
                "",
                "이 폴더는 HAEMA AI의 로컬 장기기억 저장소입니다.",
                "",
                "- " + FOLDER_NAMES.jjum + ": JJum 데이터 저장 폴더",
                "- " + FOLDER_NAMES.endUser + ": 사용자 관계 데이터 저장 폴더",
                "- " + FOLDER_NAMES.hiddenSystem + " [숨김]: 내부 시스템 폴더",
                "- " + FOLDER_NAMES.algorithm + " [숨김]: 알고리즘 계율 및 시스템 파일",
                ""
            ].join("\n")
        );

        await writeTextFile(
            jjumHandle,
            "README.md",
            "# " + FOLDER_NAMES.jjum + "\n\n사용자가 직접 열람할 수 있는 JJum 저장 폴더입니다.\n"
        );

        await writeTextFile(
            endUserHandle,
            "README.md",
            "# " + FOLDER_NAMES.endUser + "\n\n사용자 관계 기반 메타데이터와 대화 맥락을 저장합니다.\n"
        );

        await writeTextFile(
            hiddenSystemHandle,
            "README.md",
            "# " + FOLDER_NAMES.hiddenSystem + " [숨김]\n\nHAEMA 내부 보조 시스템이 사용하는 비노출 영역입니다.\n"
        );

        await writeTextFile(
            algorithmHandle,
            "README.md",
            "# " + FOLDER_NAMES.algorithm + " [숨김]\n\n해마.ai의 핵심 알고리즘 계율 및 내부 규칙 파일을 보관합니다.\n"
        );

        await writeTextFile(
            algorithmHandle,
            "algorithm-manifest.json",
            JSON.stringify({
                name: FOLDER_NAMES.algorithm,
                kind: "hidden_system",
                createdAt: new Date().toISOString(),
                description: "HAEMA 내부 알고리즘 계율 폴더",
                files: [
                    "README.md",
                    "algorithm-manifest.json"
                ]
            }, null, 2)
        );
    }

    async function handleCreate() {
        // File System Access API 지원 여부 확인
        if (typeof window.showDirectoryPicker !== "function") {
            alert(
                "이 브라우저에서는 로컬 폴더 선택 기능을 지원하지 않습니다.\n\n" +
                "Chrome 또는 File System Access API를 지원하는 브라우저를 사용해주세요."
            );
            return;
        }

        try {
            // 사용자가 실제로 로컬 폴더를 선택
            const parentHandle = await window.showDirectoryPicker();

            // 선택한 폴더 안에 해마 장기기억 저장소 생성
            const rootHandle = await parentHandle.getDirectoryHandle(
                FOLDER_NAMES.longTerm,
                { create: true }
            );

            // 쩜통 생성
            const jjumHandle = await rootHandle.getDirectoryHandle(
                FOLDER_NAMES.jjum,
                { create: true }
            );

            // 엔드유저 관계 저장소 생성
            const endUserHandle = await rootHandle.getDirectoryHandle(
                FOLDER_NAMES.endUser,
                { create: true }
            );

            // 숨김 내부 시스템 영역 생성
            const hiddenSystemHandle = await rootHandle.getDirectoryHandle(
                FOLDER_NAMES.hiddenSystem,
                { create: true }
            );

            const algorithmHandle = await hiddenSystemHandle.getDirectoryHandle(
                FOLDER_NAMES.algorithm,
                { create: true }
            );

            await createStorageFiles(
                rootHandle,
                jjumHandle,
                endUserHandle,
                hiddenSystemHandle,
                algorithmHandle
            );

            // ----------------------------------------------------
            // 여기까지 실제 폴더 생성이 모두 성공한 경우에만
            // Handle을 IndexedDB에 저장하고 연결 상태 표시
            // ----------------------------------------------------
            await HAEMA_STORAGE_DB.saveHandles(
                rootHandle,
                jjumHandle,
                endUserHandle,
                hiddenSystemHandle,
                algorithmHandle
            );

            // Header 상태 갱신
            if (consoleRef && typeof consoleRef.render === "function") {
                consoleRef.render();
            }

            closeModal();

        } catch (error) {
            // 사용자가 폴더 선택창에서 취소한 경우
            // 오류로 취급하지 않음
            if (error && error.name === "AbortError") {
                return;
            }

            console.error(
                "HAEMA_STORAGE_MODAL: 저장소 생성 실패",
                error
            );

            alert(
                "저장소 생성에 실패했습니다.\n\n" +
                "선택한 폴더에 저장소를 생성할 수 있는지 확인해주세요."
            );
        }
    }

    return {
        setConsole: setConsole,
        open: openModal,
        getPath: getStoredPath,
    };
})();