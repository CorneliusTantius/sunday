import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { GREEK_DEITY_NAMES } from '../src/server/session-names.js';
import { BASIC_TOOLS } from '../src/server/tools.js';

function assertProfile(actual, expected) {
  const { name, specialty, instructions } = actual;
  assert.deepEqual({ name, specialty, instructions }, expected);
  assert.ok(actual.color); assert.ok(actual.emoji); assert.ok(actual.personaId);
}

function readStoredSession(home, id) {
  const database = new DatabaseSync(join(home, 'sunday', 'data', 'sessions.sqlite'));
  try {
    const row = database.prepare('SELECT data FROM sessions WHERE id = ?').get(id);
    assert.ok(row, `session ${id} should be stored`);
    return JSON.parse(row.data);
  } finally { database.close(); }
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
    let saved = readStoredSession(home, session.id);
    assert.equal(saved.messages[0].fileReferences[0].content, 'private reference text');
    for (const references of [['private-repo/auth.json'], ['private-repo/link'], ['private-repo/missing'], ['private-repo/binary.txt'], ['private-repo/large.txt'], ['private-repo/part-a.txt', 'private-repo/part-b.txt'], ['private-repo/../notes.txt'], Array(6).fill('private-repo/notes.txt')]) {
      const before = saved.messages.length;
      assert.ok((await api('/api/chat', { sessionId: session.id, messages: [{ role: 'user', content: 'reject me' }], fileReferences: references })).status >= 400);
      saved = readStoredSession(home, session.id);
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
    const options = data === undefined ? { method: method === 'POST' ? 'GET' : method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
    return { status: response.status, body: await response.json() };
  }
  try {
    await start();
    const settings = await api('/api/settings');
    assert.equal(settings.body.workspaceDir, join(home, 'sunday', 'workspace'));
    assert.ok((await stat(settings.body.workspaceDir)).isDirectory());
    const memoryDir = join(settings.body.workspaceDir, 'shared-memory');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'architecture.md'), '# Architecture\n\nLegacy Markdown is not imported.');
    assert.deepEqual((await api('/api/context/sources')).body.sources, []);
    const indexed = await api('/api/context/sources', { source: 'docs/deployment.md', title: 'Deployment', content: 'Roll back through the previous release.' });
    assert.equal(indexed.status, 200);
    assert.equal(indexed.body.result.indexed, true);
    const sources = await api('/api/context/sources');
    assert.deepEqual(sources.body.sources.map(item => item.title), ['Deployment']);
    assert.match((await api('/api/context/search?q=rollback+release')).body.results[0].excerpt, /previous \[release\]/);
    const sourceId = sources.body.sources[0].id;
    assert.equal((await api(`/api/context/sources/${sourceId}`)).body.source.content, 'Roll back through the previous release.');
    await api('/api/context/sources', { source: 'docs/architecture.md', title: 'Architecture', content: 'Services communicate through events.' });
    assert.equal((await api('/api/context/links?source=docs/deployment.md', undefined, 'GET')).status, 200);
    assert.deepEqual((await api('/api/context/links?source=docs/deployment.md', undefined, 'GET')).body, { source: 'docs/deployment.md', nodes: [], links: [] });
    const linked = await api('/api/context/links', { source: 'docs/deployment.md', target: 'docs/architecture.md', relation: 'documents' });
    assert.equal(linked.status, 200);
    const architectureId = (await api('/api/context/sources')).body.sources.find(item => item.source === 'docs/architecture.md').id;
    assert.deepEqual((await api('/api/context/graph', undefined, 'GET')).body, {
      nodes: [
        { id: architectureId, source: 'docs/architecture.md', title: 'Architecture' },
        { id: sourceId, source: 'docs/deployment.md', title: 'Deployment' },
      ],
      links: [{ source: 'docs/deployment.md', target: 'docs/architecture.md', relation: 'documents' }],
    });
    assert.deepEqual(linked.body, {
      source: 'docs/deployment.md',
      nodes: [{ source: 'docs/architecture.md', title: 'Architecture' }],
      links: [{ source: 'docs/deployment.md', target: 'docs/architecture.md', relation: 'documents' }],
    });
    assert.deepEqual((await api('/api/context/links?source=docs/architecture.md', undefined, 'GET')).body, {
      source: 'docs/architecture.md',
      nodes: [{ source: 'docs/deployment.md', title: 'Deployment' }],
      links: [{ source: 'docs/deployment.md', target: 'docs/architecture.md', relation: 'documents' }],
    });
    assert.equal((await api('/api/context/links', { source: 'docs/deployment.md', target: 'missing.md' })).status, 404);
    assert.equal((await api('/api/context/links', { source: 'docs/deployment.md', target: 'docs/deployment.md' })).status, 400);
    assert.equal((await api('/api/context/links', { source: 'docs/deployment.md', target: 'docs/architecture.md' }, 'DELETE')).body.links.length, 0);
    assert.equal((await api(`/api/context/sources/${sourceId}`, undefined, 'DELETE')).body.deleted, true);
    assert.equal((await api(`/api/context/sources/${architectureId}`, undefined, 'DELETE')).body.deleted, true);
    assert.deepEqual((await api('/api/context/sources')).body.sources, []);
    assert.equal((await api('/api/context/sources', { source: '', title: '', content: '' })).status, 400);
    assert.equal((await api('/api/context/sources', null)).status, 400);
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
    const dataDirectory = join(home, 'sunday', 'data');
    const databasePath = join(dataDirectory, 'sessions.sqlite');
    const contextDatabasePath = join(dataDirectory, 'context.sqlite');
    assert.equal((await stat(dataDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
    assert.equal((await stat(contextDatabasePath)).mode & 0o777, 0o600);
    assert.equal(readStoredSession(home, id).messages[0].content, 'Remember this message');
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
    assertProfile(other.body.session.profile, { name: 'Sunday', specialty: 'General assistance', instructions: `- Own the user’s goal from clarification through a verified outcome; keep scope and success criteria explicit.
- Give a useful direct answer, distinguish facts from assumptions, and ask questions only when a missing detail blocks safe or correct progress.
- Delegate substantial independent work as bounded concurrent tasks when useful; keep dependent work ordered and small tasks direct.
- Track children, synthesize their evidence, verify the result against the goal, and finish with relevant next steps and any blockers or uncertainty. Never claim completion from delegation alone.
- Explain technical topics in clear, plain language a junior engineer can follow. Briefly define unfamiliar terms, explain why key steps matter, and avoid unexplained jargon.` });
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
    assert.deepEqual(list.body.personas.map(persona => persona.id), ['sunday', 'coding-agent']);
    assert.ok(list.body.personas.every(persona => !['talent-scout', 'sales-outbound', 'inbox-manager', 'expense-manager'].includes(persona.id)));
    assert.ok(list.body.personas.every(persona => !persona.instructions.includes('medieval-peasant')));
    const generatedPersonas = JSON.parse(await readFile(join(home, 'sunday', 'data', 'personas.json'), 'utf8'));
    assert.equal(generatedPersonas.find(persona => persona.id === 'sunday').name, 'Sunday');
    assert.ok(generatedPersonas.every(persona => !persona.instructions.includes('medieval-peasant')));
    assert.equal((await stat(join(home, 'sunday', 'data', 'personas.json'))).mode & 0o777, 0o600);
    const created = await api('/api/personas', { name: 'Helper', specialty: 'Writing', instructions: 'Be precise.' }, 'POST');
    assert.equal(created.status, 201);
    const permitted = ['context_search', 'context_index', 'agent_whisper'];
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

test('startup migrates only untouched built-in persona instructions and preserves custom edits', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-persona-instructions-'));
  const dataDir = join(home, 'sunday', 'data');
  const personasPath = join(dataDir, 'personas.json');
  const port = 32000 + Math.floor(Math.random() * 20000);
  const previousSunday = `- Answer directly with structure and detail suited to the user’s goal.\n- Be accurate; distinguish facts from assumptions and state uncertainty.\n- Ask clarifying questions only when needed.\n- Carry tasks through to a useful result and include important next steps.\n- Explain technical topics clearly, at a level a junior engineer can understand.`;
  const previousCoder = `- Inspect relevant files and follow existing conventions before changing code.\n- Make the smallest correct change that fixes the root cause.\n- Consider validation, security, and edge cases.\n- Run appropriate tests when possible.\n- Explain key trade-offs, report checks not run, and state uncertainty rather than inventing behavior.\n- Explain technical topics clearly, at a level a junior engineer can understand.`;
  const deployedSunday = `- Own the user’s goal from clarification through a verified outcome; keep scope and success criteria explicit.\n- Delegate substantial independent work as bounded concurrent tasks when useful; keep dependent work ordered and small tasks direct.\n- Track children, synthesize their evidence, verify the result against the goal, and surface blockers or uncertainty.\n- Explain technical topics clearly, at a level a junior engineer can understand.`;
  const deployedCoder = `- Inspect relevant source, tests, and project guidance; trace the root cause before editing.\n- Make the smallest complete change that follows existing patterns while preserving correctness, security, validation, and accessibility.\n- Add focused regression coverage and run suitable checks; review the resulting changes.\n- Report only verified results, including checks not run or blockers.\n- Explain technical topics clearly, at a level a junior engineer can understand.`;
  await mkdir(dataDir, { recursive: true });
  await writeFile(personasPath, JSON.stringify([
    { id: 'sunday', name: 'Sunday', specialty: 'General assistance', instructions: previousSunday },
    { id: 'coding-agent', name: 'Coding Agent', specialty: 'Software development', instructions: previousCoder },
    { id: 'deployed-sunday', personaId: 'sunday', name: 'Sunday', specialty: 'General assistance', instructions: deployedSunday },
    { id: 'deployed-coder', personaId: 'coding-agent', name: 'Coding Agent', specialty: 'Software development', instructions: deployedCoder },
    { id: 'custom-sunday', name: 'Sunday', specialty: 'Custom', instructions: 'Keep my customized instructions.' },
    { id: 'custom-coder', name: 'Coding Agent', specialty: 'Custom', instructions: 'Keep my other customized instructions.' },
    { id: 'customized-builtin', name: 'Custom Sunday', specialty: 'General assistance', instructions: 'User-edited built-in instructions.' },
  ]));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server/index.js', import.meta.url)), '--production'], { env: { ...process.env, HOME: home, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const saved = JSON.parse(await readFile(personasPath, 'utf8'));
    assert.ok(saved.find(persona => persona.id === 'sunday').instructions.includes('Own the user’s goal'));
    assert.ok(saved.find(persona => persona.id === 'coding-agent').instructions.includes('trace the root cause'));
    const juniorExplanation = 'Explain technical topics in clear, plain language a junior engineer can follow.';
    assert.ok(saved.find(persona => persona.id === 'deployed-sunday').instructions.includes(juniorExplanation));
    assert.ok(saved.find(persona => persona.id === 'deployed-coder').instructions.includes(juniorExplanation));
    assert.equal(saved.find(persona => persona.id === 'custom-sunday').instructions, 'Keep my customized instructions.');
    assert.equal(saved.find(persona => persona.id === 'custom-coder').instructions, 'Keep my other customized instructions.');
    assert.equal(saved.find(persona => persona.id === 'customized-builtin').instructions, 'User-edited built-in instructions.');
  } finally {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    await rm(home, { recursive: true, force: true });
  }
});

test('startup removes Inbox Manager and Expense Manager from saved persona defaults', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-persona-migration-'));
  const dataDir = join(home, 'sunday', 'data');
  const personasPath = join(dataDir, 'personas.json');
  const port = 32000 + Math.floor(Math.random() * 20000);
  await mkdir(dataDir, { recursive: true });
  await writeFile(personasPath, JSON.stringify([
    { id: 'inbox-manager', name: 'Inbox Manager', specialty: 'Email organization', instructions: 'Old default.' },
    { id: 'expense-manager', name: 'Expense Manager', specialty: 'Expense organization', instructions: 'Old default.' },
    { id: 'custom', name: 'Custom', specialty: 'Writing', instructions: 'Keep this persona.' },
  ]));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server/index.js', import.meta.url)), '--production'], { env: { ...process.env, HOME: home, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const response = await fetch(`http://127.0.0.1:${port}/api/personas`);
    const { personas } = await response.json();
    assert.deepEqual(personas.map(persona => persona.id), ['custom']);
    const saved = JSON.parse(await readFile(personasPath, 'utf8'));
    assert.deepEqual(saved.map(persona => persona.id), ['custom']);
  } finally {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    await rm(home, { recursive: true, force: true });
  }
});
