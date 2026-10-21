import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../src/server/index.js', import.meta.url));

test('scheduled job API validates, manages, and persists jobs in SQLite', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-scheduled-jobs-api-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  await mkdir(join(home, 'sunday', 'workspace', 'repos', 'app'), { recursive: true });
  let child;

  async function start() {
    child = spawn(process.execPath, [serverPath, '--production'], {
      env: { ...process.env, HOME: home, PORT: String(port), OPENAI_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 10000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    });
  }

  async function stop() {
    if (child?.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }

  async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    });
    return { status: response.status, body: await response.json() };
  }

  try {
    await start();
    const personas = (await api('/api/personas')).body.personas;
    const payload = {
      name: 'Morning check', personaId: personas[0].id, task: 'Check recent changes',
      allowedRepositories: ['app'],
      schedule: { type: 'weekly', weekday: 1, time: '09:30', timezone: 'UTC' },
    };
    const created = await api('/api/scheduled-jobs', payload);
    assert.equal(created.status, 201);
    assert.match(created.body.job.id, /^[a-f0-9-]{36}$/);
    assert.equal(created.body.job.enabled, true);
    assert.equal((await api('/api/scheduled-jobs')).body.jobs[0].id, created.body.job.id);
    assert.deepEqual((await api(`/api/scheduled-jobs/${created.body.job.id}`)).body.job, created.body.job);

    const disabled = await api(`/api/scheduled-jobs/${created.body.job.id}`, { enabled: false }, 'PATCH');
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.job.enabled, false);
    assert.equal(disabled.body.job.createdAt, created.body.job.createdAt);
    assert.equal((await api(`/api/scheduled-jobs/${created.body.job.id}/runs`)).body.runs.length, 0);

    assert.equal((await api('/api/scheduled-jobs', { ...payload, personaId: 'missing' })).status, 400);
    assert.equal((await api('/api/scheduled-jobs', { ...payload, allowedRepositories: ['missing'] })).status, 400);
    const badSchedule = await api('/api/scheduled-jobs', { ...payload, schedule: { type: 'monthly', dayOfMonth: 32, time: '09:00', timezone: 'UTC' } });
    assert.equal(badSchedule.status, 400);

    const databasePath = join(home, 'sunday', 'data', 'scheduled-jobs.sqlite');
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
    await stop();
    await start();
    const persisted = await api('/api/scheduled-jobs');
    assert.deepEqual(persisted.body.jobs.map(job => job.id), [created.body.job.id]);
    assert.equal((await api(`/api/scheduled-jobs/${created.body.job.id}`, undefined, 'DELETE')).status, 200);
    assert.equal((await api(`/api/scheduled-jobs/${created.body.job.id}`)).status, 404);
  } finally {
    await stop();
    await rm(home, { recursive: true, force: true });
  }
});
