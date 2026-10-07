// @editedBy YAONG1230 2026-10-07
// 해마 캐릭터를 사용하는 확인·안내창. 확인 결과를 기다린 뒤 기존 동작을 이어간다.
window.HAEMA_DIALOG = (() => {
    let pending = Promise.resolve();

    function open({ message, title, tone = 'warning', confirmText = '확인', cancelText = '' }) {
        return new Promise(resolve => {
            const previousFocus = document.activeElement;
            const previousId = previousFocus?.id;
            const dialog = document.createElement('dialog');
            dialog.className = 'haema-dialog';
            dialog.dataset.tone = tone;
            dialog.setAttribute('aria-labelledby', 'haemaDialogTitle');
            dialog.setAttribute('aria-describedby', 'haemaDialogMessage');
            dialog.setAttribute('role', !cancelText && tone === 'error' ? 'alertdialog' : 'dialog');

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'haema-dialog-close';
            close.setAttribute('aria-label', '닫기');
            close.textContent = '×';
            close.addEventListener('click', () => dialog.close('cancelled'));

            const body = document.createElement('div');
            body.className = 'haema-dialog-body';
            const picture = document.createElement('div');
            picture.className = 'haema-dialog-character';
            const image = document.createElement('img');
            image.src = 'Resources/haema-emoji/haema-' + (tone === 'error' ? 'crying' : 'default') + '.svg';
            image.width = 128;
            image.height = 128;
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            picture.append(image);
            const heading = document.createElement('h2');
            heading.id = 'haemaDialogTitle';
            heading.textContent = title || (tone === 'error' ? '다시 확인해주세요' : '잠깐 확인해주세요');
            const description = document.createElement('p');
            description.id = 'haemaDialogMessage';
            description.textContent = message;
            body.append(picture, heading, description);

            const actions = document.createElement('div');
            actions.className = 'haema-dialog-actions';
            if (cancelText) {
                const cancel = document.createElement('button');
                cancel.type = 'button';
                cancel.className = 'btn btn-secondary';
                cancel.textContent = cancelText;
                cancel.autofocus = true;
                cancel.dataset.dialogAction = 'cancel';
                cancel.addEventListener('click', () => dialog.close('cancelled'));
                actions.append(cancel);
            }
            const confirm = document.createElement('button');
            confirm.type = 'button';
            confirm.className = 'btn btn-primary';
            confirm.textContent = confirmText;
            confirm.autofocus = !cancelText;
            confirm.dataset.dialogAction = 'confirm';
            confirm.addEventListener('click', () => dialog.close('confirmed'));
            actions.append(confirm);
            dialog.append(close, body, actions);

            dialog.addEventListener('keydown', event => {
                if (event.key !== 'Tab') return;
                const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
                const first = buttons[0], last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            });

            // Escape와 바깥 클릭은 승인으로 처리하지 않는다.
            dialog.addEventListener('click', event => {
                if (event.target !== dialog) return;
                const rect = dialog.getBoundingClientRect();
                if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close('cancelled');
            });
            dialog.addEventListener('close', () => {
                const confirmed = dialog.returnValue === 'confirmed';
                dialog.remove();
                const focusTarget = previousFocus?.isConnected ? previousFocus : previousId ? document.getElementById(previousId) : null;
                focusTarget?.focus({ preventScroll: true });
                resolve(confirmed);
                // 실패 안내를 닫은 뒤 호출부가 저장 버튼을 다시 활성화할 시간을 준다.
                setTimeout(() => {
                    if (document.querySelector('dialog[open]')) return;
                    const active = document.activeElement;
                    if (active && active !== document.body && !active.disabled) return;
                    const restored = previousFocus?.isConnected ? previousFocus : previousId ? document.getElementById(previousId) : null;
                    const underlying = [...document.querySelectorAll('.modal-overlay.active')].at(-1);
                    const target = restored && restored !== document.body && !restored.disabled ? restored :
                        underlying?.querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)');
                    target?.focus({ preventScroll: true });
                }, 0);
            }, { once: true });
            // 콘솔이 화면을 다시 그려도 안내창과 확인 결과는 유지된다.
            document.body.append(dialog);
            dialog.showModal();
        });
    }

    function show(options) {
        const result = pending.then(() => open(options));
        pending = result.catch(() => false);
        return result;
    }

    return {
        alert: (message, options = {}) => show({ ...options, message, cancelText: '' }),
        confirm: (message, options = {}) => show({ title: '한 번 더 확인할게요', confirmText: '확인', cancelText: '취소', ...options, message })
    };
})();
