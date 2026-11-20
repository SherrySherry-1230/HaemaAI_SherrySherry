import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [source, statusFile] = process.argv.slice(2);
const load = file => import(pathToFileURL(file).href);
let phase = 'WINDOWS_STANDARD_USER';
async function step(name) {
  phase = name;
  await writeFile(statusFile, 'STEP ' + phase);
}

async function run() {
  await step('WINDOWS_STANDARD_USER');
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(await realpath(process.execPath), await realpath(join(source,'.haema','node','win-x64','node.exe')));
  const powershell = join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const elevated = execFileSync(powershell, ['-NoProfile','-NonInteractive','-Command',
    '([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],
    {encoding:'utf8',windowsHide:true}).trim();
  assert.equal(elevated,'False');
  assert.match(process.env.USERNAME ?? '', /^hm[0-9a-f]{12}$/i);
  assert.equal(basename(process.env.USERPROFILE).toLowerCase(),process.env.USERNAME.toLowerCase());

  const parent = join(process.env.LOCALAPPDATA, 'Temp');
  await mkdir(parent,{recursive:true});
  const temp = await mkdtemp(join(parent,'해마 확인 '));
  const root = join(temp,basename(source));
  let controls;
  let setupRun;
  let fullRun;
  try {
    await step('INSTALL_STORAGE');
    await cp(source, root, {recursive:true});
    const entry = await load(join(root,'.haema','start.mjs'));
    const registration = await load(join(root,'.haema','register-web-controls.mjs'));
    const installed = await entry.prepareStorage({bundleRoot:root},{
      pickStorageParent:async () => ({cancelled:false,storageRoot:root}),
    });
    assert.equal(installed.layout.memoryRoot, root);
    await step('REGISTER_WINDOWS_PROTOCOL');
    assert.equal(await registration.registerWebControls({source:root,confirm:async () => true}),true);
    await registration.assertWebControlRegistration(root);

    const native = await load(installed.layout.launcher);
    const { handleBrowserLaunch } = await load(join(root,'.haema','browser-launch.mjs'));
    const setup = Promise.withResolvers();
    const full = Promise.withResolvers();
    let prepares = 0;
    // The dialogs and opening a desktop browser are replaced with an explicit
    // test choice. The protocol registration, launcher, child processes, local
    // control calls, HTTPS preflight and cleanup use the downloaded release.
    const launcher = {
      ...native,
      start(options) {
        assert.equal('serviceCode' in options,false);
        const wait = options.setupOnly ? setup : full;
        return native.start({...options,openBrowser:false,onReady:() => wait.resolve(),
          onError:code => { options.onError?.(code); wait.reject(new Error(code)); }});
      },
    };
    const deps = {
      inspect:() => entry.inspectWebControlTarget(root,{launcher}),
      confirm:async text => { assert.ok(text.includes(root)); return true; },
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
    controls = action => handleBrowserLaunch(['haema-ai://' + action],deps);
    await step('START_SETUP');
    setupRun = controls('start');
    await Promise.race([setup.promise,setupRun.then(() => { throw new Error('SETUP_ENDED'); })]);
    const first = await entry.inspectWebControlTarget(root);
    assert.equal(first.running.status.mode,'setup');
    assert.equal(prepares,0);

    await step('PREPARE_PUBLIC_AI_AND_START');
    fullRun = controls('ai-start');
    await Promise.race([full.promise,fullRun.then(() => { throw new Error('AI_ENDED'); })]);
    await setupRun;
    const second = await entry.inspectWebControlTarget(root);
    assert.equal(second.running.status.mode,'full');
    assert.equal(second.running.status.ready,true);
    assert.notEqual(first.running.state.scope,second.running.state.scope);
    assert.equal(prepares,1);

    await step('STOP');
    assert.equal((await controls('stop')).stopped,true);
    await fullRun;
    assert.equal((await entry.inspectWebControlTarget(root)).running,null);
    controls = null;
  } finally {
    if (controls) await controls('stop').catch(() => {});
    await Promise.allSettled([setupRun,fullRun]);
    await rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:300});
  }
}

try {
  await run();
  await writeFile(statusFile,'PASS STOPPED');
} catch (error) {
  // Only report fixed classifications from the shipped launcher.
  const known = new Set(['PUBLIC_SERVICE_UNAVAILABLE','CONNECTION_SETTINGS_INVALID','STATE_PERMISSIONS_UNAVAILABLE',
    'STATE_PERMISSIONS_READ_FAILED','STATE_PERMISSIONS_WRITE_FAILED','STATE_PERMISSIONS_VERIFY_FAILED',
    'WEB_CONTROL_WINDOWS_UNAVAILABLE','WEB_CONTROL_REGISTRATION_FAILED','WEB_CONTROL_CHANGED','RUNTIME_STOPPED',
    'LOCAL_PORT_START_FAILED','RUNTIME_START_FAILED','RUNTIME_READY_TIMEOUT','PAYLOAD_FILE_CHANGED']);
  const detail = known.has(error?.message) ? '_' + error.message : '';
  await writeFile(statusFile,'FAIL ' + phase + detail);
  process.exitCode = 1;
}
