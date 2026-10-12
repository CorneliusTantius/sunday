import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

function assertProfile(actual, expected) {
  const { name, specialty, instructions } = actual;
  assert.deepEqual({ name, specialty, instructions }, expected);
  assert.ok(actual.color); assert.ok(actual.emoji); assert.ok(actual.personaId);
}

 test('sessions persist across restarts and workspace defaults to ~/sunday/workspace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-test-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  let child;
  async function start() {
    child = spawn(process.execPath, [new URL('../server.js', import.meta.url).pathname, '--production'], { env: { ...process.env, HOME: home, PORT: String(port), OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  try {
    await start();
    const settings = await api('/api/settings');
    assert.equal(settings.body.workspaceDir, join(home, 'sunday', 'workspace'));
    assert.ok((await stat(settings.body.workspaceDir)).isDirectory());
    const created = await api('/api/sessions', { profile: { name: 'Tutor', specialty: 'Math', instructions: 'Show steps' } });
    assert.equal(created.status, 201);
    assertProfile(created.body.session.profile, { name: 'Tutor', specialty: 'Math', instructions: 'Show steps' });
    assert.equal((await api('/api/sessions', { profile: { name: '', specialty: '', instructions: '' } })).status, 400);
    const id = created.body.session.id;
    assert.deepEqual(created.body.session.messages, []);
    const response = await api('/api/chat', { sessionId: id, messages: [{ role: 'user', content: 'Remember this message' }] });
    assert.equal(response.status, 400); // No credentials; user message must still persist.
    const path = join(home, 'sunday', 'data', 'sessions', `${id}.json`);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).messages[0].content, 'Remember this message');
    assert.equal((await api('/api/sessions/not-a-valid-id')).status, 400);
    const settingsPath = join(home, 'sunday', 'data', 'settings.json');
    const deviceId = JSON.parse(await readFile(settingsPath, 'utf8')).deviceId;
    assert.match(deviceId, /^[a-f0-9-]{36}$/);
    await stop();
    const authPath = join(home, 'sunday', 'data', 'auth.json');
    await writeFile(authPath, JSON.stringify({
      openai: { type: 'api_key', key: 'test-key-not-real' },
      'openai-chatgpt': { type: 'oauth', access: 'test-access', refresh: 'test-refresh', expires: Date.now() + 3600000 },
    }));
    await start();
    const authorization = await api('/api/settings');
    assert.equal(authorization.body.hasApiKey, true);
    assert.equal(authorization.body.oauthConnected, true);
    assert.ok(!JSON.stringify(authorization.body).includes('test-key-not-real'));
    const oauth = await api('/api/settings?mode=oauth');
    assert.deepEqual(oauth.body.models, authorization.body.models);
    const reasoningModel = oauth.body.models.find(model => model.thinkingLevels.includes('high'));
    assert.ok(reasoningModel);
    const thinking = await api('/api/settings', { mode: 'oauth', model: reasoningModel.id, thinkingLevel: 'high' }, 'PUT');
    assert.equal(thinking.status, 200);
    assert.equal(thinking.body.thinkingLevel, 'high');
    assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).thinkingLevel, 'high');
    assert.equal((await api('/api/settings', { mode: 'oauth', model: reasoningModel.id, thinkingLevel: 'invalid' }, 'PUT')).status, 400);
    const nonReasoning = oauth.body.models.find(model => model.thinkingLevels.length === 1 && model.thinkingLevels[0] === 'off');
    assert.ok(nonReasoning);
    const off = await api('/api/settings', { mode: 'oauth', model: nonReasoning.id }, 'PUT');
    assert.equal(off.body.thinkingLevel, 'off');
    assert.equal((await api('/api/settings', { mode: 'oauth', model: oauth.body.model }, 'PUT')).status, 200);
    assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).deviceId, deviceId);
    const disconnected = await fetch(`http://127.0.0.1:${port}/api/auth`, { method: 'DELETE' });
    assert.equal(disconnected.status, 200);
    const credentials = JSON.parse(await readFile(authPath, 'utf8'));
    assert.equal(credentials.openai.key, 'test-key-not-real');
    assert.equal(credentials['openai-chatgpt'], undefined);
    const noOauth = await api('/api/chat', { sessionId: id, messages: [{ role: 'user', content: 'No API key fallback in OAuth mode' }] });
    assert.equal(noOauth.status, 400);
    assert.equal(noOauth.body.error, 'Connect OpenAI in settings first');
    const restored = await api(`/api/sessions/${id}`);
    assert.equal(restored.body.session.title, 'Remember this message');
    assert.deepEqual(restored.body.session.messages, [{ role: 'user', content: 'Remember this message' }, { role: 'user', content: 'No API key fallback in OAuth mode' }]);
    assert.equal((await api('/api/sessions')).body.sessions[0].id, id);
    assertProfile((await api(`/api/sessions/${id}`)).body.session.profile, { name: 'Tutor', specialty: 'Math', instructions: 'Show steps' });
    const other = await api('/api/sessions', {});
    assertProfile(other.body.session.profile, { name: 'Sunday', specialty: 'General assistance', instructions: 'Be helpful, clear, and thoughtful. Ask clarifying questions when needed.' });
    const changed = await api(`/api/sessions/${other.body.session.id}/profile`, { name: 'Coder', specialty: 'Backend', instructions: '' }, 'PATCH');
    assert.equal(changed.status, 200);
    assertProfile((await api(`/api/sessions/${id}`)).body.session.profile, { name: 'Tutor', specialty: 'Math', instructions: 'Show steps' });
    assert.equal((await api(`/api/sessions/${other.body.session.id}/profile`, { name: 'x'.repeat(81), specialty: '', instructions: '' }, 'PATCH')).status, 400);
    assertProfile((await api('/api/sessions')).body.sessions.find(session => session.id === other.body.session.id).profile, { name: 'Coder', specialty: 'Backend', instructions: '' });
  } finally {
    if (child && child.exitCode === null) await stop();
    await rm(home, { recursive: true, force: true });
  }
});

test('personas persist and copy into independent session profiles', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-personas-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [new URL('../server.js', import.meta.url).pathname, '--production'], { env: { ...process.env, HOME: home, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const api = async (path, data, method = 'GET') => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, data === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      return { status: response.status, body: await response.json() };
    };
    const list = await api('/api/personas');
    assert.equal(list.body.personas.length, 6);
    assert.equal((await stat(join(home, 'sunday', 'data', 'personas.json'))).mode & 0o777, 0o600);
    const created = await api('/api/personas', { name: 'Helper', specialty: 'Writing', instructions: 'Be precise.' }, 'POST');
    assert.equal(created.status, 201);
    const session = await api('/api/sessions', { personaId: created.body.persona.id }, 'POST');
    await api(`/api/personas/${created.body.persona.id}`, { name: 'Changed', specialty: 'Other', instructions: 'New.' }, 'PATCH');
    assertProfile((await api(`/api/sessions/${session.body.session.id}`)).body.session.profile, { name: 'Helper', specialty: 'Writing', instructions: 'Be precise.' });
    assert.equal((await api(`/api/personas/${created.body.persona.id}`)).status, 404);
    assert.equal((await api(`/api/personas/${created.body.persona.id}`, undefined, 'DELETE')).body.deleted, true);
    assert.equal((await api('/api/sessions', { personaId: 'missing' }, 'POST')).status, 400);
  } finally {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    await rm(home, { recursive: true, force: true });
  }
});
