// ============================================================
// haema-storage-modal.js
// 로컬 저장소(쩜통) 연결/생성 모달
// ============================================================

const HAEMA_STORAGE_MODAL = (function () {
    let consoleRef = null;

    // 폴더명 상수
    // 추후 영문명 전환 시 이 부분만 변경
    const FOLDER_NAMES = {
        longTerm: "🧠장기기억저장소_feat.해마🧠",
        jjum: "🪣쩜통🪣",
        endUser: "☺️♥️🤖엔드유저와의 관계를 위하여🤖♥️☺️",
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
            '            <span>└── ' + FOLDER_NAMES.jjum + '</span>',
            '          </div>',
            '          <div class="folder-item">',
            '            <span>└── ' + FOLDER_NAMES.endUser + '</span>',
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
            overlay.remove();
        }
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
            await rootHandle.getDirectoryHandle(
                FOLDER_NAMES.jjum,
                { create: true }
            );

            // 엔드유저 관계 저장소 생성
            await rootHandle.getDirectoryHandle(
                FOLDER_NAMES.endUser,
                { create: true }
            );

            // ----------------------------------------------------
            // 여기까지 실제 폴더 생성이 모두 성공한 경우에만
            // 연결 상태를 저장
            // ----------------------------------------------------

            localStorage.setItem(STORAGE_PATH_KEY, "connected");

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