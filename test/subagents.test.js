import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { BIRD_NAMES, uniqueSessionName } from '../src/server/session-names.js';

function withSessionDatabase(home, callback) {
  const database = new DatabaseSync(join(home, 'sunday/data/sessions.sqlite'));
  try { return callback(database); }
  finally { database.close(); }
}

test('bird names avoid collisions and support exhaustion', () => {
  assert.equal(uniqueSessionName(BIRD_NAMES.slice(1), BIRD_NAMES), BIRD_NAMES[0]);
  assert.match(uniqueSessionName(BIRD_NAMES, BIRD_NAMES), / 2$/);
});

test('persistent subagents enforce ownership, permissions, nesting and the three-child limit', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-subagents-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['src/server/index.js', '--production'], { env: { ...process.env, HOME: home, PORT: String(port), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const api = async (path, data) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, ...await response.json() };
  };
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const parent = (await api('/sessions', {})).session;
    const other = (await api('/sessions', {})).session;
    const path = `/sessions/${parent.id}/subagents`;
    const results = await Promise.all([api(path, {}), api(path, {}), api(path, {}), api(path, {})]);
    // Concurrent API submissions may be rejected as busy; retry to fill all three slots.
    while ((await api(path)).result.length < 3) assert.equal((await api(path, {})).status, 201);
    assert.equal((await api(path, {})).status, 400);
    const children = (await api(path)).result;
    assert.equal(new Set(children.map(item => item.title)).size, 3);
    const first = (await api(`/sessions/${children[0].id}`)).session;
    assert.equal(first.parentSessionId, parent.id);
    assert.notEqual(first.workspaceName, parent.workspaceName);
    assert.deepEqual(first.config, parent.config);
    assert.equal((await api(`/sessions/${first.id}/subagents`, {})).status, 400);
    assert.equal((await api(`/sessions/${other.id}/subagents`, { sessionId: first.id, prompt: 'Work' })).status, 400);
    assert.equal((await api(path, { sessionId: first.id, prompt: '' })).status, 400);
    const denied = (await api('/sessions', { profile: { name: 'Restricted', specialty: '', instructions: '', allowedTools: [] } })).session;
    assert.equal((await api(`/sessions/${denied.id}/subagents`, {})).status, 400);
    const configure = async value => {
      const response = await fetch(`http://127.0.0.1:${port}/api/settings/subagents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      return { status: response.status, ...await response.json() };
    };
    assert.equal((await configure({ enabled: true, maxChildren: 4 })).status, 400);
    assert.equal((await configure({ enabled: false, maxChildren: 1 })).subagents.enabled, false);
    assert.equal((await api(`/sessions/${other.id}/subagents`, {})).status, 400);
    assert.equal((await api(path)).result.length, 3);
    assert.equal((await configure({ enabled: true, maxChildren: 1 })).subagents.maxChildren, 1);
    const created = await api(`/sessions/${other.id}/subagents`, {});
    assert.equal(created.status, 201);
    const otherChild = created.result;
    assert.ok(otherChild.id);
    assert.equal((await api(`/sessions/${other.id}/subagents`, {})).status, 400);
    const prompted = await api(`/sessions/${other.id}/subagents`, { sessionId: otherChild.id, prompt: 'Run synchronous prompt' });
    assert.equal(prompted.status, 400);
    const promptedChild = (await api(`/sessions/${otherChild.id}`)).session;
    assert.equal(promptedChild.messages.at(-1).content, 'Run synchronous prompt');
    const updatedParent = (await api(`/sessions/${other.id}`)).session;
    assert.equal(updatedParent.messages.some(message => message.role === 'subagent'), false);
    withSessionDatabase(home, database => {
      const row = database.prepare('SELECT data FROM sessions WHERE id = ?').get(first.id);
      const saved = JSON.parse(row.data);
      saved.pendingCompletion = { id: 'legacy-completion', content: 'Should not be delivered asynchronously.' };
      database.prepare('UPDATE sessions SET data = ? WHERE id = ?').run(JSON.stringify(saved), first.id);
    });
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal((await api(`/sessions/${parent.id}`)).session.messages.some(message => message.role === 'subagent'), false);
    assert.equal(withSessionDatabase(home, database => JSON.parse(database.prepare('SELECT data FROM sessions WHERE id = ?').get(first.id).data).pendingCompletion.id), 'legacy-completion');
    const deletion = await fetch(`http://127.0.0.1:${port}/api/sessions/${parent.id}`, { method: 'DELETE' });
    assert.equal(deletion.status, 200);
    const listed = (await api('/sessions')).sessions;
    for (const session of [parent, ...children]) assert.equal(listed.some(item => item.id === session.id), false);
    withSessionDatabase(home, database => {
      for (const session of [parent, ...children]) assert.equal(database.prepare('SELECT id FROM sessions WHERE id = ?').get(session.id), undefined);
    });
    assert.equal(listed.some(item => item.id === other.id), true);
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    await rm(home, { recursive: true, force: true });
  }
});
