import assert from 'node:assert/strict';
import childProcess, { execFile } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { appendFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

// Preload only in the disposable test's .cmd processes. Keep the real launcher,
// controller and backend, but capture the final Windows desktop open so CI does
// not leave tabs behind. Never persist the URL, pairing fragment or path.
if (process.env.HAEMA_SMOKE_DESKTOP_OPENS) {
  const spawn = childProcess.spawn;
  childProcess.spawn = function (binary, args, ...rest) {
    if (binary !== 'rundll32.exe') return spawn.call(this, binary, args, ...rest);
    const valid = args?.length === 2 && args[0] === 'url.dll,FileProtocolHandler' &&
      /^https:\/\/sherrysherry-1230\.github\.io\/HaemaAI_SherrySherry\/#local-connection=[A-Za-z0-9_-]+$/.test(args[1]);
    appendFileSync(process.env.HAEMA_SMOKE_DESKTOP_OPENS, valid ? 'opened\n' : 'invalid\n');
    const opener = new EventEmitter();
    opener.unref = () => {};
    return opener;
  };
  syncBuiltinESMExports();
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('WINDOWS_CMD_TIMEOUT')),ms);
    })]);
  } finally { clearTimeout(timer); }
}

// Exercise the same stale record as a Windows process that exited without cleanup.
export async function recordEndedRunner(root, ownerPid) {
  if (ownerPid === undefined) {
    const exited = childProcess.spawn(process.execPath, ['-e',''], {windowsHide:true, stdio:'ignore'});
    assert.deepEqual(await once(exited,'close'),[0,null]);
    ownerPid = exited.pid;
  }
  const lock = join(root,'.haema','state','run.lock');
  await mkdir(lock);
  const path = join(lock,'owner.json');
  const record = JSON.stringify({
    application:'haema-local-run-lock', version:1, ownerPid, childPid:null,
    nonce:'a'.repeat(43), startedAt:new Date().toISOString(), phase:'preparing',
  });
  await writeFile(path,record,{flag:'wx'});
  return {lock,path,record};
}

export async function verifyWindowsCmdEntryPoints({root, temp, expectedStorage, entry, registration, step}) {
  const report = join(temp,'cmd-desktop-opens.txt');
  const system = join(process.env.SystemRoot,'System32');
  const children = new Set();
  const names = ['Connect.cmd','Start.cmd'];

  function launch(name, cwd = root) {
    // Only constant batch filenames reach cmd. The Unicode store path is its
    // working directory, never command text.
    const child = childProcess.spawn(join(system,'cmd.exe'), ['/d','/c',name], {
      cwd, windowsHide:true, stdio:'ignore',
      env:{...process.env, NODE_OPTIONS:'--import=' + import.meta.url, HAEMA_SMOKE_DESKTOP_OPENS:report},
    });
    children.add(child);
    const exited = new Promise(resolve => {
      child.once('error', () => resolve(null));
      child.once('close', code => { children.delete(child); resolve(code); });
    });
    return {child,exited};
  }

  async function expectOpens(count, owner) {
    const deadline = Date.now() + 30000;
    do {
      const flags = (await readFile(report,'utf8')).split('\n').filter(Boolean);
      assert.ok(flags.every(flag => flag === 'opened') && flags.length <= count);
      if (flags.length === count) return;
      if (owner.exitCode !== null || owner.signalCode !== null) throw new Error('WINDOWS_CMD_ENDED');
      await delay(120);
    } while (Date.now() < deadline);
    throw new Error('WINDOWS_CMD_OPEN_TIMEOUT');
  }

  try {
    let previousScope;
    for (const [index, name] of names.entries()) {
      await step(index === 0 ? 'CONNECT_CMD_COLD_START_AND_LEGACY_REOPEN' : 'LEGACY_CMD_COLD_START_AND_CONNECT_REOPEN');
      assert.equal((await entry.inspectWebControlTarget(root)).running,null);
      await writeFile(report,'');
      if (index === 0) {
        await step('CONNECT_CMD_RECOVERS_ENDED_RUNNER');
        await recordEndedRunner(root);
      }
      const owner = launch(name);
      await expectOpens(1,owner.child);
      const first = await entry.inspectWebControlTarget(root);
      assert.equal(first.storageRoot,expectedStorage);
      assert.equal(first.running.status.mode,'setup');
      assert.equal(first.running.status.ready,true);
      if (previousScope) assert.notEqual(first.running.state.scope,previousScope);
      previousScope = first.running.state.scope;

      const reopen = launch(names[1 - index]);
      assert.equal(await withTimeout(reopen.exited,20000),0);
      await expectOpens(2,owner.child);
      const resumed = await entry.inspectWebControlTarget(root);
      assert.equal(resumed.running.state.scope,first.running.state.scope);
      assert.equal(resumed.running.status.port,first.running.status.port);
      assert.equal(resumed.storageId,first.storageId);

      assert.equal(await withTimeout(launch('Stop.cmd').exited,20000),0);
      assert.equal(await withTimeout(owner.exited,20000),0);
      assert.equal((await entry.inspectWebControlTarget(root)).running,null);
      await registration.assertWebControlRegistration(root);
    }

    await step('CMD_REJECT_INCOMPLETE_EXTRACTION');
    const incomplete = join(temp,'incomplete');
    await mkdir(incomplete);
    for (const name of names) await copyFile(join(root,name),join(incomplete,name));
    for (const name of names) {
      const code = await withTimeout(launch(name,incomplete).exited,10000);
      assert.ok(Number.isInteger(code) && code !== 0);
    }
    await registration.assertWebControlRegistration(root);
  } finally {
    if (children.size) {
      await entry.runInstaller({bundleRoot:root,action:'stop',openBrowser:false}).catch(() => {});
      for (const child of children) {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
        await promisify(execFile)(join(system,'taskkill.exe'),['/PID',String(child.pid),'/T','/F'],
          {windowsHide:true,timeout:4000}).catch(() => {});
      }
    }
  }
}
