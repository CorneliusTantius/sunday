import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverPath = fileURLToPath(new URL('../src/server/index.js', import.meta.url));

test('scheduled runs isolate sessions and finalize during graceful shutdown and crash recovery', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-scheduled-run-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const clockPath = join(home, 'clock'), requestsPath = join(home, 'provider-requests.jsonl'), hangPath = join(home, 'hang-provider');
  await writeFile(clockPath, String(Date.parse('2024-01-01T12:00:00Z')));
  for (const repo of ['allowed-repo', 'excluded-repo']) {
    const root = join(home, 'sunday', 'workspace', 'repos', repo);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'readme.md'), `${repo} contents`);
  }
  const preload = join(home, 'preload.mjs');
  await writeFile(preload, `
    import { appendFileSync, existsSync, readFileSync } from 'node:fs';
    const clockPath = ${JSON.stringify(clockPath)};
    const requestsPath = ${JSON.stringify(requestsPath)};
    const hangPath = ${JSON.stringify(hangPath)};
    const realDate = Date;
    const now = () => Number(readFileSync(clockPath, 'utf8'));
    globalThis.Date = class extends realDate {
      constructor(...args) { super(...(args.length ? args : [now()])); }
      static now() { return now(); }
    };
    const setInterval = globalThis.setInterval;
    globalThis.setInterval = (callback, delay, ...args) => setInterval(callback, delay === 1000 ? 20 : delay, ...args);
    const fetch = globalThis.fetch;
    globalThis.fetch = async (input, options = {}) => {
      const url = String(input);
      if (url.includes('api.openai.com')) {
        appendFileSync(requestsPath, JSON.stringify({ url, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body }) + '\\n');
        if (existsSync(hangPath)) return new Promise((resolve, reject) => {
          const signal = options.signal;
          const abort = () => reject(signal.reason || new DOMException('The operation was aborted', 'AbortError'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
        return new Response(JSON.stringify({ error: { message: 'Scheduled provider test failure', type: 'authentication_error' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      return fetch(input, options);
    };
  `);

  let child;
  async function start() {
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, serverPath, '--production'], {
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
      const current = child;
      const exited = once(current, 'exit');
      const timeout = setTimeout(() => current.kill('SIGKILL'), 5000);
      current.kill('SIGTERM');
      await exited;
      clearTimeout(timeout);
      child = null;
    }
  }
  async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    });
    return { status: response.status, body: await response.json() };
  }
  async function waitForRun(jobId, predicate) {
    const deadline = Date.now() + 10000;
    let runs;
    do {
      runs = (await api(`/api/scheduled-jobs/${jobId}/runs`)).body.runs;
      if (runs[0] && predicate(runs[0])) return runs[0];
      await new Promise(resolve => setTimeout(resolve, 30));
    } while (Date.now() < deadline);
    assert.fail(`Scheduled run did not reach expected state: ${JSON.stringify(runs)}`);
  }
  async function waitForProviderCalls(count) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (existsSync(requestsPath) && (await readFile(requestsPath, 'utf8')).trim().split('\n').length >= count) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.fail(`Provider did not receive ${count} requests`);
  }

  try {
    await start();
    await api('/api/settings', { provider: 'openai', mode: 'api_key', apiKey: 'scheduled-test-key' }, 'PUT');
    const settings = (await api('/api/settings')).body;
    const customModel = settings.connectedModels.find(model => model.provider === 'openai' && model.mode === 'api_key' && model.thinkingLevels.includes('high'))
      || settings.connectedModels.find(model => model.provider === 'openai' && model.mode === 'api_key');
    assert.ok(customModel, 'an OpenAI API-key model should be available');
    const thinkingLevel = customModel.thinkingLevels.includes('high') ? 'high' : undefined;
    const createdPersona = await api('/api/personas', {
      name: 'Repo-limited persona', specialty: 'Review', instructions: 'Review the allowed repository.', allowedTools: ['read', 'find'],
    });
    assert.equal(createdPersona.status, 201);
    const createdJob = await api('/api/scheduled-jobs', {
      name: 'Scheduled review', personaId: createdPersona.body.persona.id, task: 'Review the selected repository.',
      allowedRepositories: ['allowed-repo'],
      model: customModel.id, provider: customModel.provider, mode: customModel.mode,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      schedule: { type: 'daily', time: '12:01', timezone: 'UTC' },
    });
    assert.equal(createdJob.status, 201);

    await writeFile(clockPath, String(Date.parse('2024-01-01T12:01:00Z')));
    let runs;
    const deadline = Date.now() + 10000;
    do {
      runs = (await api(`/api/scheduled-jobs/${createdJob.body.job.id}/runs`)).body.runs;
      if (runs[0] && runs[0].status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 30));
    } while (Date.now() < deadline);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'failed');
    assert.match(runs[0].error, /Scheduled provider test failure/);
    assert.ok(runs[0].sessionId);

    const sessionResponse = await api(`/api/sessions/${runs[0].sessionId}`);
    assert.equal(sessionResponse.status, 200);
    const { session } = sessionResponse.body;
    assert.equal(session.profile.personaId, createdPersona.body.persona.id);
    assert.equal(session.profile.name, 'Repo-limited persona');
    assert.equal(session.messages[0].content, 'Review the selected repository.');
    assert.equal(session.config.model, customModel.id);
    assert.equal(session.config.provider, customModel.provider);
    assert.equal(session.config.mode, customModel.mode);
    if (thinkingLevel) assert.equal(session.config.thinkingLevel, thinkingLevel);
    assert.deepEqual(session.allowedRepositories, ['allowed-repo']);
    assert.deepEqual(await readdir(join(home, 'sunday', 'workspace-agents', session.workspaceName)), ['allowed-repo']);

    const requestText = (await readFile(requestsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).map(item => JSON.stringify(item.body)).join('\n');
    assert.match(requestText, /Repository tools available:.*read.*find/);
    assert.match(requestText, /Repository paths must begin with one of these names: allowed-repo/);
    assert.doesNotMatch(requestText, /excluded-repo/);

    await writeFile(hangPath, 'hang');
    const gracefulJob = await api('/api/scheduled-jobs', {
      name: 'Graceful shutdown job', personaId: createdPersona.body.persona.id, task: 'Wait for shutdown.',
      allowedRepositories: ['allowed-repo'], schedule: { type: 'daily', time: '12:02', timezone: 'UTC' },
    });
    await writeFile(clockPath, String(Date.parse('2024-01-01T12:02:00Z')));
    const gracefulRun = await waitForRun(gracefulJob.body.job.id, run => run.status === 'running' && Boolean(run.sessionId));
    await waitForProviderCalls(2);
    await stop();
    await start();
    const stoppedRun = (await api(`/api/scheduled-jobs/${gracefulJob.body.job.id}/runs`)).body.runs[0];
    assert.equal(stoppedRun.id, gracefulRun.id);
    assert.equal(stoppedRun.status, 'failed');
    assert.match(stoppedRun.error, /stopping|abort/i);
    assert.equal(stoppedRun.sessionId, gracefulRun.sessionId);

    const crashJob = await api('/api/scheduled-jobs', {
      name: 'Crash recovery job', personaId: createdPersona.body.persona.id, task: 'Wait for recovery.',
      allowedRepositories: ['allowed-repo'], schedule: { type: 'daily', time: '12:03', timezone: 'UTC' },
    });
    await writeFile(clockPath, String(Date.parse('2024-01-01T12:03:00Z')));
    const crashedRun = await waitForRun(crashJob.body.job.id, run => run.status === 'running' && Boolean(run.sessionId));
    await waitForProviderCalls(3);
    const killedChild = child;
    const killed = once(killedChild, 'exit');
    killedChild.kill('SIGKILL');
    await killed;
    child = null;
    await start();
    const recoveredRun = (await api(`/api/scheduled-jobs/${crashJob.body.job.id}/runs`)).body.runs[0];
    assert.equal(recoveredRun.id, crashedRun.id);
    assert.equal(recoveredRun.status, 'failed');
    assert.equal(recoveredRun.error, 'Sunday stopped before this run completed.');
    assert.equal(recoveredRun.sessionId, crashedRun.sessionId);
  } finally {
    await stop();
    await rm(home, { recursive: true, force: true });
  }
});
