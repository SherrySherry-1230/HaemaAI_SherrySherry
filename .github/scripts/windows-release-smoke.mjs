import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPublicConsole } from './windows-console-browser.mjs';

const [source, statusFile, profile] = process.argv.slice(2);
const load = file => import(pathToFileURL(file).href);
let phase = 'WINDOWS_STANDARD_USER';
async function step(name) {
  phase = name;
  await writeFile(statusFile, 'STEP ' + phase);
}

async function readyWithConsole(ready, opened, running) {
  let timer;
  try {
    const [info, args] = await Promise.race([
      Promise.all([ready.promise, opened.promise]),
      running.then(() => { throw new Error('START_ENDED'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CONSOLE_OPEN_TIMEOUT')), 90000); }),
    ]);
    assert.equal(args.length, 2);
    assert.equal(args[0], 'url.dll,FileProtocolHandler');
    // Do not include the connection fragment in assertion messages or CI output.
    assert.ok(args[1] === info.webUrl);
    const url = new URL(args[1]);
    assert.equal(url.origin + url.pathname, 'https://sherrysherry-1230.github.io/HaemaAI_SherrySherry/');
    assert.equal(url.search, '');
    assert.ok(url.hash.startsWith('#local-connection='));
    assert.equal(info.descriptor.baseUrl, 'http://127.0.0.1:' + info.port);
    return {port:info.port,webUrl:args[1]};
  } finally { clearTimeout(timer); }
}

async function run() {
  assert.ok(['runner','standard'].includes(profile));
  await step(profile === 'runner' ? 'WINDOWS_HOSTED_RUNNER' : 'WINDOWS_STANDARD_USER');
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(await realpath(process.execPath), await realpath(join(source,'.haema','node','win-x64','node.exe')));
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const account = JSON.parse(execFileSync(powershell, ['-NoProfile','-NonInteractive','-Command', `
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $admin = ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\' + $id.User.Value
    @{admin=$admin; name=$id.Name.Split('\\')[-1]; profile=[Environment]::ExpandEnvironmentVariables((Get-ItemProperty $key).ProfileImagePath)} | ConvertTo-Json -Compress
  `], {encoding:'utf8',windowsHide:true}));
  if (profile === 'standard') {
    assert.equal(account.admin,false);
    assert.match(account.name, /^hm[0-9a-f]{12}$/i);
    assert.equal(basename(account.profile).toLowerCase(),account.name.toLowerCase());
  }
  // Install into a fresh temporary directory of the actual Windows account.
  const parent = join(account.profile,'AppData','Local','Temp');
  Object.assign(process.env, {SystemRoot:systemRoot,WINDIR:systemRoot,USERNAME:account.name,USERPROFILE:account.profile,
    LOCALAPPDATA:dirname(parent),APPDATA:join(account.profile,'AppData','Roaming'),TEMP:parent,TMP:parent});
  await mkdir(parent,{recursive:true});
  const temp = await mkdtemp(join(parent,'해마 확인 '));
  const root = join(temp,basename(source));
  let controls;
  let setupRun;
  let restartedRun;
  let fullRun;
  const spawn = childProcess.spawn;
  try {
    await step('INSTALL_STORAGE');
    await cp(source, root, {recursive:true});
    const entry = await load(join(root,'.haema','start.mjs'));
    const registration = await load(join(root,'.haema','register-web-controls.mjs'));
    const native = await load(join(root,'.haema','launcher','launcher.mjs'));
    const { handleBrowserLaunch } = await load(join(root,'.haema','browser-launch.mjs'));
    const setup = Promise.withResolvers();
    const restarted = Promise.withResolvers();
    const full = Promise.withResolvers();
    const setupOpened = Promise.withResolvers();
    const restartedOpened = Promise.withResolvers();
    const fullOpened = Promise.withResolvers();
    const browserOpens = profile === 'runner' ? [setupOpened, restartedOpened, fullOpened] : [setupOpened, fullOpened];
    let openCount = 0;
    let setupStarts = 0;
    let prepares = 0;
    // Capture only the final Windows desktop browser invocation. Keep the
    // shipped launcher's openBrowser setting and all runtime child processes.
    childProcess.spawn = function (command, args, ...rest) {
      if (command !== 'rundll32.exe') return spawn.call(this, command, args, ...rest);
      browserOpens[openCount++]?.resolve(args);
      const opener = new EventEmitter();
      opener.unref = () => {};
      return opener;
    };
    syncBuiltinESMExports();
    const launcher = {
      ...native,
      start(options) {
        assert.equal('serviceCode' in options,false);
        const wait = options.setupOnly ? (++setupStarts === 1 ? setup : restarted) : full;
        assert.equal(options.openBrowser,true);
        return native.start({...options,onReady:info => { options.onReady?.(info); wait.resolve(info); },
          onError:code => { options.onError?.(code); wait.reject(new Error(code)); }});
      },
    };
    const deps = {
      inspect:() => entry.inspectWebControlTarget(root,{launcher}),
      assertRegistered:registration.assertWebControlRegistration,
      fetchImpl:async (url, init) => {
        const official = new URL(native.PUBLIC_SERVICE_URL);
        const destination = new URL(url);
        assert.equal(destination.protocol, 'https:');
        assert.equal(destination.origin, official.origin);
        assert.ok(destination.pathname.startsWith(official.pathname + '/'));
        assert.equal(init.method,'POST');
        assert.deepEqual([...new Headers(init.headers).keys()], ['content-type']);
        assert.equal(init.body,'{}');
        assert.equal(init.redirect,'error');
        prepares++;
        return fetch(url,init);
      },
    };
    let effectiveRoot = root;
    let scope;
    function checkConfirmation(text) {
      // Inspect the real handler's confirmation text, then supply a scripted
      // answer instead of driving an interactive Windows MessageBox from CI.
      assert.ok(text.includes(effectiveRoot));
      if (root !== effectiveRoot) assert.ok(text.indexOf(root) > text.indexOf(effectiveRoot));
    }
    controls = (action, {target = scope, confirm = text => { checkConfirmation(text); return true; }} = {}) => {
      const base = 'haema-ai://' + action;
      const uri = target ? base + '?store=' + target.storageId.slice(5) + '&runner=' + target.launcherId.slice(5) : base;
      return handleBrowserLaunch([uri], {...deps,confirm});
    };
    await step('REGISTER_AND_CONNECT');
    let picked = 0;
    let confirmedTarget = false;
    let registeredTarget;
    setupRun = registration.registerAndConnect({
      source:root,
      confirm:async message => {
        if (message.includes(root)) confirmedTarget = true;
        return true;
      },
      prepare:options => entry.prepareStorage(options, {
        pickStorageParent:async () => { picked++; return {cancelled:false,storageRoot:root}; },
      }),
      onRegistered:target => {
        assert.ok(confirmedTarget);
        registeredTarget = target;
      },
      inspect:deps.inspect,
    });
    const started = await readyWithConsole(setup,setupOpened,setupRun);
    assert.equal(picked,1);
    assert.equal(registeredTarget,root);
    await registration.assertWebControlRegistration(root);
    const first = await entry.inspectWebControlTarget(root);
    assert.equal(first.running.status.mode,'setup');
    assert.equal(first.running.status.ready,true);
    assert.equal(first.running.status.port,started.port);
    assert.match(first.storageId,/^file:[a-f0-9]{64}$/);
    assert.equal(first.launcherId,first.storageId);
    scope = first;
    assert.equal(openCount,1);
    assert.equal(prepares,0);
    if (profile === 'runner') {
      const published = process.env.CHECK_PUBLISHED_CONTROLS === 'true';
      await step(published ? 'CHECK_PUBLISHED_CHROME_STORE_CONTROLS' : 'SWITCH_PUBLIC_CONSOLE_STORE_IN_CHROME');
      const secondRoot = join(temp,'선택한 기억',basename(source) + '_2');
      const selected = await verifyPublicConsole(started.webUrl,root,first.storageId,{
        switchTo:secondRoot, launcherId:first.launcherId, checkPublished:published,
      });
      const changed = await entry.inspectWebControlTarget(root);
      assert.equal(changed.storageRoot,selected.storageRoot);
      assert.equal(changed.storageId,selected.storageId);
      assert.equal(changed.launcherId,first.launcherId);
      assert.equal(changed.running.state.scope,first.running.state.scope);
      effectiveRoot = secondRoot;
      scope = changed;

      await step('REJECT_STALE_STORE_AND_OTHER_INSTALLATION');
      // Each test changes one binding only. No confirmation or mode transition
      // may occur, even for Stop, which otherwise closes a running setup server.
      const foreignLauncher = {storageId:changed.storageId,launcherId:changed.storageId};
      for (const target of [first, foreignLauncher]) {
        for (const action of ['start','ai-start','stop']) {
          await assert.rejects(controls(action,{target,confirm:() => assert.fail('Stale target offered for confirmation')}),
            {message:'WEB_CONTROL_TARGET_MISMATCH'});
        }
      }
      assert.equal((await entry.inspectWebControlTarget(root)).running.state.scope,first.running.state.scope);
      assert.equal(prepares,0);
      await step('CANCEL_AND_CONFIRM_SCOPED_NATIVE_STOP');
      let prompted = 0;
      const cancelStop = await controls('stop',{confirm:text => {
        checkConfirmation(text);
        prompted++;
        return false;
      }});
      assert.equal(prompted,1);
      assert.equal(cancelStop.cancelled,true);
      assert.equal((await entry.inspectWebControlTarget(root)).running.state.scope,first.running.state.scope);
      assert.equal((await controls('stop')).stopped,true);
      assert.equal(await setupRun,true);
      const stopped = await entry.inspectWebControlTarget(root);
      assert.equal(stopped.running,null);
      assert.equal(stopped.storageRoot,secondRoot);
      assert.equal(stopped.storageId,changed.storageId);

      await step('RESTART_SCOPED_SETUP_WITH_SELECTED_STORE');
      restartedRun = controls('start');
      const reopened = await readyWithConsole(restarted,restartedOpened,restartedRun);
      const again = await entry.inspectWebControlTarget(root);
      assert.equal(again.running.status.mode,'setup');
      assert.notEqual(again.running.state.scope,first.running.state.scope);
      assert.equal(again.storageId,changed.storageId);
      await verifyPublicConsole(reopened.webUrl,secondRoot,changed.storageId,{launcherId:changed.launcherId});
    }

    await step('PREPARE_PUBLIC_AI_AND_START');
    fullRun = controls('ai-start');
    const fullConsole = await readyWithConsole(full,fullOpened,fullRun);
    assert.equal(await setupRun,true);
    const second = await entry.inspectWebControlTarget(root);
    assert.equal(second.running.status.mode,'full');
    assert.equal(second.running.status.ready,true);
    assert.equal(second.running.status.port,fullConsole.port);
    assert.equal(openCount,profile === 'runner' ? 3 : 2);
    assert.equal(second.storageRoot,effectiveRoot);
    assert.equal(second.storageId,scope.storageId);
    assert.notEqual(first.running.state.scope,second.running.state.scope);
    assert.equal(prepares,1);

    await step('STOP');
    assert.equal((await controls('stop')).stopped,true);
    await fullRun;
    if (restartedRun) await restartedRun;
    assert.equal((await entry.inspectWebControlTarget(root)).running,null);
    controls = null;
  } catch (error) {
    await reportFailure(error);
    throw error;
  } finally {
    const cleanup = async () => {
      if (controls) await controls('stop',{target:null,confirm:() => true}).catch(() => {});
      await Promise.allSettled([setupRun,restartedRun,fullRun]);
    };
    let timer;
    try {
      await Promise.race([cleanup(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('CLEANUP_TIMEOUT')),8000);
      })]);
    } finally {
      clearTimeout(timer);
      childProcess.spawn = spawn;
      syncBuiltinESMExports();
    }
    await rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:300});
  }
}

