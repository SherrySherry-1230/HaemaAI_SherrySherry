// @editedBy SherrySherry 2026-11-24
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function until(read, failure) {
  const end = Date.now() + 35000;
  do {
    const result = await read();
    if (result) return result;
    await delay(180);
  } while (Date.now() < end);
  throw new Error(failure);
}

async function devtools(address) {
  const endpoint = new URL(address);
  assert.equal(endpoint.protocol, 'ws:');
  assert.equal(endpoint.hostname, '127.0.0.1');
  const socket = new WebSocket(address);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('CHROME_DEBUG_CONNECTION_TIMEOUT'));
      socket.close();
    }, 8000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CHROME_CONNECTION_FAILED'));
    }, { once: true });
  });
  let id = 0;
  // Commands are sent one at a time. Do not print messages or navigation URLs.
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        socket.removeEventListener('message', reply);
        reject(new Error('CHROME_COMMAND_TIMEOUT'));
      }, 8000);
      function reply(event) {
        const value = JSON.parse(event.data);
        if (value.id !== requestId) return;
        clearTimeout(timer);
        socket.removeEventListener('message', reply);
        if (value.error) reject(new Error('CHROME_COMMAND_FAILED'));
        else resolve(value.result);
      }
      socket.addEventListener('message', reply);
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  return { command, close: () => socket.close() };
}

export async function launchHostedChrome(scratch, page, execFile, step) {
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  step('LOCATE_INSTALLED_CHROME');
  await assert.rejects(execFile('/usr/bin/pgrep', ['-x', 'Google Chrome'], { timeout: 5000 }), { code: 1 });
  const { stdout } = await execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
    "ObjC.import('AppKit'); const app = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier('com.google.Chrome'); ObjC.unwrap($.NSBundle.bundleWithURL(app).executableURL.path);"],
  { timeout: 5000 });
  const binary = stdout.trim();
  assert.ok(binary.startsWith('/') && binary.endsWith('/Google Chrome.app/Contents/MacOS/Google Chrome'));
  const profile = join(scratch, 'smoke-chrome');
  step('START_DISPOSABLE_CHROME_PROFILE');
  // Only the test fixture is bootstrapped this way. The URL is delivered by
  // the unmodified release's /usr/bin/open invocation after the profile is ready.
  const chrome = spawn(binary, ['--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-search-engine-choice-screen', '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let ended = false;
  const exited = new Promise(resolve => {
    const finish = () => { ended = true; resolve(); };
    chrome.once('error', finish);
    chrome.once('exit', finish);
  });
  let address, browser;
  async function close() {
    if (browser) {
      await browser.command('Browser.close').catch(() => {});
      browser.close();
    }
    if (!ended) {
      chrome.kill('SIGTERM');
      await Promise.race([exited, delay(2500, undefined, { ref: false })]);
      if (!ended) chrome.kill('SIGKILL');
    }
  }
  try {
    const portFile = await until(() => {
      if (ended) throw new Error('CHROME_EXITED_BEFORE_READY');
      return readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }, 'CHROME_PROFILE_NOT_READY');
    const [port, browserPath] = portFile.trim().split('\n');
    assert.match(port, /^[1-9]\d{0,4}$/);
    assert.match(browserPath, /^\/devtools\/browser\/[a-f0-9-]+$/);
    address = '127.0.0.1:' + port;
    step('CONNECT_CHROME_TEST_PROFILE');
    browser = await devtools('ws://' + address + browserPath);
    assert.match((await browser.command('Browser.getVersion')).product, /^Chrome\//);
    // Same site permission a person grants, scoped to this throwaway profile.
    step('GRANT_TEST_PROFILE_LOOPBACK_PERMISSION');
    await browser.command('Browser.grantPermissions', { origin: new URL(page).origin, permissions: ['loopbackNetwork'] });
  } catch (error) {
    await close();
    throw error;
  }
  async function verifyStore(expectedRoot) {
    // A real /usr/bin/open handoff must create this tab in the profile we
    // started. Never navigate to the URL ourselves or expose its pairing code.
    step('VERIFY_REAL_CHROME_TAB');
    const tab = await until(async () => {
      const response = await fetch('http://' + address + '/json/list', { signal: AbortSignal.timeout(4000) });
      return (await response.json()).find(item => item.type === 'page' && item.url.split('#')[0] === page);
    }, 'CHROME_HANDOFF_MISSING');
    step('VERIFY_CHROME_CONSOLE_CONNECTION');
    const session = await devtools(tab.webSocketDebuggerUrl);
    try {
      const expression = '(' + function (root) {
        const state = globalThis.HAEMA_LOCAL_CONNECTION?.status();
        if (state?.connection === 'awaiting-permission') {
          const dialog = document.querySelector('dialog.haema-dialog[open]');
          if (dialog?.querySelector('#haemaDialogTitle')?.textContent === '내 컴퓨터와 연결할까요?') {
            dialog.querySelector('.btn-primary')?.click();
          }
        }
        const app = globalThis.HAEMA_CONSOLE;
        return state?.connection === 'connected' && state.events === 'connected' && state.runtimeMode === 'setup-only' &&
          app?.storageConnected && app.storageIdentity?.storageRoot?.normalize() === root.normalize() && !location.hash;
      }.toString() + ')(' + JSON.stringify(expectedRoot) + ')';
      await until(async () => (await session.command('Runtime.evaluate', { expression, returnByValue: true })).result.value,
        'CHROME_SETUP_CONNECTION_UNCONFIRMED');
    } finally { session.close(); }
  }
  return { verifyStore, close };
}
