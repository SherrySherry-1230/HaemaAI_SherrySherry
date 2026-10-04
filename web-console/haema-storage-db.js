// ============================================================
// haema-storage-db.js
// IndexedDB 기반 FileSystemDirectoryHandle 영속화 + 저장소 접근
// ============================================================

window.HAEMA_STORAGE_DB = (function () {
    const DB_NAME = 'haema-storage-db';
    const DB_VERSION = 1;
    const STORE_NAME = 'handles';

    const KEY_ROOT = 'rootHandle';
    const KEY_JJUM = 'jjumHandle';
    const KEY_ENDUSER = 'endUserHandle';
    const KEY_HIDDEN_SYSTEM = 'hiddenSystemHandle';
    const KEY_ALGORITHM = 'algorithmHandle';

    const STORAGE_PATH_KEY = 'haema_storage_path';

    // ============================================================
    // 폴더명
    // ============================================================

    const FOLDER_NAMES = {
        longTerm: "🧠장기기억저장소_feat.해마🧠",
        jjum: "🪣쩜통🪣",
        endUser: "☺️♥️🤖엔드유저와의 관계를 위하여🤖♥️☺️",
        hiddenSystem: ".🫀해마_심층_중추신경계🫀",
        algorithm: ".📜해마.ai 핵심 13 알고리즘 계율📜",
    };

    // ============================================================
    // IndexedDB
    // ============================================================

    function openDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('IndexedDB를 사용할 수 없습니다.'));
                return;
            }

            const request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    async function putHandle(key, handle) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            store.put(handle, key);

            transaction.oncomplete = () => {
                resolve(true);
            };

            transaction.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    async function getHandle(key) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = (event) => {
                resolve(event.target.result || null);
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    // ============================================================
    // 저장소 상태
    // ============================================================

    async function isStorageConnected() {
        try {
            const rootHandle = await getHandle(KEY_ROOT);
            const jjumHandle = await getHandle(KEY_JJUM);
            const endUserHandle = await getHandle(KEY_ENDUSER);
            const hiddenSystemHandle = await getHandle(KEY_HIDDEN_SYSTEM);
            const algorithmHandle = await getHandle(KEY_ALGORITHM);

            return !!(
                rootHandle &&
                jjumHandle &&
                endUserHandle &&
                hiddenSystemHandle &&
                algorithmHandle
            );
        } catch (error) {
            console.error('[HaemaStorage] 저장소 연결 확인 실패:', error);
            return false;
        }
    }

    async function getStorageStatus() {
        try {
            const rootHandle = await getHandle(KEY_ROOT);
            const jjumHandle = await getHandle(KEY_JJUM);
            const endUserHandle = await getHandle(KEY_ENDUSER);
            const hiddenSystemHandle = await getHandle(KEY_HIDDEN_SYSTEM);
            const algorithmHandle = await getHandle(KEY_ALGORITHM);

            if (!rootHandle || !jjumHandle || !endUserHandle || !hiddenSystemHandle || !algorithmHandle) {
                return {
                    connected: false,
                    reason: '필수 폴더의 Handle이 모두 저장되어 있지 않습니다.'
                };
            }

            return {
                connected: true,
                reason: ''
            };
        } catch (error) {
            console.error('[HaemaStorage] 저장소 상태 확인 실패:', error);

            return {
                connected: false,
                reason: error.message
            };
        }
    }

    // ============================================================
    // Handle 저장 / 복구
    // ============================================================

    async function saveHandles(
        rootHandle,
        jjumHandle,
        endUserHandle,
        hiddenSystemHandle = null,
        algorithmHandle = null
    ) {
        await putHandle(KEY_ROOT, rootHandle);
        await putHandle(KEY_JJUM, jjumHandle);
        await putHandle(KEY_ENDUSER, endUserHandle);
        if (hiddenSystemHandle) {
            await putHandle(KEY_HIDDEN_SYSTEM, hiddenSystemHandle);
        }
        if (algorithmHandle) {
            await putHandle(KEY_ALGORITHM, algorithmHandle);
        }

        localStorage.setItem(
            STORAGE_PATH_KEY,
            'connected'
        );

        return true;
    }

    async function restoreHandles() {
        try {
            const rootHandle = await getHandle(KEY_ROOT);
            const jjumHandle = await getHandle(KEY_JJUM);
            const endUserHandle = await getHandle(KEY_ENDUSER);
            const hiddenSystemHandle = await getHandle(KEY_HIDDEN_SYSTEM);
            const algorithmHandle = await getHandle(KEY_ALGORITHM);

            if (
                !rootHandle ||
                !jjumHandle ||
                !endUserHandle ||
                !hiddenSystemHandle ||
                !algorithmHandle
            ) {
                return null;
            }

            return {
                rootHandle,
                jjumHandle,
                endUserHandle,
                hiddenSystemHandle,
                algorithmHandle
            };
        } catch (error) {
            console.error(
                '[HaemaStorage] Handle 복구 실패:',
                error
            );

            return null;
        }
    }

    // ============================================================
    // 공통 폴더 파일 접근
    // ============================================================

    async function listFolderFiles(folderHandle) {
        if (!folderHandle) {
            return null;
        }

        try {
            const entries = [];

            for await (const entry of folderHandle.values()) {
                entries.push({
                    name: entry.name,
                    kind: entry.kind
                });
            }

            return entries;
        } catch (error) {
            console.error(
                '[HaemaStorage] 폴더 목록 조회 실패:',
                error
            );

            return null;
        }
    }

    async function readFolderFile(folderHandle, filename) {
        if (!folderHandle) {
            return null;
        }

        try {
            const fileHandle =
                await folderHandle.getFileHandle(filename);

            const file = await fileHandle.getFile();
            const text = await file.text();

            return JSON.parse(text);
        } catch (error) {
            console.error(
                '[HaemaStorage] 파일 읽기 실패:',
                filename,
                error
            );

            return null;
        }
    }

    async function writeFolderFile(
        folderHandle,
        filename,
        data
    ) {
        if (!folderHandle) {
            return false;
        }

        try {
            const fileHandle =
                await folderHandle.getFileHandle(
                    filename,
                    { create: true }
                );

            const writable =
                await fileHandle.createWritable();

            await writable.write(
                JSON.stringify(data, null, 2)
            );

            await writable.close();

            return true;
        } catch (error) {
            console.error(
                '[HaemaStorage] 파일 쓰기 실패:',
                filename,
                error
            );

            return false;
        }
    }

    async function createFolderFile(
        folderHandle,
        filename,
        data
    ) {
        if (!folderHandle) {
            return false;
        }

        try {
            try {
                await folderHandle.getFileHandle(filename);

                // 이미 존재하면 생성하지 않음
                return false;
            } catch (error) {
                // 파일이 없으면 생성 진행
            }

            return await writeFolderFile(
                folderHandle,
                filename,
                data
            );
        } catch (error) {
            console.error(
                '[HaemaStorage] 파일 생성 실패:',
                filename,
                error
            );

            return false;
        }
    }

    // ============================================================
    // 쩜통 접근
    // ============================================================

    async function listJJumFiles() {
        const handles = await restoreHandles();

        if (!handles) {
            return null;
        }

        return listFolderFiles(handles.jjumHandle);
    }

    async function readJJumFile(filename) {
        const handles = await restoreHandles();

        if (!handles) {
            return null;
        }

        return readFolderFile(
            handles.jjumHandle,
            filename
        );
    }

    async function writeJJumFile(filename, data) {
        const handles = await restoreHandles();

        if (!handles) {
            return false;
        }

        return writeFolderFile(
            handles.jjumHandle,
            filename,
            data
        );
    }

    async function createJJumFile(filename, data) {
        const handles = await restoreHandles();

        if (!handles) {
            return false;
        }

        return createFolderFile(
            handles.jjumHandle,
            filename,
            data
        );
    }

    // ============================================================
    // 장기기억저장소 접근
    // ============================================================

    async function listLongTermFiles() {
        const handles = await restoreHandles();

        if (!handles) {
            return null;
        }

        return listFolderFiles(handles.rootHandle);
    }

    async function readLongTermFile(filename) {
        const handles = await restoreHandles();

        if (!handles) {
            return null;
        }

        return readFolderFile(
            handles.rootHandle,
            filename
        );
    }

    async function writeLongTermFile(filename, data) {
        const handles = await restoreHandles();

        if (!handles) {
            return false;
        }

        return writeFolderFile(
            handles.rootHandle,
            filename,
            data
        );
    }

    async function createLongTermFile(filename, data) {
        const handles = await restoreHandles();

        if (!handles) {
            return false;
        }

        return createFolderFile(
            handles.rootHandle,
            filename,
            data
        );
    }

    // ============================================================
    // 엔드유저 폴더 접근
    // ============================================================

    async function listEndUserFiles() {
        const handles = await restoreHandles();

        if (!handles) {
            return null;
        }

        return listFolderFiles(handles.endUserHandle);
    }

    async function readEndUserFile(filename) {
        const handles = await restoreHandles();

        if (!handles) {
            return null;
        }

        return readFolderFile(
            handles.endUserHandle,
            filename
        );
    }

    async function writeEndUserFile(filename, data) {
        const handles = await restoreHandles();

        if (!handles) {
            return false;
        }

        return writeFolderFile(
            handles.endUserHandle,
            filename,
            data
        );
    }

    async function createEndUserFile(filename, data) {
        const handles = await restoreHandles();

        if (!handles) {
            return false;
        }

        return createFolderFile(
            handles.endUserHandle,
            filename,
            data
        );
    }

    // ============================================================
    // 외부 공개
    // ============================================================

    return {
        // 저장소 상태
        isStorageConnected,
        getStorageStatus,

        // Handle 저장 / 복구
        saveHandles,
        restoreHandles,

        // 공통 폴더 접근
        listFolderFiles,
        readFolderFile,
        writeFolderFile,
        createFolderFile,

        // 쩜통
        listJJumFiles,
        readJJumFile,
        writeJJumFile,
        createJJumFile,

        // 장기기억
        listLongTermFiles,
        readLongTermFile,
        writeLongTermFile,
        createLongTermFile,

        // 엔드유저
        listEndUserFiles,
        readEndUserFile,
        writeEndUserFile,
        createEndUserFile,

        // 폴더명
        FOLDER_NAMES,

        // 기존 호환용
        STORAGE_PATH_KEY
    };
})();