import { connection } from './haema-local-connection.mjs';
void connection.start();
const scripts = ["web-console/haema-dialog.js?v=1", "web-console/configStore.js?v=12", "web-console/haema-api-key-modal.js?v=13", "web-console/haema-conversation-session.js?v=4", "web-console/haema-incremental-client.js?v=1", "web-console/haema-incremental-controller.js?v=1", "web-console/haema-token-usage.js?v=6", "web-console/haema-token-meter.js?v=5", "web-console/haema-introduction.js?v=4", "web-console/haema-introduction-modal.js?v=8", "web-console/haema-test-host.js?v=3", "web-console/haema-seon.js?v=2", "web-console/haema-console.js?v=20261116", "web-console/haema-storage-db.js?v=11", "web-console/haema-storage-modal.js?v=14"];
for (const source of scripts) {
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source; script.onload = resolve;
        script.onerror = () => reject(new Error('Console asset could not be loaded'));
        document.body.append(script);
    });
}
await globalThis.HAEMA_CONSOLE.mount();
