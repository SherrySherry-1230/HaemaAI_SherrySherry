// @editedBy YAONG1230 2026-11-22: refresh host guidance and chat drafts
// @editedBy SherrySherry 2026-11-19
import { connection } from './haema-local-connection.mjs?v=20261119-r6-readiness';
import { detectDownloadPlatform, loadDownloads, windowsLauncherHandles } from './storage-downloads.mjs?v=20261120-public-installer';
globalThis.HAEMA_STORAGE_DOWNLOADS = Object.freeze({ detectPlatform: detectDownloadPlatform, load: loadDownloads, windowsLauncherHandles });
const connectionStarted = connection.start();
const setupMessage = detectDownloadPlatform() === 'windows'
    ? '쩜통 버튼에서 Windows 설치 ZIP을 내려받아 압축을 모두 푼 뒤 RegisterWebControls.cmd로 쩜통 폴더를 한 번 등록해 주세요. 등록 후 Start로 준비 모드를 열어 API 키와 모델을 설정하고, AI Start로 대화 모드를 열 수 있어요.'
    : '쩜통 버튼에서 이 컴퓨터에 맞는 설치본을 내려받아 안내에 따라 시작 파일을 열어 주세요.';
const resettable = new Set(['REMEMBERED_CONNECTION_REJECTED', 'REMEMBERED_CONNECTION_IDENTITY_MISMATCH',
    'REMEMBERED_CONNECTION_GRANT_EXPIRED', 'REMEMBERED_CONNECTION_KEY_INVALID', 'REMEMBERED_CONNECTION_INVALID']);
async function showConnectionNotice(state) {
    const code = state.firstFailure?.code || state.rememberNoticeCode;
    if (resettable.has(code)) {
        let resetting;
        const confirmed = await globalThis.HAEMA_DIALOG.confirm(
            '이 브라우저에 기억한 연결을 다시 확인할 수 없어요. 연결 기억만 지우고 처음부터 설정할까요? 쩜통·대화·초안·API 설정은 그대로 유지돼요.',
            { title: '연결 기억을 다시 설정할까요?', confirmText: '연결 기억 재설정', cancelText: '유지',
                onConfirm() { resetting = connection.disconnect(); } }
        );
        if (!confirmed) return;
        await resetting;
        await globalThis.HAEMA_DIALOG.alert(setupMessage, { title: '처음 한 번 연결해 주세요' });
        return;
    }
    await globalThis.HAEMA_DIALOG.alert(connection.describeFailure() || setupMessage,
        { title: '이 컴퓨터와 연결하기', tone: 'warning' });
}
globalThis.HAEMA_RECONNECT_LOCAL = () => {
    // Begin the connection in the confirming click, before awaiting another task.
    const pending = connection.status().connection === 'connected' ? connection.recheck() : connection.connect();
    void pending.then(async state => {
        if (state.connection === 'connected') return;
        await showConnectionNotice(state);
    });
    return pending;
};
const scripts = ["web-console/haema-dialog.js?v=2", "web-console/configStore.js?v=12", "web-console/haema-api-key-modal.js?v=20261120-api-runtime-mode", "web-console/haema-conversation-session.js?v=4", "web-console/haema-incremental-client.js?v=1", "web-console/haema-incremental-controller.js?v=1", "web-console/haema-token-usage.js?v=6", "web-console/haema-token-meter.js?v=5", "web-console/haema-introduction.js?v=20261119-intro-memory", "web-console/haema-introduction-modal.js?v=20261119-intro-memory", "web-console/haema-test-host.js?v=20261122-service-notice", "web-console/haema-seon.js?v=2", "web-console/haema-console.js?v=20261122-host-draft", "web-console/haema-storage-db.js?v=11", "web-console/haema-storage-modal.js?v=20261119-r6-readiness"];
for (const source of scripts) {
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source; script.onload = resolve;
        script.onerror = () => reject(new Error('Console asset could not be loaded'));
        document.body.append(script);
    });
}
await globalThis.HAEMA_CONSOLE.mount();
let connectionState = await connectionStarted;
if (connectionState.connection === 'awaiting-permission') {
    let connecting;
    const confirmed = await globalThis.HAEMA_DIALOG.confirm(
        '이 컴퓨터에서 실행 중인 해마.ai와 연결해요. 브라우저가 로컬 네트워크 접근을 물으면 허용해 주세요. 처음 연결을 기억하면 다음부터 이 웹주소로 바로 열 수 있어요. 기억은 이 컴퓨터에서 선택한 폴더에 저장돼요.',
        { title: '내 컴퓨터와 연결할까요?', confirmText: '연결', cancelText: '나중에',
            onConfirm() { connecting = connection.connect(); } }
    );
    if (confirmed && connecting) connectionState = await connecting;
}
if (connectionState.connection === 'setup-required' && !connectionState.firstFailure) {
    if (connectionState.rememberNoticeCode) await showConnectionNotice(connectionState);
} else if (connectionState.firstFailure || connectionState.connection === 'permission-denied') {
    await showConnectionNotice(connectionState);
}
