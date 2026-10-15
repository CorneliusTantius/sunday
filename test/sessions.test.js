import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { GREEK_DEITY_NAMES } from '../src/server/session-names.js';
import { BASIC_TOOLS } from '../src/server/tools.js';

function assertProfile(actual, expected) {
  const { name, specialty, instructions } = actual;
  assert.deepEqual({ name, specialty, instructions }, expected);
  assert.ok(actual.color); assert.ok(actual.emoji); assert.ok(actual.personaId);
}

test('file references are restricted to permitted repository text and validated before saving', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-file-refs-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  let child;
  const start = async () => {
    child = spawn(process.execPath, [fileURLToPath(new URL('../src/server/index.js', import.meta.url)), '--production'], { env: { ...process.env, HOME: home, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
  };
  const api = async (path, data, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const repo = join(home, 'sunday', 'workspace', 'repos', 'private-repo');
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, 'notes.txt'), 'private reference text');
    await writeFile(join(repo, 'auth.json'), 'secret');
    await writeFile(join(repo, 'binary.txt'), Buffer.from([0, 1, 2]));
    await start();
    const session = (await api('/api/sessions', { profile: { name: 'Reader', specialty: '', instructions: '', allowedTools: ['read'] } })).body.session;
    const workspace = join(home, 'sunday', 'workspace-agents', session.workspaceName, 'private-repo');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'notes.txt'), 'private reference text');
    await writeFile(join(workspace, 'auth.json'), 'secret');
    await writeFile(join(workspace, 'binary.txt'), Buffer.from([0, 1, 2]));
    await writeFile(join(workspace, 'large.txt'), 'x'.repeat(50001));
    await writeFile(join(workspace, 'part-a.txt'), 'a'.repeat(40000));
    await writeFile(join(workspace, 'part-b.txt'), 'b'.repeat(40000));
    await (await import('node:fs/promises')).symlink('/etc/passwd', join(workspace, 'link'));
    const results = await api(`/api/sessions/${session.id}/files?q=notes`, undefined, 'GET');
    assert.deepEqual(results.body.files, ['private-repo/notes.txt']);
    const all = await api(`/api/sessions/${session.id}/files`, undefined, 'GET');
    assert.ok(!all.body.files.includes('private-repo/auth.json'));
    assert.ok(!all.body.files.includes('private-repo/link'));
    assert.ok(!all.body.files.includes('private-repo/large.txt'));
    assert.deepEqual((await api(`/api/sessions/${session.id}/files?q=private-repo/notes`, undefined, 'GET')).body.files, ['private-repo/notes.txt']);
    const good = await api('/api/chat', { sessionId: session.id, messages: [{ role: 'user', content: 'Use this' }], fileReferences: ['private-repo/notes.txt'] });
    assert.equal(good.status, 400); // Invalid/no-auth chat still saves only after references have validated.
    let saved = JSON.parse(await readFile(join(home, 'sunday', 'data', 'sessions', `${session.id}.json`), 'utf8'));
    assert.equal(saved.messages[0].fileReferences[0].content, 'private reference text');
    for (const references of [['private-repo/auth.json'], ['private-repo/link'], ['private-repo/missing'], ['private-repo/binary.txt'], ['private-repo/large.txt'], ['private-repo/part-a.txt', 'private-repo/part-b.txt'], ['private-repo/../notes.txt'], Array(6).fill('private-repo/notes.txt')]) {
      const before = saved.messages.length;
      assert.ok((await api('/api/chat', { sessionId: session.id, messages: [{ role: 'user', content: 'reject me' }], fileReferences: references })).status >= 400);
      saved = JSON.parse(await readFile(join(home, 'sunday', 'data', 'sessions', `${session.id}.json`), 'utf8'));
      assert.equal(saved.messages.length, before, `invalid references were saved: ${references.join(', ')}`);
    }
    assert.equal((await api('/api/sessions', {}, 'POST')).status, 201);
    const denied = (await api('/api/sessions', {})).body.session;
    await api(`/api/sessions/${denied.id}`, { allowedRepositories: [] }, 'PATCH');
    assert.deepEqual((await api(`/api/sessions/${denied.id}/files`, undefined, 'GET')).body.files, []);
    const rejected = await api('/api/chat', { sessionId: denied.id, messages: [{ role: 'user', content: 'denied' }], fileReferences: ['private-repo/notes.txt'] });
    assert.ok(rejected.status >= 400);
    assert.match(rejected.body.error, /No repositories are allowed/i);
    await api(`/api/sessions/${session.id}/profile`, { name: 'No reader', specialty: '', instructions: '', allowedTools: [] }, 'PATCH');
    assert.match((await api('/api/chat', { sessionId: session.id, messages: [{ role: 'user', content: 'disabled' }], fileReferences: ['private-repo/notes.txt'] })).body.error, /not allowed/i);
    assert.equal((await api(`/api/sessions/${session.id}/files`, undefined, 'GET')).status, 400);
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    await rm(home, { recursive: true, force: true });
  }
});

 test('sessions persist across restarts and workspace defaults to ~/sunday/workspace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-test-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  let child;
  async function start() {
    child = spawn(process.execPath, [fileURLToPath(new URL('../src/server/index.js', import.meta.url)), '--production'], { env: { ...process.env, HOME: home, PORT: String(port), OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const sourceRepo = join(home, 'sunday', 'workspace', 'repos', 'demo-repo');
    await mkdir(sourceRepo, { recursive: true });
    await writeFile(join(sourceRepo, 'readme.txt'), 'source version');
    const created = await api('/api/sessions', { profile: { name: 'Tutor', specialty: 'Math', instructions: 'Show steps' } });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.session.allowedRepositories, ['demo-repo']);
    assert.equal(created.body.session.workspaceName, created.body.session.title);
    const agentWorkspace = join(home, 'sunday', 'workspace-agents', created.body.session.workspaceName);
    assert.equal(await readFile(join(agentWorkspace, 'demo-repo', 'readme.txt'), 'utf8'), 'source version');
    await writeFile(join(agentWorkspace, 'demo-repo', 'readme.txt'), 'agent version');
    assert.equal(await readFile(join(sourceRepo, 'readme.txt'), 'utf8'), 'source version');
    assert.equal((await api(`/api/sessions/${created.body.session.id}`, { allowedRepositories: [] }, 'PATCH')).status, 200);
    await assert.rejects(stat(join(agentWorkspace, 'demo-repo')), { code: 'ENOENT' });
    assert.equal((await api(`/api/sessions/${created.body.session.id}`, { allowedRepositories: ['demo-repo'] }, 'PATCH')).status, 200);
    assert.equal(await readFile(join(agentWorkspace, 'demo-repo', 'readme.txt'), 'utf8'), 'source version');
    assertProfile(created.body.session.profile, { name: 'Tutor', specialty: 'Math', instructions: 'Show steps' });
    assert.equal((await api('/api/sessions', { profile: { name: '', specialty: '', instructions: '' } })).status, 400);
    const id = created.body.session.id;
    const generatedTitle = created.body.session.title;
    assert.ok(GREEK_DEITY_NAMES.includes(generatedTitle));
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => api('/api/sessions', {})));
    assert.equal(new Set(concurrent.map(result => result.body.session.workspaceName)).size, concurrent.length);
    assert.equal(await readFile(join(home, 'sunday', 'workspace-agents', concurrent[0].body.session.workspaceName, 'demo-repo', 'readme.txt'), 'utf8'), 'source version');
    const titles = [generatedTitle, ...concurrent.map(result => result.body.session.title)];
    assert.equal(new Set(titles).size, titles.length);
    const custom = await api('/api/sessions', { title: ' My custom title ' });
    assert.equal(custom.body.session.title, 'My custom title');
    assert.equal(custom.body.session.workspaceName, 'My-custom-title');
    const renamed = await api(`/api/sessions/${custom.body.session.id}`, { title: 'Renamed Agent' }, 'PATCH');
    assert.equal(renamed.body.session.workspaceName, 'Renamed-Agent');
    await assert.rejects(stat(join(home, 'sunday', 'workspace-agents', 'My-custom-title')), { code: 'ENOENT' });
    assert.ok((await stat(join(home, 'sunday', 'workspace-agents', 'Renamed-Agent'))).isDirectory());
    assert.equal((await api('/api/sessions', { title: '' })).status, 400);
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
    const configured = await api(`/api/sessions/${id}`, { config: { mode: 'oauth', model: oauth.body.model } }, 'PATCH');
    assert.equal(configured.status, 200);
    const disconnected = await fetch(`http://127.0.0.1:${port}/api/auth`, { method: 'DELETE' });
    assert.equal(disconnected.status, 200);
    const credentials = JSON.parse(await readFile(authPath, 'utf8'));
    assert.equal(credentials.openai.key, 'test-key-not-real');
    assert.equal(credentials['openai-chatgpt'], undefined);
    const noOauth = await api('/api/chat', { sessionId: id, messages: [{ role: 'user', content: 'No API key fallback in OAuth mode' }] });
    assert.equal(noOauth.status, 400);
    assert.equal(noOauth.body.error, 'Connect OpenAI in settings first');
    const restored = await api(`/api/sessions/${id}`);
    assert.equal(restored.body.session.title, generatedTitle);
    assert.equal((await api(`/api/sessions/${custom.body.session.id}`)).body.session.title, 'Renamed Agent');
    assert.deepEqual(restored.body.session.messages, [{ role: 'user', content: 'Remember this message' }, { role: 'user', content: 'No API key fallback in OAuth mode' }]);
    assert.equal((await api('/api/sessions')).body.sessions[0].id, id);
    assertProfile((await api(`/api/sessions/${id}`)).body.session.profile, { name: 'Tutor', specialty: 'Math', instructions: 'Show steps' });
    const other = await api('/api/sessions', {});
    assert.ok(!titles.includes(other.body.session.title));
    assertProfile(other.body.session.profile, { name: 'Sunday', specialty: 'General assistance', instructions: `- Answer directly with structure and detail suited to the user’s goal.
- Be accurate; distinguish facts from assumptions and state uncertainty.
- Ask clarifying questions only when needed.
- Carry tasks through to a useful result and include important next steps.
- Speak as an elegant English royal butler: polished, gracious, discreet, and refined. Naturally address the user as “Your Highness.” Keep explanations clear and practical rather than overly ornate.
- Explain technical topics clearly, at a level a junior engineer can understand.` });
    const changed = await api(`/api/sessions/${other.body.session.id}/profile`, { name: 'Coder', specialty: 'Backend', instructions: '' }, 'PATCH');
    assert.equal(changed.status, 200);
    assertProfile((await api(`/api/sessions/${id}`)).body.session.profile, { name: 'Tutor', specialty: 'Math', instructions: 'Show steps' });
    assert.equal((await api(`/api/sessions/${other.body.session.id}/profile`, { name: 'x'.repeat(81), specialty: '', instructions: '' }, 'PATCH')).status, 400);
    assertProfile((await api('/api/sessions')).body.sessions.find(session => session.id === other.body.session.id).profile, { name: 'Coder', specialty: 'Backend', instructions: '' });
    const customWorkspace = join(home, 'sunday', 'workspace-agents', renamed.body.session.workspaceName);
    assert.equal((await api(`/api/sessions/${custom.body.session.id}`, {}, 'DELETE')).status, 200);
    await assert.rejects(stat(customWorkspace), { code: 'ENOENT' });
  } finally {
    if (child && child.exitCode === null) await stop();
    await rm(home, { recursive: true, force: true });
  }
});

