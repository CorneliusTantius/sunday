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

async function mount(t) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {
    url: 'http://localhost:3000', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const window = dom.window;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.TextDecoder = TextDecoder;
  window.TextEncoder = TextEncoder;
  window.AbortController = AbortController;
  window.confirm = () => true;
  window.localStorage.setItem('sunday-session-id', 'session-1');

  const sessions = [1, 2].map(id => ({ id: `session-${id}`, title: `Chat ${id}`, messages: [] }));
  const calls = [];
  let pending = null;
  let stream;
  let resumeStream;
  let resumeCount = 0;
  let streamAborted = false;
  const response = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
  window.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method });
    if (url === '/api/settings') return response({ models: [], providers: [] });
    if (url === '/api/sessions' && method === 'GET') return response({ sessions: [...sessions] });
    if (url === '/api/chat/cancel') return response({ cancelled: true });
    if (url.startsWith('/api/chat/stream?')) {
      resumeCount++;
      return { ok: true, body: new ReadableStream({ start(controller) {
        resumeStream = controller;
        controller.enqueue(new TextEncoder().encode('data: {"type":"snapshot","answer":"replayed answer","toolCalls":[]}\n\n'));
        options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      } }) };
    }
    if (url === '/api/chat') {
      return { ok: true, body: new ReadableStream({ start(controller) {
        stream = controller;
        options.signal.addEventListener('abort', () => { streamAborted = true; controller.error(new DOMException('Aborted', 'AbortError')); });
      } }) };
    }
    if (pending) return pending.promise;
    if (url === '/api/sessions' && method === 'POST') {
      const session = { id: `session-${sessions.length + 1}`, title: 'New chat', messages: [] };
      sessions.push(session);
      return response({ session });
    }
    const session = sessions.find(item => url === `/api/sessions/${item.id}`);
    if (session && method === 'GET') return response({ session });
    assert.fail(`Unexpected request: ${method} ${url}`);
  };
  window.eval(bundle);
  const $ = selector => window.document.querySelector(selector);
  const click = selector => {
    // dispatchEvent also exercises handler guards on disabled buttons and before rerender.
    $(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };
  const controls = () => [...window.document.querySelectorAll('#new-chat, .session-item, .configure-session, .delete-session')];
  const assertEnabled = () => {
    assert.equal(controls().length, 1 + sessions.length * 3);
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
    $, click, controls, assertEnabled, actionCalls, selected, response, streamAborted: () => streamAborted, resumeCalls: () => resumeCount, sessions,
    cancelCalls() { return calls.filter(({ url, method }) => url === '/api/chat/cancel' && method === 'POST'); },
    hold() { pending = deferred(); return pending; },
    release() { pending = null; },
    submit(text) {
      $('#prompt').value = text;
      $('#prompt').dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    send() { $('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); },
    finishStream() { stream.close(); },
    finishResume() { resumeStream.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n')); resumeStream.close(); },
  };
}

for (const action of ['create', 'open']) {
  for (const outcome of ['success', 'failure']) {
    test(`${action} ${outcome} re-enables session controls and releases the loading guard`, async t => {
      const h = await mount(t);
      const pending = h.hold();
      const selector = action === 'create' ? '#new-chat' : '.session-row:nth-child(2) .session-item';
      const before = h.actionCalls().length;
      h.click(selector);
      // Attempt competing actions in the same turn, before disabled props can render.
      h.click('#new-chat');
      h.click('.session-row:nth-child(2) .session-item');
      h.click('.delete-session');
      h.click('.configure-session');
      assert.equal(h.actionCalls().length, before + 1);
      assert.equal(h.actionCalls().at(-1).method, action === 'create' ? 'POST' : 'GET');
      assert.equal(h.actionCalls().at(-1).url, action === 'create' ? '/api/sessions' : '/api/sessions/session-2');
      await waitFor(() => {
        for (const control of h.controls()) assert.equal(control.disabled, true);
      });
      h.click('#new-chat');
      h.click('.session-row:nth-child(2) .session-item');
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

test('Stop asks the server to cancel the active chat before closing its stream', async t => {
  const h = await mount(t);
  h.submit('Hello');
  await delay(0);
  h.send();
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Stop response'));
  h.send();
  await waitFor(() => {
    assert.equal(h.cancelCalls().length, 1);
  });
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message'));
});

test('reopening a running session reconnects and restores the streamed snapshot', async t => {
  const h = await mount(t);
  h.sessions[1].running = true;
  h.sessions[1].messages.push({ role: 'user', content: 'Continue this job' });
  h.click('.session-row:nth-child(2) .session-item');
  await waitFor(() => {
    assert.equal(h.selected(), 'session-2');
    assert.equal(h.resumeCalls(), 1);
    const pill = h.$('.session-row:nth-child(2) .session-running-pill');
    assert.ok(pill, 'running session has an activity pill');
    assert.equal(pill.getAttribute('aria-label'), 'Running');
    assert.equal(pill.textContent, '');
    assert.equal(h.$('.session-row:first-child .session-running-pill'), null);
    assert.match(h.$('#messages').textContent, /replayed answer/);
  });
  h.finishResume();
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message'));
});

test('switching sessions detaches the client stream without cancelling the server chat', async t => {
  const h = await mount(t);
  h.submit('Hello');
  await delay(0);
  h.send();
  await waitFor(() => assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Stop response'));
  h.click('.session-row:nth-child(2) .session-item');
  await waitFor(() => {
    assert.equal(h.selected(), 'session-2');
    assert.equal(h.$('#send-button').getAttribute('aria-label'), 'Send message');
    h.assertEnabled();
  });
  assert.equal(h.streamAborted(), true, 'client stream should detach');
  assert.equal(h.cancelCalls().length, 0, 'navigation must not call server cancellation');
  h.click('#new-chat');
  await waitFor(() => assert.equal(h.selected(), 'session-3'));
});
