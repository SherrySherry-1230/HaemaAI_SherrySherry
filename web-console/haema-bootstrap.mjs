// @editedBy SherrySherry 2026-11-17
import { connection } from './haema-local-connection.mjs?v=20261117-connection';
const connectionStarted = connection.start();
const scripts = ["web-console/haema-dialog.js?v=2", "web-console/configStore.js?v=12", "web-console/haema-api-key-modal.js?v=20261117-connection", "web-console/haema-conversation-session.js?v=4", "web-console/haema-incremental-client.js?v=1", "web-console/haema-incremental-controller.js?v=1", "web-console/haema-token-usage.js?v=6", "web-console/haema-token-meter.js?v=5", "web-console/haema-introduction.js?v=4", "web-console/haema-introduction-modal.js?v=9", "web-console/haema-test-host.js?v=3", "web-console/haema-seon.js?v=2", "web-console/haema-console.js?v=20261117-order", "web-console/haema-storage-db.js?v=11", "web-console/haema-storage-modal.js?v=20261117-connection"];
for (const source of scripts) {
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source; script.onload = resolve;
        script.onerror = () => reject(new Error('Console asset could not be loaded'));
        document.body.append(script);
    });
}
let connectionState = await connectionStarted;
if (connectionState.connection === 'awaiting-permission') {
    let connecting;
    const confirmed = await globalThis.HAEMA_DIALOG.confirm(
        '이 컴퓨터에서 실행 중인 해마.ai와 연결해요. 브라우저가 로컬 네트워크 접근을 물으면 허용해 주세요. 기억은 이 컴퓨터에서 선택한 폴더에 저장돼요.',
        { title: '내 컴퓨터와 연결할까요?', confirmText: '연결', cancelText: '나중에',
            onConfirm() { connecting = connection.connect(); } }
    );
    if (confirmed && connecting) connectionState = await connecting;
}
if (connectionState.firstFailure || connectionState.connection === 'permission-denied') {
    const message = connection.describeFailure();
    if (message) await globalThis.HAEMA_DIALOG.alert(message, { title: '컴퓨터 연결을 확인해 주세요', tone: 'error' });
}
await globalThis.HAEMA_CONSOLE.mount();
