import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// ChromeDriver is preinstalled on GitHub's Windows runner. Use its temporary
// Chrome profile and a loopback WebDriver session. Never log command payloads.
export async function verifyPublicConsole(webUrl, root, storageId, { switchTo, launcherId, checkPublished = false } = {}) {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(join(process.env.CHROMEWEBDRIVER, 'chromedriver.exe'), ['--port=' + port], {
    stdio:'ignore', windowsHide:true,
  });
  let exited = false;
  child.once('error', () => { exited = true; });
  child.once('exit', () => { exited = true; });
  const endpoint = 'http://127.0.0.1:' + port;
  async function command(path, method = 'GET', data) {
    const response = await fetch(endpoint + path, { method, signal:AbortSignal.timeout(25000),
      ...(data === undefined ? {} : {headers:{'content-type':'application/json'},body:JSON.stringify(data)}) });
    const {value} = await response.json();
    if (!response.ok || value?.error) throw new Error('WINDOWS_BROWSER_COMMAND_FAILED');
    return value;
  }
  let session;
  try {
    const driverDeadline = Date.now() + 15000;
    for (;;) {
      if (exited) throw new Error('WINDOWS_CHROMEDRIVER_EXITED');
      try { if ((await command('/status')).ready) break; }
      catch { /* The driver can still be binding its loopback port. */ }
      if (Date.now() >= driverDeadline) throw new Error('WINDOWS_CHROMEDRIVER_TIMEOUT');
      await delay(150);
    }
    const {sessionId} = await command('/session', 'POST', {capabilities:{alwaysMatch:{
      browserName:'chrome', pageLoadStrategy:'eager',
      'goog:chromeOptions':{args:['--headless=new','--no-first-run','--no-default-browser-check']},
    }}});
    session = '/session/' + sessionId;
    const post = (path, data) => command(session + path, 'POST', data);
    const evaluate = (script, ...args) => post('/execute/sync', {script, args});
    const click = async selector => {
      const element = await post('/element', {using:'css selector',value:selector});
      const id = element['element-6066-11e4-a52e-4f735466cecf'];
      await post('/element/' + encodeURIComponent(id) + '/click', {});
    };
    const waitFor = async (script, failure, ...args) => {
      const until = Date.now() + 12000;
      do {
        if (await evaluate(script, ...args)) return;
        await delay(120);
      } while (Date.now() < until);
      throw new Error(failure);
    };
    // Both sets of buttons must be bound to the same confirmed server response.
    // The pre-deployment run uses the current live UI only for switching stores.
    const checkButtons = async (store, runner) => {
      if (!checkPublished) return;
      await waitFor(`
        const [store, runner] = arguments;
        return ['ai-start','start','stop'].every((action, i) => {
          const expected = 'haema-ai://' + action + '?store=' + store.slice(5) + '&runner=' + runner.slice(5);
          const ids = ['header-launcher-' + action, ['storageStartAIHaema','storageStartHaema','storageStopHaema'][i]];
          return ids.every(id => document.getElementById(id)?.getAttribute('href') === expected);
        });
      `, 'WINDOWS_CONSOLE_WRONG_CONTROLS', store, runner);
    };
    const openStore = async expected => {
      await click('#storageBtn');
      await waitFor("return document.getElementById('storageConfirmedPath')?.textContent.includes(arguments[0]);",
        'WINDOWS_CONSOLE_WRONG_STORE', expected);
    };
    const readScope = async () => {
      const status = await post('/execute/async', {script:`
        const done = arguments[arguments.length - 1];
        globalThis.HAEMA_LOCAL_CONNECTION.request('storage.status').then(async response => {
          if (!response.ok) return done(null);
          const {connected, storageId, launcherId, storageRoot} = await response.json();
          done(connected ? {storageId, launcherId, storageRoot} : null);
        }).catch(() => done(null));
      `, args:[]});
      if (!status || !/^file:[a-f0-9]{64}$/.test(status.storageId) || status.launcherId !== launcherId) {
        throw new Error('WINDOWS_CONSOLE_WRONG_STORE');
      }
      return status;
    };
    // This is the one-time Windows Chrome permission a person would grant.
    // Restrict it to the official origin inside this disposable profile.
    const origin = 'https://sherrysherry-1230.github.io';
    const allow = name => post('/goog/cdp/execute', {cmd:'Browser.setPermission',
      params:{permission:{name},setting:'granted',origin}});
    try { await allow('loopback-network'); }
    catch { await allow('local-network-access'); }
    await post('/url', {url:webUrl});
    let clicked = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      // Read only the result exposed by the real console and its storage button.
      // Return classifications, never the URL fragment, storage ID or path.
      const result = await post('/execute/sync', {script:`
        const status = globalThis.HAEMA_LOCAL_CONNECTION?.status();
        const app = globalThis.HAEMA_CONSOLE;
        if (status?.connection === 'connected' && status.runtimeMode === 'setup-only'
            && status.events === 'connected' && app?.storageConnected && !app.storageStatusUnconfirmed
            && app.storageIdentity?.storageRoot === arguments[0] && app.storageIdentity?.storageId === arguments[1]
            && document.querySelector('#storageBtn.is-connected')) return 'ready';
        const dialog = document.querySelector('dialog.haema-dialog[open]');
        if (status?.connection === 'awaiting-permission' &&
            dialog?.querySelector('#haemaDialogTitle')?.textContent === '내 컴퓨터와 연결할까요?' &&
            dialog.querySelector('.btn-primary')?.textContent === '연결') return 'confirm';
        if (status?.connection === 'permission-denied') return 'permission-denied';
        if (status?.firstFailure) return 'connection-error';
        if (status?.eventFailure) return 'events-error';
        if (status?.connection === 'connected' && status.runtimeMode === 'full') return 'wrong-mode';
        if (app?.storageConnected && app.storageIdentity && (app.storageIdentity.storageRoot !== arguments[0] ||
            app.storageIdentity.storageId !== arguments[1])) return 'wrong-store';
        return 'waiting';
      `,args:[root,storageId]});
      if (result === 'ready') {
        const first = await readScope();
        if (first.storageRoot !== root || first.storageId !== storageId) throw new Error('WINDOWS_CONSOLE_WRONG_STORE');
        if (!switchTo) return first;
        await openStore(root);
        await checkButtons(first.storageId, first.launcherId);
        await click('#storageManageSummary');
        await click('#storageDirectInputBtn');
        // ChromeDriver sendKeys on Windows cannot type the non-BMP folder emoji.
        // Paste only the synthetic absolute path, then use the actual submit button.
        await evaluate(`
          const input = document.querySelector('#storagePathInput');
          if (!input || input.disabled) throw new Error('Path input unavailable');
          input.value = arguments[0];
          input.dispatchEvent(new Event('input', {bubbles:true}));
        `, switchTo);
        await click('#storageCreateBtn');
        await waitFor(`
          return !document.querySelector('#storageModalOverlay') &&
            globalThis.HAEMA_CONSOLE?.storageIdentity?.storageRoot === arguments[0];
        `, 'WINDOWS_CONSOLE_SWITCH_FAILED', switchTo);
        const second = await readScope();
        if (second.storageRoot !== switchTo || second.storageId === first.storageId) {
          throw new Error('WINDOWS_CONSOLE_WRONG_STORE');
        }
        await openStore(switchTo);
        await checkButtons(second.storageId, second.launcherId);
        return second;
      }
      if (['permission-denied','connection-error','events-error','wrong-mode','wrong-store'].includes(result)) {
        throw new Error('WINDOWS_CONSOLE_' + result.replace('-', '_').toUpperCase());
      }
      if (result === 'confirm' && !clicked) {
        await click('dialog.haema-dialog[open] .btn-primary');
        clicked = true;
      }
      await delay(250);
    }
    throw new Error('WINDOWS_CONSOLE_NOT_CONNECTED');
  } finally {
    if (session) await command(session, 'DELETE').catch(() => {});
    if (!exited) {
      const closed = once(child, 'exit').catch(() => {});
      child.kill();
      await Promise.race([closed,delay(3000)]);
    }
  }
}