async function reportFailure(error) {
  // Only report fixed classifications from the shipped launcher.
  const known = new Set(['PUBLIC_SERVICE_UNAVAILABLE','CONNECTION_SETTINGS_INVALID','STATE_PERMISSIONS_UNAVAILABLE',
    'STATE_PERMISSIONS_READ_FAILED','STATE_PERMISSIONS_WRITE_FAILED','STATE_PERMISSIONS_VERIFY_FAILED',
    'WEB_CONTROL_WINDOWS_UNAVAILABLE','WEB_CONTROL_REGISTRATION_FAILED','WEB_CONTROL_CHANGED','RUNTIME_STOPPED',
    'LOCAL_PORT_START_FAILED','RUNTIME_START_FAILED','RUNTIME_READY_TIMEOUT','PAYLOAD_FILE_CHANGED',
    'CONSOLE_OPEN_TIMEOUT','WINDOWS_CHROMEDRIVER_EXITED','WINDOWS_CHROMEDRIVER_TIMEOUT','WINDOWS_BROWSER_COMMAND_FAILED',
    'WINDOWS_CONSOLE_NOT_CONNECTED','WINDOWS_CONSOLE_PERMISSION_DENIED','WINDOWS_CONSOLE_CONNECTION_ERROR',
    'WINDOWS_CONSOLE_EVENTS_ERROR','WINDOWS_CONSOLE_WRONG_MODE','WINDOWS_CONSOLE_WRONG_STORE',
    'WINDOWS_CONSOLE_SWITCH_FAILED','WINDOWS_CONSOLE_WRONG_CONTROLS']);
  const detail = known.has(error?.message) ? '_' + error.message : '';
  await writeFile(statusFile,'FAIL ' + phase + detail);
}

try {
  await run();
  await writeFile(statusFile,'PASS STOPPED');
} catch (error) {
  await reportFailure(error);
  process.exitCode = 1;
}
