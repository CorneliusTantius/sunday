import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
function harness(execFile) {
  const context = vm.createContext({ execFile, fileURLToPath, URL, process, Error, json: (res, status, body) => ({ status, body }) });
  const helper = source.slice(source.indexOf('const appDir ='), source.indexOf('const homeDir =')).replace('import.meta.url', JSON.stringify(new URL('../src/server/index.js', import.meta.url).href));
  const route = source.slice(source.indexOf("    if (url.pathname === '/api/update')"), source.indexOf("    if (url.pathname === '/api/settings' && req.method === 'GET')"));
  vm.runInContext(`${helper}\nasync function updateRoute(method) { const url = { pathname: '/api/update' }, req = { method }, res = {}; ${route} }`, context);
  return context;
}

test('update only runs git pull in the application checkout, not the agent workspace', async () => {
  const h = harness((command, args, options, callback) => {
    assert.equal(command, 'git');
    assert.deepEqual(Array.from(args), ['pull']);
    assert.equal(options.cwd, fileURLToPath(new URL('../', import.meta.url)));
    assert.equal(options.timeout, 120000);
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    callback(null, 'Already up to date.\n', '');
  });
  const result = await h.updateRoute('POST');
  assert.equal(result.status, 200);
  assert.equal(result.body.output, 'Already up to date.');
  assert.equal((await h.updateRoute('GET')).status, 405);
});

test('update rejects overlapping pulls and releases the lock after failure', async () => {
  let finish;
  const h = harness((command, args, options, callback) => { finish = callback; });
  const pending = h.updateRoute('POST');
  assert.equal((await h.updateRoute('POST')).status, 409);
  finish(new Error('exit 1'), '', 'Local changes would be overwritten\n');
  await assert.rejects(pending, /Local changes would be overwritten/);
  const retry = h.updateRoute('POST');
  finish(null, 'Updated', '');
  assert.equal((await retry).status, 200);
});

test('restart installs dependencies and builds before shutdown; failures keep the server alive', async () => {
  const route = source.slice(source.indexOf("    if (url.pathname === '/api/restart')"), source.indexOf("    if (url.pathname === '/api/update')"));
  let fail = 'install';
  let scheduled = false;
  const calls = [];
  const context = vm.createContext({
    appDir: '/app', updateRunning: false, Error, Promise,
    process: { env: { INVOCATION_ID: 'service' } },
    execFile(command, args, options, callback) {
      assert.equal(command, 'npm');
      assert.equal(options.cwd, '/app');
      assert.equal(options.timeout, 120000);
      calls.push(Array.from(args));
      const install = args[0] === 'install';
      assert.ok(install || (args[0] === 'run' && args[1] === 'build'));
      callback(fail === (install ? 'install' : 'build') ? new Error(`${install ? 'Install' : 'Build'} failed`) : null, '', '');
    },
    json: (res, status, body) => ({ status, body }),
    res: { once(event) { assert.equal(event, 'finish'); scheduled = true; } }
  });
  vm.runInContext(`async function restart(method) { const url = { pathname: '/api/restart' }, req = { method }; ${route} }`, context);
  assert.equal((await context.restart('GET')).status, 405);
  await assert.rejects(context.restart('POST'), /Install failed/);
  assert.deepEqual(calls, [['install']]);
  assert.equal(scheduled, false);
  assert.equal(context.updateRunning, false);
  fail = 'build';
  await assert.rejects(context.restart('POST'), /Build failed/);
  assert.deepEqual(calls.slice(1), [['install'], ['run', 'build']]);
  assert.equal(scheduled, false);
  assert.equal(context.updateRunning, false);
  fail = '';
  const result = await context.restart('POST');
  assert.equal(result.status, 200);
  assert.deepEqual(calls.slice(3), [['install'], ['run', 'build']]);
  assert.match(result.body.output, /Dependencies installed and build complete/);
  assert.equal(scheduled, true);
  assert.equal((await context.restart('POST')).status, 409);
});

test('update reports subprocess timeouts', async () => {
  const h = harness((command, args, options, callback) => callback({ killed: true }, '', ''));
  await assert.rejects(h.updateRoute('POST'), /Git pull timed out/);
});
