// @editedBy SherrySherry 2026-11-24
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createLocalConnectionClient } from '../../web-console/local-connection-client.mjs';

const execFile = promisify(childProcess.execFile);
const source = await realpath(process.argv[2]);
const scratch = await realpath(process.argv[3]);
const hosted = process.env.MACOS_SMOKE_LAUNCH_SERVICES === 'hosted';
const page = 'https://sherrysherry-1230.github.io/HaemaAI_SherrySherry/';
const load = (root, name) => import(pathToFileURL(join(root, '.haema', name)).href);
let phase;
function step(name) {
  phase = name;
  console.log('STEP', name);
}

async function connect(url) {
  const target = new URL(url);
  assert.ok(target.origin + target.pathname === page && target.search === '');
  assert.ok(target.hash.startsWith('#local-connection='));
  const { descriptor, code } = JSON.parse(Buffer.from(target.hash.slice('#local-connection='.length), 'base64url'));
  assert.match(descriptor.baseUrl, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
  const client = createLocalConnectionClient(descriptor, {
    currentOrigin: target.origin,
    fetch: (address, init) => {
      assert.equal(new URL(address).origin, descriptor.baseUrl);
      return fetch(address, { ...init, headers: { ...init.headers, Origin: target.origin } });
    },
  });
  await client.pair(code);
  return client;
}

async function request(client, operation, input) {
  const response = await client.invoke(operation, input);
  assert.ok(response.ok, operation + ' failed with HTTP ' + response.status);
  return response.json();
}

function uri(action, target) {
  return 'haema-ai://' + action + '?store=' + target.storageId.slice(5) + '&runner=' + target.launcherId.slice(5);
}

async function run() {
  step('VERIFY_TEST_ACCOUNT');
  assert.equal(process.platform, 'darwin');
  assert.notEqual(process.getuid(), 0);
  assert.ok(source.startsWith(scratch + '/archive/'));
  // Real scheme registration is restricted to a fresh hosted test account.
  if (hosted) {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  }
  let nextOpen;
  let closing = false;
  let chrome;
  let useDesktop = false;
  const originalExec = childProcess.execFile;
  const originalSpawn = childProcess.spawn;
  // Keep the real Chrome lookup. Capture only the URL handoff except when
  // observing the real Launch Services delivery inside a fresh hosted profile.
  childProcess.execFile = function (file, ...args) {
    assert.notEqual(file, '/usr/bin/open');
    return originalExec.call(this, file, ...args);
  };
  childProcess.spawn = function (file, ...args) {
    assert.notEqual(file, '/usr/bin/open');
    return originalSpawn.call(this, file, ...args);
  };
  childProcess.execFile[promisify.custom] = async (file, args, options) => {
    if (file !== '/usr/bin/open') return execFile(file, args, options);
    assert.equal(args.length, 3);
    assert.deepEqual(args.slice(0, 2), ['-b', 'com.google.Chrome']);
    if (!closing) {
      assert.ok(nextOpen);
      if (useDesktop) await execFile(file, args, options);
      nextOpen(args[2]);
    }
    return { stdout: '', stderr: '' };
  };
  syncBuiltinESMExports();
  const entry = await load(source, 'start.mjs');
  const registration = await load(source, 'register-web-controls.mjs');
  const { handleBrowserLaunch } = await load(source, 'browser-launch.mjs');
  const parent = join(scratch, '선택한 저장 위치');
  await mkdir(parent);
  const root = join(parent, entry.STORAGE_FOLDER);
  const support = hosted ? join(homedir(), 'Library/Application Support/HaemaAI/WebControls/v1') : join(scratch, 'support');
  if (hosted) await assert.rejects(lstat(support), { code: 'ENOENT' });
  let registered;
  // Keep bundle assembly and signature verification active in both modes.
  // A workstation substitutes only the per-user Launch Services operation.
  const options = hosted ? {} : { support, runNative: async (path, action, app) => {
    assert.equal(path, root);
    assert.equal(app, join(support, 'Haema AI Controls.app'));
    if (action === '--register') registered = path;
    else assert.equal(action, '--check');
    return registered === path ? 'REGISTERED' : 'CHANGED';
  } };
  const register = path => {
    assert.ok(!closing);
    return registration.installWebControlRegistration(path, options);
  };
  const assertRegistered = path => {
    assert.ok(!closing);
    return registration.assertWebControlRegistration(path, options);
  };
  const choose = choice => options => entry.prepareStorage(options, { pickStorageParent: async () => choice });
  const confirmRoot = text => {
    assert.ok(text.includes(root));
    return true;
  };

  step('CANCEL_FOLDER_SELECTION');
  assert.equal(await registration.registerAndConnect({
    source, prepare: choose({ cancelled: true }), confirm: confirmRoot, register, assertRegistered,
  }), false);
  await assert.rejects(lstat(root), { code: 'ENOENT' });

  const runs = [];
  const clients = [];
  let expectedStore = root;
  async function opening(action, timeout = 45000) {
    assert.equal(nextOpen, undefined);
    const opened = Promise.withResolvers();
    nextOpen = opened.resolve;
    let timer;
    const run = Promise.resolve().then(action);
    runs.push(run);
    try {
      const url = await Promise.race([
        opened.promise,
        run.then(() => opened.promise),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CONSOLE_OPEN_TIMEOUT')), timeout); }),
      ]);
      if (useDesktop) {
        await chrome.verifyStore(expectedStore);
        return { run };
      }
      const client = await connect(url);
      clients.push(client);
      return { client, run };
    } finally {
      clearTimeout(timer);
      nextOpen = undefined;
    }
  }
  function control(action, target, confirm = text => {
    assert.ok(text.includes(expectedStore));
    return true;
  }) {
    return handleBrowserLaunch([uri(action, target)], { bundleRoot: root, assertRegistered, confirm,
      fetchImpl: () => { throw new Error('Synthetic offline connection'); } });
  }
  try {
    step(hosted ? 'REGISTER_MACOS_SCHEME_AND_START' : 'START_WITH_ISOLATED_REGISTRATION');
    const setup = await opening(() => registration.registerAndConnect({
      source, prepare: choose({ cancelled: false, storageRoot: parent }), confirm: confirmRoot, register, assertRegistered,
    }), 240000);
    assert.equal(await entry.resolveWebControlTarget(source), root);
    await assertRegistered(root);
    assert.equal((await lstat(join(support, 'Haema AI Controls.app'))).uid, process.getuid());
    const first = await entry.inspectWebControlTarget(root);
    assert.equal(first.running.status.mode, 'setup');
    assert.equal(first.running.status.ready, true);
    assert.equal(first.storageId, first.launcherId);
    const initial = await request(setup.client, 'storage.status');
    assert.equal(initial.connected, true);
    assert.equal(initial.storageId, first.storageId);
    assert.equal(initial.storageRoot, root);

    if (hosted) {
      assert.equal((await lstat(join(support, 'registration.json'))).uid, process.getuid());
      // Launch Services dispatches an unsupported action to the registered app;
      // the native helper must exit without asking to run an operation.
      await execFile('/usr/bin/open', ['-W', 'haema-ai://unsupported-smoke'], { timeout: 20000 });
      step('OPEN_INSTALLED_CHROME_THROUGH_LAUNCH_SERVICES');
      const { launchHostedChrome } = await import('./macos-chrome-smoke.mjs');
      chrome = await launchHostedChrome(scratch, page, execFile);
      useDesktop = true;
      const inChrome = await opening(() => execFile(join(root, 'Start.command'), [], { timeout: 30000 }));
      await inChrome.run;
      useDesktop = false;
    }

    step('REOPEN_USING_INSTALLED_COMMAND');
    const reopened = await opening(() => execFile(join(root, 'Start.command'), [], { timeout: 30000 }));
    await reopened.run;
    assert.equal((await request(reopened.client, 'storage.status')).storageId, first.storageId);
    assert.equal((await entry.inspectWebControlTarget(root)).running.state.scope, first.running.state.scope);

    step('SWITCH_STORE_AND_REJECT_STALE_TARGETS');
    const alternate = join(scratch, entry.STORAGE_FOLDER + '_2');
    const selected = await request(reopened.client, 'storage.init', { storageRoot: alternate, forceCreate: false, connectExisting: false });
    assert.equal(selected.connected, true);
    const changed = await entry.inspectWebControlTarget(root);
    assert.equal(changed.storageRoot, alternate);
    assert.equal(selected.storageId, changed.storageId);
    assert.notEqual(changed.storageId, first.storageId);
    assert.equal(changed.launcherId, first.launcherId);
    expectedStore = alternate;
    const helper = join(root, '.haema/mac-web-helper.bin');
    for (const action of ['start', 'ai-start', 'stop']) {
      await execFile(helper, ['--validate-url', uri(action, changed)]);
      for (const stale of [first, { storageId: changed.storageId, launcherId: changed.storageId }]) {
        await assert.rejects(control(action, stale, () => assert.fail('Confirmed stale target')), { message: 'WEB_CONTROL_TARGET_MISMATCH' });
      }
    }
    const cancel = text => { assert.ok(text.includes(alternate) && text.includes(root)); return false; };
    assert.equal((await control('ai-start', changed, cancel)).cancelled, true);
    assert.equal((await control('stop', changed, cancel)).cancelled, true);
    assert.equal((await entry.inspectWebControlTarget(root)).running.state.scope, first.running.state.scope);
    const sentinel = join(alternate, 'smoke-preservation.txt');
    await writeFile(sentinel, 'synthetic', { flag: 'wx' });

    step('STOP_AND_RESTART_SAVED_STORE');
    assert.equal((await control('stop', changed)).stopped, true);
    assert.equal(await setup.run, true);
    const stopped = await entry.inspectWebControlTarget(root);
    assert.equal(stopped.running, null);
    assert.equal(stopped.storageRoot, alternate);
    const restarted = await opening(() => control('start', changed));
    const restored = await request(restarted.client, 'storage.status');
    assert.equal(restored.storageRoot, alternate);
    assert.equal(restored.storageId, changed.storageId);
    assert.notEqual((await entry.inspectWebControlTarget(root)).running.state.scope, first.running.state.scope);
    assert.equal(await readFile(sentinel, 'utf8'), 'synthetic');
    await execFile(join(root, 'Stop.command'), [], { timeout: 30000 });
    await restarted.run;
    assert.equal((await entry.inspectWebControlTarget(root)).running, null);
  } finally {
    closing = true;
    for (const client of clients) client.close();
    // Only this disposable installation can own the test controller.
    await entry.runInstaller({ bundleRoot: root, action: 'stop' }).catch(() => {});
    await Promise.allSettled(runs);
    await chrome?.close();
    childProcess.execFile = originalExec;
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
}

try {
  await run();
  console.log('PASS: macOS installer, setup connection, scoped controls and saved store.');
} catch (error) {
  const classification = error?.code ?? error?.message;
  const code = /^[A-Z_]{1,56}$/.test(classification) ? classification : 'CHECK_FAILED';
  // Assertions can contain connection URLs. Report only the smoke check's line.
  const line = error?.stack?.match(/macos-release-smoke\.mjs:(\d+):\d+\)?(?:\n|$)/)?.[1];
  console.error('FAIL', phase, code, line ? 'at smoke line ' + line : '');
  process.exitCode = 1;
}
