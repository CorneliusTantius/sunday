import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { JSDOM } from 'jsdom';

let bundle;
before(async () => {
  // Compile the real entry point and JSX without writing build artifacts.
  const result = await build({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('../src/web/main.jsx', import.meta.url)),
        formats: ['iife'],
        name: 'SundayTest',
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  bundle = outputs.flatMap(output => output.output).find(output => output.type === 'chunk' && output.isEntry).code;
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(check) {
  const deadline = Date.now() + 3000;
  while (true) {
    try { check(); return; }
    catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(10);
    }
  }
}

async function mount(t, options = {}) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {
    url: 'http://localhost:3000', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const window = dom.window;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  if (options.resizeObservers) window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; options.resizeObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  window.TextDecoder = TextDecoder;
  window.TextEncoder = TextEncoder;
  window.AbortController = AbortController;
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const manualTimers = [];
  window.setTimeout = (callback, ms, ...args) => {
    if (options.manualTimers && [150000, 5000].includes(ms)) {
      const timer = { callback: () => callback(...args), ms, cleared: false };
      manualTimers.push(timer);
      return timer;
    }
    return realSetTimeout(callback, ms, ...args);
  };
  window.clearTimeout = timer => { if (timer && typeof timer === 'object') timer.cleared = true; else realClearTimeout(timer); };
  window.confirm = () => true;
  window.localStorage.setItem('sunday-session-id', 'session-1');

  const models = [{ id: 'model-a', name: 'Model A', thinkingLevels: ['off', 'high'] }, { id: 'model-b', name: 'Model B', thinkingLevels: ['off', 'high'] }];
  const defaults = { provider: 'openai', mode: 'api_key', model: 'model-a', thinkingLevel: 'off', models, providers: [] };
  const sessions = [1, 2].map(id => ({ id: `session-${id}`, title: `Chat ${id}`, messages: [], config: { provider: 'openai', mode: 'api_key', model: id === 1 ? 'model-a' : 'model-b', thinkingLevel: id === 1 ? 'off' : 'high' }, models }));
  if (options.history) sessions[0].messages = options.history;
  const calls = [];
  let pending = null;
  let stream;
  let resumeStream;
  let resumeCount = 0;
  let streamAborted = false;
  let cancellation;
  let cancellationAborted = false;
  const response = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
  window.fetch = async (url, requestOptions = {}) => {
    const method = requestOptions.method || 'GET';
    calls.push({ url, method, ...(requestOptions.body ? { body: JSON.parse(requestOptions.body) } : {}) });
    if (url === '/api/settings') return response(defaults);
    if (url === '/api/personas') return response({ personas: [{ id: 'sunday', name: 'Sunday' }] });
    if (url === '/api/repos') return response({ repos: [] });
    if (/^\/api\/sessions\/[^/]+\/files\?/.test(url)) return response({ files: options.files || ['repo/src/main.js', 'repo/read me.txt'] });
    if (url === '/api/sessions' && method === 'GET') return response({ sessions: [...sessions] });
    if (url === '/api/chat/cancel') {
      if (options.cancelFailure) throw new Error('cancel failed');
      if (options.hangCancel) return new Promise((resolve, reject) => {
        cancellation = { resolve, reject };
        requestOptions.signal?.addEventListener('abort', () => { cancellationAborted = true; reject(new DOMException('Aborted', 'AbortError')); });
      });
      return response({ cancelled: true });
    }
    if (url.startsWith('/api/chat/stream?')) {
      resumeCount++;
      return { ok: true, body: new ReadableStream({ start(controller) {
        resumeStream = controller;
        if (!options.emptyResume) controller.enqueue(new TextEncoder().encode('data: {"type":"snapshot","answer":"replayed answer","toolCalls":[]}\n\n'));
        requestOptions.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      } }) };
    }
    if (url === '/api/chat') {
      if (options.rejectChat) return response({ error: 'Referenced file is not readable' }, false);
      if (options.hangChat) return new Promise((resolve, reject) => {
        requestOptions.signal.addEventListener('abort', () => { streamAborted = true; reject(new DOMException('Aborted', 'AbortError')); });
      });
      return { ok: true, body: new ReadableStream({ start(controller) {
        stream = controller;
        requestOptions.signal.addEventListener('abort', () => { streamAborted = true; controller.error(new DOMException('Aborted', 'AbortError')); });
      } }) };
    }
    if (pending) return pending.promise;
    if (url === '/api/sessions' && method === 'POST') {
      const session = { id: `session-${sessions.length + 1}`, title: 'New chat', messages: [], config: { provider: defaults.provider, mode: defaults.mode, model: defaults.model, thinkingLevel: defaults.thinkingLevel }, models };
      sessions.push(session);
      return response({ session });
    }
    const session = sessions.find(item => url === `/api/sessions/${item.id}`);
    if (session && method === 'GET') return response({ session });
    if (session && method === 'PATCH') {
      const input = JSON.parse(requestOptions.body);
      session.config = { ...session.config, ...input.config };
      return response({ session });
    }
    assert.fail(`Unexpected request: ${method} ${url}`);
  };
  window.eval(bundle);
  const $ = selector => window.document.querySelector(selector);
  const click = selector => {
    // dispatchEvent also exercises handler guards on disabled buttons and before rerender.
    $(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };
  const controls = () => [...window.document.querySelectorAll('#new-chat, .session-item, .configure-session')];
  const assertEnabled = () => {
    assert.equal(controls().length, 1 + sessions.length * 2);
    for (const control of controls()) assert.equal(control.disabled, false, control.outerHTML);
  };
  const actionCalls = () => calls.filter(({ url, method }) => url.startsWith('/api/sessions/') || (url === '/api/sessions' && method !== 'GET'));
  const selected = () => window.localStorage.getItem('sunday-session-id');
  await waitFor(() => {
    assert.equal($('.session-item.active')?.textContent, 'Chat 1');
    assertEnabled();
  });
  click('#agents-toggle');
  await waitFor(() => assert.equal($('#agents-toggle').getAttribute('aria-expanded'), 'true'));
  return {
    $, click, controls, assertEnabled, actionCalls, selected, response, calls, defaults, streamAborted: () => streamAborted, resumeCalls: () => resumeCount, sessions,
    cancelCalls() { return calls.filter(({ url, method }) => url === '/api/chat/cancel' && method === 'POST'); },
    hold() { pending = deferred(); return pending; },
    release() { pending = null; },
    submit(text) {
      $('#prompt').value = text;
      $('#prompt').dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    send() { $('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); },
    finishStream() { stream.close(); },
    emit(type, data = {}, resumed = false) {
      const target = resumed ? resumeStream : stream;
      target.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
    },
    timers: manualTimers,
    fireTimer(ms) { const timer = manualTimers.find(item => item.ms === ms && !item.cleared); assert.ok(timer, `no active ${ms}ms timer`); timer.cleared = true; timer.callback(); },
    cancellationPending: () => cancellation,
    cancellationAborted: () => cancellationAborted,
    finishResume() { resumeStream.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n')); resumeStream.close(); },
  };
}

for (const action of ['create', 'open']) {
  for (const outcome of ['success', 'failure']) {
    test(`${action} ${outcome} re-enables session controls and releases the loading guard`, async t => {
      const h = await mount(t);
      const pending = h.hold();
      const selector = action === 'create' ? '#new-chat' : '.sessions-list > .session-row:nth-child(2) .session-item';
      const before = h.actionCalls().length;
      h.click(selector);
      // Attempt competing actions in the same turn, before disabled props can render.
      h.click('#new-chat');
      h.click('.sessions-list > .session-row:nth-child(2) .session-item');
      h.click('.configure-session');
      assert.equal(h.actionCalls().length, before + 1);
      assert.equal(h.actionCalls().at(-1).method, action === 'create' ? 'POST' : 'GET');
      assert.equal(h.actionCalls().at(-1).url, action === 'create' ? '/api/sessions' : '/api/sessions/session-2');
      await waitFor(() => {
        for (const control of h.controls()) assert.equal(control.disabled, true);
      });
      h.click('#new-chat');
      h.click('.sessions-list > .session-row:nth-child(2) .session-item');
      assert.equal(h.actionCalls().length, before + 1);
      assert.equal(h.$('#session-config-dialog'), null);
      assert.equal(h.selected(), 'session-1');

      const session = action === 'create'
        ? { id: 'session-3', title: 'Created chat', messages: [] }
        : h.sessions[1];
      if (outcome === 'success' && action === 'create') h.sessions.push(session);
      h.release();
      pending.resolve(outcome === 'success'
        ? h.response({ session })
        : h.response({ error: 'Session service unavailable' }, false));
      await waitFor(() => {
        h.assertEnabled();
        assert.equal(h.selected(), outcome === 'success' ? session.id : 'session-1');
        if (outcome === 'failure') {
          assert.equal(h.$('#toast').textContent, `Could not ${action === 'create' ? 'start' : 'open'} chat: Session service unavailable`);
        }
      });
      // A real subsequent action verifies the ref lock was cleared, not just disabled props.
      h.click('#new-chat');
      await waitFor(() => {
        assert.equal(h.actionCalls().length, before + 2);
        assert.equal(h.selected(), `session-${h.sessions.length}`);
        h.assertEnabled();
      });
    });
  }
}

test('Stop aborts the local stream and unlocks immediately while server cancellation is pending', async t => {
  const h = await mount(t, { hangCancel: true, manualTimers: true });
  h.submit('Hello');
  await delay(0);
  h.send();
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Stop response'));
  h.send();
  await waitFor(() => assert.equal(h.cancelCalls().length, 1));
  await waitFor(() => {
    assert.equal(h.streamAborted(), true);
    assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message');
  });
  h.fireTimer(5000);
  await waitFor(() => assert.equal(h.cancellationAborted(), true));
});

test('stream progress is exposed as a safe response activity status', async t => {
  const h = await mount(t);
  h.submit('Hello'); await delay(0); h.send();
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Stop response'));
  const status = () => h.$('#response-activity');
  assert.equal(status()?.getAttribute('role'), 'status');
  assert.equal(status()?.closest('#chat-composer'), h.$('#chat-composer'), 'activity stays visible outside scrolling history');
  assert.equal(status()?.textContent, 'Waiting for response…');
  h.emit('progress', { status: 'thinking', reasoning: 'private chain of thought' });
  await waitFor(() => assert.equal(status()?.textContent, 'Thinking…'));
  h.emit('progress', { status: 'preparing_tool' });
  await waitFor(() => assert.equal(status()?.textContent, 'Preparing tool…'));
  h.emit('progress', { status: 'waiting' });
  await waitFor(() => assert.equal(status()?.textContent, 'Waiting for response…'));
  h.emit('progress', { status: 'private reasoning' });
  await waitFor(() => assert.equal(status()?.textContent, 'Waiting for response…'));
  h.emit('progress', { status: 'toString' });
  h.emit('delta', { text: 'Visible answer' });
  await waitFor(() => {
    assert.equal(status()?.textContent, 'Responding…');
    assert.match(h.$('#messages').textContent, /Visible answer/);
    assert.doesNotMatch(h.$('.main').textContent, /private reasoning|private chain of thought/);
  });
  h.emit('done');
  await waitFor(() => {
    assert.equal(status(), null);
    assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message');
  });
});

test('reopening a running session reconnects and restores the streamed snapshot', async t => {
  const h = await mount(t);
  h.sessions[1].running = true;
  h.sessions[1].messages.push({ role: 'user', content: 'Continue this job' });
  h.click('.sessions-list > .session-row:nth-child(2) .session-item');
  await waitFor(() => {
    assert.equal(h.selected(), 'session-2');
    assert.equal(h.resumeCalls(), 1);
    const pill = h.$('.sessions-list > .session-row:nth-child(2) .session-running-pill');
    assert.ok(pill, 'running session has an activity pill');
    assert.equal(pill.getAttribute('aria-label'), 'Running');
    assert.equal(pill.textContent, '');
    assert.equal(h.$('.sessions-list > .session-row:first-child .session-running-pill'), null);
    assert.match(h.$('#messages').textContent, /replayed answer/);
  });
  h.finishResume();
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message'));
});

test('switching sessions detaches the client stream without cancelling the server chat', async t => {
  const h = await mount(t, { manualTimers: true });
  h.submit('Hello');
  await delay(0);
  h.send();
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Stop response'));
  h.emit('progress', { status: 'thinking' });
  await waitFor(() => assert.equal(h.$('#response-activity')?.textContent, 'Thinking…'));
  const oldTimer = h.timers.find(timer => timer.ms === 150000 && !timer.cleared);
  h.click('.sessions-list > .session-row:nth-child(2) .session-item');
  await waitFor(() => {
    assert.equal(h.selected(), 'session-2');
    assert.equal(h.$('#response-activity'), null);
    assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message');
    h.assertEnabled();
  });
  assert.equal(h.streamAborted(), true, 'client stream should detach');
  assert.equal(oldTimer.cleared, true);
  oldTimer.callback();
  assert.equal(h.cancelCalls().length, 0, 'navigation must not call server cancellation');
  assert.doesNotMatch(h.$('#messages').textContent, /stalled/);
  h.click('#new-chat');
  await waitFor(() => assert.equal(h.selected(), 'session-3'));
});

async function startChat(h) {
  h.submit('Hello');
  await delay(0);
  h.send();
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Stop response'));
}

test('opens another session settings while the active session is streaming', async t => {
  const h = await mount(t);
  await startChat(h);
  const otherSessionSettings = h.$('.sessions-list > .session-row:nth-child(2) .configure-session');
  assert.equal(otherSessionSettings.disabled, false);
  h.click('.sessions-list > .session-row:nth-child(2) .configure-session');
  await waitFor(() => {
    assert.ok(h.$('#session-config-dialog'));
    assert.ok(h.calls.some(call => call.url === '/api/sessions/session-2' && call.method === 'GET'));
  });
  assert.equal(h.selected(), 'session-1');
  assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Stop response');
  h.emit('done');
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message'));
});

test('early tool status is updated by id without duplicate calls or lost arguments', async t => {
  const h = await mount(t);
  await startChat(h);
  h.emit('tool_status', { id: 'tool-1', name: 'bash', status: 'running' });
  await waitFor(() => {
    assert.equal(h.$('.toolcalls-count')?.textContent, '1');
    assert.equal(h.$('#response-activity')?.textContent, 'Using tools…');
  });
  h.emit('tool_status', { id: 'tool-1', name: 'read', arguments: { path: '/tmp/example' }, status: 'running' });
  await waitFor(() => {
    assert.equal(h.$('.toolcall-heading strong')?.textContent, 'read');
    assert.match(h.$('.toolcall-detail pre')?.textContent, /\/tmp\/example/);
    assert.equal(h.$('.toolcalls-count')?.textContent, '1');
  });
  h.emit('tool_status', { id: 'tool-1', status: 'failed' });
  await waitFor(() => assert.equal(h.$('.toolcall-status')?.textContent, 'Failed'));
  h.emit('tool_complete', { id: 'tool-1', status: 'completed', result: 'The tool finished successfully.' });
  await waitFor(() => {
    assert.equal(h.$('.toolcall-status')?.textContent, 'Succeeded');
    assert.equal(h.$('.toolcall-heading strong')?.textContent, 'read');
    assert.match(h.$('.toolcall-detail pre')?.textContent, /\/tmp\/example/);
    assert.match(h.$('.toolcall-detail')?.textContent, /The tool finished successfully/);
    assert.equal(h.$('.toolcalls-count')?.textContent, '1');
  });
  h.emit('done');
});

test('resumed snapshot restores progress and tool updates reuse its existing call', async t => {
  const h = await mount(t, { emptyResume: true });
  h.sessions[1].running = true;
  h.sessions[1].messages.push({ role: 'user', content: 'Continue this job' });
  h.click('.sessions-list > .session-row:nth-child(2) .session-item');
  await waitFor(() => assert.equal(h.resumeCalls(), 1));
  h.emit('snapshot', { answer: 'Restored answer', progress: 'preparing_tool', toolCalls: [
    { id: 'tool-1', name: 'bash', arguments: {}, status: 'running' },
  ] }, true);
  await waitFor(() => {
    assert.equal(h.$('#response-activity')?.textContent, 'Preparing tool…');
    assert.match(h.$('#messages').textContent, /Restored answer/);
    assert.equal(h.$('.toolcalls-count')?.textContent, '1');
  });
  h.emit('tool_status', { id: 'tool-1', arguments: { command: 'pwd' }, status: 'running' }, true);
  await waitFor(() => {
    assert.equal(h.$('.toolcalls-count')?.textContent, '1');
    assert.equal(h.$('.toolcall-heading strong')?.textContent, 'bash');
    assert.match(h.$('.toolcall-detail pre')?.textContent, /pwd/);
  });
  h.emit('done', {}, true);
  await waitFor(() => {
    assert.equal(h.$('#response-activity'), null);
    assert.equal(h.$('#prompt').disabled, false);
  });
});

for (const partial of [false, true]) {
  test(`server error clears activity and releases the composer${partial ? ' after partial text' : ''}`, async t => {
    const h = await mount(t, { manualTimers: true });
    await startChat(h);
    if (partial) h.emit('delta', { text: 'Partial answer' });
    h.emit('error', { error: 'Provider failed; retry your message.' });
    // No EOF: the terminal event itself must release the UI.
    await waitFor(() => {
      assert.equal(h.$('#response-activity'), null);
      assert.equal(h.$('#prompt').disabled, false);
      assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message');
      assert.match(h.$(partial ? '#toast' : '#messages').textContent, /Provider failed; retry/);
      if (partial) assert.match(h.$('#messages').textContent, /Partial answer/);
    });
    assert.ok(h.timers.filter(timer => timer.ms === 150000).every(timer => timer.cleared));
    assert.equal(h.cancelCalls().length, 0);
  });
}

for (const hangChat of [false, true]) {
  test(`idle guard detaches ${hangChat ? 'stalled headers' : 'a silent stream'} without cancelling the server run`, async t => {
    const h = await mount(t, { manualTimers: true, hangChat });
    await startChat(h);
    h.fireTimer(150000);
    assert.equal(h.streamAborted(), true);
    await waitFor(() => {
      assert.equal(h.$('#response-activity'), null);
      assert.equal(h.$('#prompt').disabled, true);
      assert.ok(h.$('.background-run-status'));
    });
    assert.equal(h.cancelCalls().length, 0);
    assert.ok(h.timers.filter(timer => timer.ms === 150000).every(timer => timer.cleared));
  });
}

test('returning to the browser reconnects a running chat without cancelling it', async t => {
  const h = await mount(t, { manualTimers: true });
  await startChat(h);
  h.sessions[0].running = true;
  h.sessions[0].messages = [{ role: 'user', content: 'Continue' }];
  const document = h.$('#prompt').ownerDocument;
  document.dispatchEvent(new document.defaultView.Event('visibilitychange'));
  await waitFor(() => assert.equal(h.resumeCalls(), 1));
  assert.equal(h.streamAborted(), true);
  assert.equal(h.cancelCalls().length, 0);
  h.emit('done', {}, true);
});

test('Stop aborts locally even if server cancellation fails', async t => {
  const h = await mount(t, { cancelFailure: true });
  await startChat(h);
  h.send();
  assert.equal(h.streamAborted(), true, 'abort happens synchronously before cancellation settles');
  await waitFor(() => {
    assert.equal(h.$('#response-activity'), null);
    assert.equal(h.$('#prompt').disabled, false);
    assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message');
  });
  assert.equal(h.cancelCalls().length, 1);
});

test('unexpected stream EOF preserves partial text and keeps server reconciliation enabled', async t => {
  const h = await mount(t, { manualTimers: true });
  await startChat(h);
  h.emit('delta', { text: 'Partial answer' });
  h.finishStream();
  await waitFor(() => {
    assert.equal(h.$('#response-activity'), null);
    assert.equal(h.$('#prompt').disabled, true);
    assert.ok(h.$('.background-run-status'));
    assert.match(h.$('#messages').textContent, /Partial answer/);
    assert.match(h.$('#messages').textContent, /Response stream ended unexpectedly\. Check your connection and retry/);
  });
  assert.equal(h.resumeCalls(), 0);
  assert.ok(h.timers.filter(timer => timer.ms === 150000).every(timer => timer.cleared));
});

test('model and thinking controls save only the active session and restore each session independently', async t => {
  const h = await mount(t);
  assert.equal(h.$('#chat-model').value, 'model-a');
  h.$('#thinking-level').value = 'high';
  h.$('#thinking-level').dispatchEvent(new (h.$('#thinking-level').ownerDocument.defaultView.Event)('change', { bubbles: true }));
  await waitFor(() => assert.equal(h.sessions[0].config.thinkingLevel, 'high'));
  await waitFor(() => assert.equal(h.$('#thinking-level').disabled, false));
  h.$('#chat-model').value = 'model-b';
  h.$('#chat-model').dispatchEvent(new (h.$('#chat-model').ownerDocument.defaultView.Event)('change', { bubbles: true }));
  await waitFor(() => assert.equal(h.sessions[0].config.model, 'model-b'));
  await waitFor(() => assert.equal(h.$('#chat-model').disabled, false));
  assert.equal(h.defaults.model, 'model-a');
  assert.equal(h.defaults.thinkingLevel, 'off');
  assert.equal(h.calls.filter(call => call.url === '/api/settings' && call.method !== 'GET').length, 0);
  h.click('.sessions-list > .session-row:nth-child(2) .session-item');
  await waitFor(() => assert.equal(h.selected(), 'session-2'));
  assert.equal(h.$('#chat-model').value, 'model-b');
  assert.equal(h.$('#thinking-level').value, 'high');
  h.defaults.model = 'model-a'; h.defaults.thinkingLevel = 'off';
  h.click('#new-chat');
  await waitFor(() => assert.equal(h.selected(), 'session-3'));
  assert.equal(h.$('#chat-model').value, 'model-a');
  assert.equal(h.$('#thinking-level').value, 'off');
  h.click('.sessions-list > .session-row:nth-child(1) .session-item');
  await waitFor(() => assert.equal(h.selected(), 'session-1'));
  assert.equal(h.$('#chat-model').value, 'model-b');
  assert.equal(h.$('#thinking-level').value, 'high');
});

function promptKey(h, key, extra = {}) {
  const input = h.$('#prompt');
  return input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
}

test('slash suggestions accept with Enter and commands do not reach the model', async t => {
  const h = await mount(t);
  h.submit('/ne');
  await waitFor(() => assert.equal(h.$('#composer-options [role="option"]')?.textContent.includes('/new'), true));
  assert.equal(promptKey(h, 'Enter'), false);
  await waitFor(() => assert.equal(h.$('#prompt').value, '/new '));
  assert.equal(h.calls.some(call => call.url === '/api/chat'), false);
  await delay(0);
  h.send();
  await waitFor(() => assert.equal(h.selected(), 'session-3'));
  h.submit('/help'); await delay(0); h.send();
  await waitFor(() => assert.match(h.$('#toast').textContent, /Unknown command/));
  assert.equal(h.$('#prompt').value, '/help');
  assert.equal(h.calls.some(call => call.url === '/api/chat'), false);
  h.submit('/unsupported'); await delay(0); h.send();
  await waitFor(() => assert.match(h.$('#toast').textContent, /Unknown command/));
  assert.equal(h.$('#prompt').value, '/unsupported');
});

test('file suggestions support keyboard selection, spaces, and separate reference payloads', async t => {
  const h = await mount(t);
  h.submit('Read @repo/');
  await waitFor(() => assert.equal(h.$('#composer-options')?.children.length, 2));
  promptKey(h, 'ArrowDown'); await delay(0);
  promptKey(h, 'Tab');
  await waitFor(() => assert.equal(h.$('#prompt').value, 'Read @"repo/read me.txt" '));
  await delay(0);
  h.send();
  await waitFor(() => assert.equal(h.calls.some(call => call.url === '/api/chat'), true));
  const chat = h.calls.find(call => call.url === '/api/chat');
  assert.deepEqual(chat.body.fileReferences, ['repo/read me.txt']);
  assert.equal(chat.body.messages[0].content, 'Read @"repo/read me.txt" ');
  h.finishStream();
});

test('Escape dismisses suggestions and Shift+Enter keeps normal multiline behavior', async t => {
  const h = await mount(t);
  h.submit('/');
  await waitFor(() => assert.equal(h.$('#prompt').getAttribute('aria-expanded'), 'true'));
  assert.equal(promptKey(h, 'Enter', { shiftKey: true }), true);
  promptKey(h, 'Escape');
  await waitFor(() => assert.equal(h.$('#prompt').getAttribute('aria-expanded'), 'false'));
  assert.equal(h.calls.some(call => call.url === '/api/chat'), false);
});

test('rejected file references restore the draft for correction', async t => {
  const h = await mount(t, { rejectChat: true });
  const draft = 'Read @"repo/missing.txt"';
  h.submit(draft); await delay(0); h.send();
  await waitFor(() => {
    assert.equal(h.$('#prompt').disabled, false);
    assert.equal(h.$('#prompt').value, draft);
    assert.match(h.$('#messages').textContent, /Referenced file is not readable/);
  });
});

function mockTranscriptScroll(h) {
  const element = h.$('#conversation');
  let height = 1000, top = 0;
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, get: () => 200 },
    scrollTop: { configurable: true, get: () => top, set: value => { top = Math.max(0, Math.min(value, height - 200)); } },
  });
  return {
    element,
    grow(value) { height = value; },
    scroll(value) { element.scrollTop = value; element.dispatchEvent(new element.ownerDocument.defaultView.Event('scroll')); },
  };
}

test('streamed response growth follows the transcript bottom without adding messages', async t => {
  const h = await mount(t);
  const scroll = mockTranscriptScroll(h);
  h.submit('Hello'); await delay(0); h.send();
  await waitFor(() => assert.equal(scroll.element.scrollTop, 800));
  const count = h.$('#messages').children.length;
  scroll.grow(1400);
  h.emit('delta', { text: 'Long streamed response' });
  await waitFor(() => {
    assert.equal(scroll.element.scrollTop, 1200);
    assert.equal(h.$('#messages').children.length, count);
    assert.equal(h.$('#scroll-to-latest'), null);
  });
  h.emit('done'); h.finishStream();
});

test('scrolling up preserves reading position and the latest button resumes following', async t => {
  const h = await mount(t);
  const scroll = mockTranscriptScroll(h);
  h.submit('Hello'); await delay(0); h.send();
  await waitFor(() => assert.equal(scroll.element.scrollTop, 800));
  scroll.scroll(300);
  await waitFor(() => assert.ok(h.$('#scroll-to-latest')));
  scroll.grow(1400);
  h.emit('delta', { text: 'More text' });
  await waitFor(() => assert.match(h.$('#messages').textContent, /More text/));
  assert.equal(scroll.element.scrollTop, 300);
  h.click('#scroll-to-latest');
  await waitFor(() => {
    assert.equal(scroll.element.scrollTop, 1200);
    assert.equal(h.$('#scroll-to-latest'), null);
  });
  scroll.grow(1800);
  h.emit('delta', { text: ' and more' });
  await waitFor(() => assert.equal(scroll.element.scrollTop, 1600));
  scroll.scroll(1590);
  await delay(0);
  assert.equal(h.$('#scroll-to-latest'), null);
  h.emit('done'); h.finishStream();
});

test('content resizing follows the bottom and resets when switching sessions', async t => {
  const resizeObservers = [];
  const h = await mount(t, { resizeObservers });
  const scroll = mockTranscriptScroll(h);
  await waitFor(() => assert.ok(resizeObservers.length));
  scroll.scroll(800);
  scroll.grow(1500);
  resizeObservers.at(-1).callback();
  assert.equal(scroll.element.scrollTop, 1300);
  scroll.scroll(100);
  await waitFor(() => assert.ok(h.$('#scroll-to-latest')));
  scroll.grow(1700);
  resizeObservers.at(-1).callback();
  assert.equal(scroll.element.scrollTop, 100);
  h.click('.sessions-list > .session-row:nth-child(2) .session-item');
  await waitFor(() => {
    assert.equal(h.selected(), 'session-2');
    assert.equal(scroll.element.scrollTop, 1500);
    assert.equal(h.$('#scroll-to-latest'), null);
  });
});


test('long histories initially render recent messages and reveal older pages on demand', async t => {
  const history = Array.from({ length: 95 }, (_, index) => ({ role: 'user', content: `Message ${index}` }));
  const h = await mount(t, { history });
  assert.equal(h.$('#messages').querySelectorAll('.message').length, 40);
  assert.equal(h.$('#messages .message').textContent.trim(), 'Message 55');
  h.click('.show-older-messages');
  await waitFor(() => assert.equal(h.$('#messages').querySelectorAll('.message').length, 80));
  h.click('.show-older-messages');
  await waitFor(() => assert.equal(h.$('#messages').querySelectorAll('.message').length, 95));
  assert.equal(h.$('.show-older-messages'), null);
  assert.equal(history.length, 95);
});
