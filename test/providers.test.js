import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('provider credentials and model catalogs are isolated and persist', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-provider-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  let child;
  async function start() {
    child = spawn(process.execPath, [new URL('../server.js', import.meta.url).pathname, '--production'], { env: { ...process.env, HOME: home, PORT: String(port), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    });
  }
  async function stop() { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  async function api(path, data, method = 'POST') {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, data === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  const authPath = join(home, 'sunday', 'data', 'auth.json');
  try {
    await start();
    for (const provider of ['openai', 'anthropic', 'google']) {
      const view = await api(`/api/settings?provider=${provider}`);
      assert.equal(view.status, 200);
      assert.equal(view.body.connected, false);
      assert.deepEqual(view.body.models, []);
      assert.equal(view.body.model, null);
      assert.equal((await api('/api/settings', { provider, apiKey: `offline-${provider}` }, 'PUT')).status, 200);
      assert.equal((await api(`/api/settings?provider=${provider}`)).body.connected, true);
    }
    const oauth = await api('/api/settings?provider=openai&mode=oauth');
    assert.equal(oauth.body.connected, false);
    assert.deepEqual(oauth.body.models, []);
    let auth = JSON.parse(await readFile(authPath, 'utf8'));
    for (const provider of ['openai', 'anthropic', 'google']) assert.equal(auth[provider].key, `offline-${provider}`);
    assert.equal(auth['openai-chatgpt'], undefined);
    const before = await readFile(authPath, 'utf8');
    const invalid = await api('/api/settings', { provider: 'openai', apiKey: 'must-not-save', model: 'not-a-model' }, 'PUT');
    assert.equal(invalid.status, 400);
    assert.equal(await readFile(authPath, 'utf8'), before);
    assert.equal((await api('/api/settings', { provider: 'openai', apiKey: 'key-only' }, 'PUT')).status, 200);
    await stop();
    await start();
    auth = JSON.parse(await readFile(authPath, 'utf8'));
    for (const provider of ['openai', 'anthropic', 'google']) assert.equal(auth[provider].key, provider === 'openai' ? 'key-only' : `offline-${provider}`);
    const settings = await api('/api/settings');
    assert.equal(settings.body.provider, 'openai');
    assert.ok(settings.body.models.every(model => model.id && model.name && Array.isArray(model.thinkingLevels)));
  } finally {
    if (child && child.exitCode === null) await stop();
    await rm(home, { recursive: true, force: true });
  }
});
