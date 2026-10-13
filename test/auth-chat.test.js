import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request } from 'node:http';

test('OAuth resumes, cancels, restarts and times out; chat dispatches to the selected provider', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-auth-chat-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const preload = join(home, 'preload.mjs'), requests = join(home, 'requests.jsonl'), delayChat = join(home, 'delay-chat');
  // Run the installed SDK's real OAuth flow without occupying its fixed port
  // or making upstream requests. Shorten only the app's five-minute timer.
  await writeFile(preload, `
    import http from 'node:http';
    import { syncBuiltinESMExports } from 'node:module';
    import { appendFileSync, existsSync } from 'node:fs';
    const createServer = http.createServer;
    let callbackServer;
    http.createServer = (...args) => {
      const server = createServer(...args), listen = server.listen;
      server.listen = function(port, ...args) {
        if (port === 1455) {
          if (callbackServer) { queueMicrotask(() => server.emit('error', Object.assign(new Error('Port in use'), { code: 'EADDRINUSE' }))); return server; }
          callbackServer = server;
          server.once('close', () => { if (callbackServer === server) callbackServer = undefined; });
          port = 0;
        }
        return listen.call(this, port, ...args);
      };
      return server;
    };
    syncBuiltinESMExports();
    const setTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => setTimeout(fn, ms === 300000 ? Number(process.env.OAUTH_TEST_TIMEOUT_MS) : ms, ...args);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => { await new Promise(resolve => setTimeout(resolve, 50)); return digest(...args); };
    globalThis.fetch = async (url, options) => {
      const entry = { url: String(url), headers: Object.fromEntries(new Headers(options?.headers)) };
      if (existsSync(${JSON.stringify(delayChat)}) && entry.url.includes('api.openai.com/v1/responses')) {
        appendFileSync(${JSON.stringify(requests)}, JSON.stringify({ ...entry, phase: 'started' }) + '\\n');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      appendFileSync(${JSON.stringify(requests)}, JSON.stringify({ ...entry, phase: 'finished', signalAborted: options?.signal?.aborted ?? false }) + '\\n');
      return new Response(JSON.stringify({ error: { message: 'Offline provider test', type: 'authentication_error' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    };
  `);
  let child, staleRequest;
  async function start(timeout = 10000) {
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, fileURLToPath(new URL('../src/server/index.js', import.meta.url)), '--production'], {
      env: { ...process.env, HOME: home, PORT: String(port), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', OAUTH_TEST_TIMEOUT_MS: String(timeout) },
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
  async function stop() { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  async function api(path, data, method = 'POST') {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: data === undefined ? method === 'DELETE' ? 'DELETE' : 'GET' : method, ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
  }
  function startChatRequest(sessionId) {
    const payload = JSON.stringify({ sessionId, messages: [{ role: 'user', content: 'Continue after disconnect' }] });
    let response;
    const client = request({ hostname: '127.0.0.1', port, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, incoming => {
      response = incoming;
      incoming.on('error', () => {});
    });
    client.on('error', () => {});
    client.end(payload);
    return { disconnect() { response?.destroy(); client.destroy(); } };
  }
  async function waitFor(predicate) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const status = (await api('/api/auth/status')).body;
      if (predicate(status)) return status;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('OAuth state did not settle');
  }
  try {
    await start();
    assert.deepEqual((await api('/api/health')).body, { status: 'ok' });
    const initial = await api('/api/settings');
    assert.deepEqual(initial.body.providers.map(p => [p.id, p.modes]), [
      ['openai', ['api_key', 'oauth']], ['anthropic', ['api_key']], ['google', ['api_key']],
    ]);
    for (const path of ['/api/settings?provider=unknown', '/api/settings?mode=unknown', '/api/settings?provider=google&mode=oauth']) assert.equal((await api(path)).status, 400);
    assert.equal((await api('/api/auth/start', { provider: 'google' })).status, 400);
    const starts = await Promise.all([api('/api/auth/start', {}), api('/api/auth/start', {})]);
    assert.ok(starts.every(result => result.status === 200 && result.body.status === 'pending'));
    assert.equal(starts[0].body.startedAt, starts[1].body.startedAt);
    const pending = await waitFor(status => status.prompt && status.events.some(event => event.url));
    assert.equal(pending.provider, 'openai');
    assert.equal(pending.expiresAt - pending.startedAt, 300000);
    assert.equal(pending.prompt.type, 'manual_code');
    assert.match(pending.events.find(event => event.url).url, /^https:\/\/auth\.openai\.com\//);
    const resumed = await api('/api/auth/start', {});
    assert.deepEqual(resumed.body.events, pending.events);
    assert.deepEqual(resumed.body.prompt, pending.prompt);
    // Bind code submissions to the attempt that accepted the request, not
    // whichever attempt exists after a slow request body finishes arriving.
    const state = new URL(pending.events.find(event => event.url).url).searchParams.get('state');
    const staleBody = JSON.stringify({ code: `http://127.0.0.1:1455/auth/callback?code=old&client_id=test&state=${state}` });
    const staleResponse = new Promise((resolve, reject) => {
      staleRequest = request(`http://127.0.0.1:${port}/api/auth/code`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(staleBody) } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
      staleRequest.once('error', reject);
      staleRequest.write(staleBody.slice(0, 1));
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const cancelled = await api('/api/auth/cancel', {});
    assert.equal(cancelled.body.status, 'error');
    assert.equal(cancelled.body.error, 'Sign-in cancelled');
    assert.equal(cancelled.body.prompt, undefined);
    assert.equal((await api('/api/auth/code', { code: 'late-code' })).status, 400);
    assert.equal((await api('/api/auth/cancel', {})).status, 200);
    await api('/api/auth/start', {});
    await waitFor(status => status.prompt);
    staleRequest.end(staleBody.slice(1));
    assert.equal(await staleResponse, 400);
    assert.equal((await api('/api/auth/status')).body.status, 'pending');
    // Invalid manual input terminates the attempt rather than leaving it stuck.
    assert.equal((await api('/api/auth/code', { code: 'not-a-callback-url' })).status, 200);
    const failed = await waitFor(status => status.status === 'error');
    assert.match(failed.error, /Paste the full callback URL/);
    await api('/api/auth/start', {});
    await waitFor(status => status.prompt);
    assert.equal((await api('/api/auth', undefined, 'DELETE')).status, 200);
    assert.equal((await api('/api/auth/status')).body.status, 'idle');
    // Cancellation before PKCE/callback setup finishes must await SDK cleanup.
    await api('/api/auth/start', {});
    await api('/api/auth/cancel', {});
    await api('/api/auth/start', {});
    await waitFor(status => status.prompt);
    await api('/api/auth/cancel', {});

    const created = await api('/api/sessions', {});
    for (const [provider, host, keyHeader] of [
      ['openai', 'api.openai.com', 'authorization'],
      ['anthropic', 'api.anthropic.com', 'x-api-key'],
      ['google', 'generativelanguage.googleapis.com', 'x-goog-api-key'],
    ]) {
      const saved = await api('/api/settings', { provider, mode: 'api_key', apiKey: `offline-${provider}` }, 'PUT');
      assert.equal(saved.status, 200);
      assert.equal(saved.body.selectedProvider, provider);
      assert.ok(saved.body.models.length);
      assert.equal((await api('/api/settings', { provider, thinkingLevel: 'invalid' }, 'PUT')).status, 400);
      const preview = (await api('/api/settings?provider=openai&mode=oauth')).body;
      assert.equal(preview.selectedProvider, provider);
      assert.deepEqual(preview.models, []);
      assert.equal((await api('/api/settings')).body.provider, provider);
      const chat = await api('/api/chat', { sessionId: created.body.session.id, messages: [{ role: 'user', content: `Hello ${provider}` }] });
      assert.equal(chat.status, 200);
      assert.match(chat.body, /"type":"error"/);
      const sent = (await readFile(requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const last = sent.at(-1);
      assert.equal(new URL(last.url).hostname, host);
      assert.ok(last.headers[keyHeader]?.includes(`offline-${provider}`));
    }
    await api('/api/settings', { provider: 'openai', mode: 'api_key', apiKey: 'offline-openai' }, 'PUT');
    const backgroundSession = await api('/api/sessions', {});
    const previousCount = (await readFile(requests, 'utf8')).trim().split('\n').length;
    await writeFile(delayChat, '');
    const chatRequest = startChatRequest(backgroundSession.body.session.id);
    const waitForPhase = async (phase, startCount = previousCount) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const entries = (await readFile(requests, 'utf8')).trim().split('\n').slice(startCount).map(line => JSON.parse(line));
        const found = entries.find(entry => entry.phase === phase && entry.url.includes('api.openai.com/v1/responses'));
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return null;
    };
    try {
      const startedRequest = await waitForPhase('started');
      assert.ok(startedRequest, 'chat should reach the provider before disconnecting');
      const runningSession = await api(`/api/sessions/${backgroundSession.body.session.id}`);
      assert.equal(runningSession.body.session.running, true, 'session status should remain readable while its agent runs');
      const resumedResponse = await fetch(`http://127.0.0.1:${port}/api/chat/stream?sessionId=${backgroundSession.body.session.id}`);
      const resumedReader = resumedResponse.body.getReader();
      const resumedChunk = await resumedReader.read();
      const resumedEvent = JSON.parse(new TextDecoder().decode(resumedChunk.value).split('data: ')[1].trim());
      assert.equal(resumedEvent.type, 'snapshot', 'active chat can be reattached and replayed');
      assert.equal(resumedEvent.answer, '');
      await resumedReader.cancel();
      chatRequest.disconnect();
      const completedRequest = await waitForPhase('finished');
      assert.ok(completedRequest, 'server should finish the provider request after the client disconnects');
      assert.equal(completedRequest.signalAborted, false);
    } finally { chatRequest.disconnect(); }
    const completedSession = await api(`/api/sessions/${backgroundSession.body.session.id}`);
    assert.ok(completedSession.body.session.messages.some(message => message.role === 'user' && message.content === 'Continue after disconnect'));
    assert.equal(completedSession.body.session.running, false);

    const cancelSession = await api('/api/sessions', {});
    const cancelPreviousCount = (await readFile(requests, 'utf8')).trim().split('\n').length;
    const cancelRequest = startChatRequest(cancelSession.body.session.id);
    try {
      assert.ok(await waitForPhase('started', cancelPreviousCount));
      const cancelled = await api('/api/chat/cancel', { sessionId: cancelSession.body.session.id });
      assert.deepEqual(cancelled.body, { cancelled: true });
      let cancelledProviderRequest;
      const cancelDeadline = Date.now() + 5000;
      while (Date.now() < cancelDeadline && !cancelledProviderRequest) {
        const entries = (await readFile(requests, 'utf8')).trim().split('\n').slice(cancelPreviousCount).map(line => JSON.parse(line));
        cancelledProviderRequest = entries.find(entry => entry.phase === 'finished' && entry.url.includes('api.openai.com/v1/responses'));
        if (!cancelledProviderRequest) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(cancelledProviderRequest);
      assert.equal(cancelledProviderRequest.signalAborted, true);
    } finally { cancelRequest.disconnect(); }
    await rm(delayChat, { force: true });

    const authPath = join(home, 'sunday', 'data', 'auth.json');
    assert.equal((await stat(authPath)).mode & 0o777, 0o600);
    const authBefore = await readFile(authPath, 'utf8');
    const started = await api('/api/auth/start', {});
    assert.equal(started.body.provider, 'openai'); // Independent of selected Google.
    await api('/api/auth/cancel', {});
    assert.equal(await readFile(authPath, 'utf8'), authBefore);
    await stop();
    await start(100);
    await api('/api/auth/start', {});
    const timedOut = await waitFor(status => status.status === 'error');
    assert.equal(timedOut.error, 'Sign-in timed out; try again');
    assert.equal(timedOut.prompt, undefined);
    assert.equal((await api('/api/auth/start', {})).body.status, 'pending');
    await api('/api/auth/cancel', {});
    assert.equal(await readFile(authPath, 'utf8'), authBefore);
  } finally {
    staleRequest?.destroy();
    if (child && child.exitCode === null) await stop();
    await rm(home, { recursive: true, force: true });
  }
});
