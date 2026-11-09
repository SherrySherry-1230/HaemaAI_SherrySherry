// @editedBy SherrySherry
(() => {
    'use strict';

    const status = document.getElementById('connectionStatus');
    const connect = document.getElementById('connectLocal');
    const openWindow = document.getElementById('openLocalWindow');
    const windowNote = document.getElementById('connectionWindowNote');
    const workspace = document.querySelector('.workspace');
    const toolbar = document.querySelector('.workspace-toolbar');
    const preview = document.querySelector('.console-panels');
    if (!status || !connect || !openWindow || !windowNote || !workspace || !toolbar || !preview) return;

    const match = /^#port=([1-9][0-9]{0,4})$/.exec(location.hash);
    const port = match ? Number(match[1]) : 0;
    if (location.origin !== 'https://sherrysherry-1230.github.io' || port < 1 || port > 65535) return;

    const localOrigin = `http://127.0.0.1:${port}`;
    const localUrl = `${localOrigin}/index.html`;
    let frame = null;
    let pending = false;
    let timeout = null;
    connect.disabled = false;
    openWindow.href = localUrl;
    openWindow.hidden = false;
    windowNote.hidden = false;
    status.textContent = '이 컴퓨터의 쩜통 실행 프로그램을 켠 상태에서 연결해 주세요.';

    connect.addEventListener('click', async () => {
        if (frame) {
            frame.focus();
            return;
        }
        if (pending) return;
        pending = true;
        connect.disabled = true;
        try {
            try {
                const permission = await navigator.permissions?.query({ name: 'loopback-network' });
                if (permission?.state === 'denied') {
                    status.textContent = '브라우저의 로컬 연결 권한을 확인하거나 로컬 창에서 열어 주세요.';
                    return;
                }
            } catch {
                // Browsers without this permission query can still open the local window.
            }
            frame = document.createElement('iframe');
            frame.className = 'local-console';
            frame.title = '내 컴퓨터의 해마.ai 콘솔';
            frame.referrerPolicy = 'no-referrer';
            frame.allow = `loopback-network ${localOrigin}; local-network-access ${localOrigin}`;
            frame.src = localUrl;
            toolbar.hidden = true;
            preview.hidden = true;
            workspace.append(frame);
            connect.textContent = '연결 화면으로 이동';
            status.textContent = '쩜통을 연결하고 있어요. 표시되는 연결 화면을 확인해 주세요.';
            timeout = setTimeout(() => {
                status.textContent = '연결을 확인하지 못했어요. 실행 프로그램을 확인하거나 로컬 창에서 열어 주세요.';
            }, 12000);
        } finally {
            pending = false;
            connect.disabled = false;
        }
    });

    window.addEventListener('message', event => {
        if (!frame || event.source !== frame.contentWindow || event.origin !== localOrigin) return;
        const data = event.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)
            || Object.keys(data).sort().join(',') !== 'state,type,version'
            || data.type !== 'haema.local.state' || data.version !== 1
            || !['unpaired', 'connected'].includes(data.state)) return;
        clearTimeout(timeout);
        status.textContent = data.state === 'connected'
            ? '내 컴퓨터의 쩜통에 연결됐어요. 아래에서 API와 쩜통 설정을 확인해 주세요.'
            : '아래 화면에 쩜통 실행 프로그램의 연결 코드를 입력해 주세요.';
    });
})();