test('personas persist and copy into independent session profiles', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-personas-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server/index.js', import.meta.url)), '--production'], { env: { ...process.env, HOME: home, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const api = async (path, data, method = 'GET') => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, data === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      return { status: response.status, body: await response.json() };
    };
    const list = await api('/api/personas');
    const requestWithHeaders = (headers) => new Promise((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port, path: '/api/personas', headers }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.end();
    });
    assert.equal(await requestWithHeaders({ host: 'app.tailnet.ts.net', origin: 'https://app.tailnet.ts.net' }), 200);
    assert.equal(await requestWithHeaders({ host: 'attacker.example.com', origin: 'https://attacker.example.com' }), 403);
    assert.deepEqual(list.body.tools, BASIC_TOOLS.map(({ name, description }) => ({ name, description })));
    assert.equal(list.body.personas.length, 4);
    assert.ok(list.body.personas.every(persona => !['talent-scout', 'sales-outbound'].includes(persona.id)));
    assert.equal((await stat(join(home, 'sunday', 'data', 'personas.json'))).mode & 0o777, 0o600);
    const created = await api('/api/personas', { name: 'Helper', specialty: 'Writing', instructions: 'Be precise.' }, 'POST');
    assert.equal(created.status, 201);
    const permitted = ['memory_search', 'memory_update', 'agent_whisper'];
    assert.equal((await api(`/api/personas/${created.body.persona.id}`, { ...created.body.persona, allowedTools: permitted }, 'PATCH')).status, 200);
    const session = await api('/api/sessions', { personaId: created.body.persona.id }, 'POST');
    assert.deepEqual(session.body.session.profile.allowedTools, permitted);
    assert.equal((await api(`/api/personas/${created.body.persona.id}`, { ...created.body.persona, allowedTools: ['unregistered'] }, 'PATCH')).status, 400);
    assert.equal((await api(`/api/personas/${created.body.persona.id}`, { ...created.body.persona, allowedTools: [] }, 'PATCH')).status, 200);
    assert.deepEqual((await api('/api/personas')).body.personas.find(persona => persona.id === created.body.persona.id).allowedTools, []);
    assert.deepEqual((await api(`/api/sessions/${session.body.session.id}`)).body.session.profile.allowedTools, permitted);
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
