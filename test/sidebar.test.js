import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

let vite, App;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  ({ default: App } = await vite.ssrLoadModule('/App.jsx'));
});
after(async () => { await vite?.close(); });

async function mount(t, mobile = false, sessions = [{ id: 'sidebar-test', title: 'Test chat', messages: [] }], pinnedAgentIds) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  if (pinnedAgentIds) window.localStorage.setItem('sunday-pinned-agent-ids', JSON.stringify(pinnedAgentIds));
  const listeners = new Set();
  const layout = {
    matches: mobile,
    addEventListener(type, listener) { assert.equal(type, 'change'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'change'); listeners.delete(listener); },
  };
  const matchMedia = query => query === '(max-width: 700px)' ? layout : {
    matches: false, addEventListener() {}, removeEventListener() {},
  };
  window.matchMedia = matchMedia;
  // jsdom has no layout. Only expose controls that the sidebar actually displays
  // so App's real focus trap can filter hidden/disabled controls normally.
  window.HTMLElement.prototype.getClientRects = function () {
    return this.closest('.hidden') ? [] : [{ width: 10, height: 10 }];
  };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  const session = sessions[0];
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    let data;
    if (url === '/api/settings') data = { providers: [], models: [], thinkingLevel: 'off' };
    else if (url === '/api/sessions') data = options.method === 'POST' ? { session } : { sessions };
    else if (url.startsWith('/api/sessions/')) data = { session: sessions.find(item => item.id === decodeURIComponent(url.slice('/api/sessions/'.length))) };
    else throw new Error(`Unexpected sidebar test request: ${url}`);
    return { ok: true, status: 200, json: async () => data };
  };
  const globals = { window, document: window.document, location: window.location, localStorage: window.localStorage, matchMedia, fetch };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = window.document.getElementById('root');
  t.after(() => {
    try { act(() => render(null, root)); assert.equal(listeners.size, 0, 'unmount removes the media listener'); }
    finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      window.close();
    }
  });
  await act(async () => {
    render(h(App), root);
    // Drain the mocked settings/session requests and their state updates.
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  const get = id => {
    const element = window.document.getElementById(id);
    assert.ok(element, `#${id} is mounted`);
    return element;
  };
  return {
    window, get, requests,
    click(id) { act(() => get(id).click()); },
    key(key, shiftKey = false) {
      const event = new window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
      act(() => window.document.activeElement.dispatchEvent(event));
      return event;
    },
    resize(matches) { act(() => { layout.matches = matches; for (const listener of listeners) listener({ matches }); }); },
  };
}

for (const mobile of [true, false]) {
  test(`chat autofocus is ${mobile ? 'disabled on mobile' : 'preserved on desktop'}`, async t => {
    const app = await mount(t, mobile);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const focused = () => app.window.document.activeElement === app.window.document.querySelector('textarea');
    assert.equal(focused(), !mobile);
    await act(async () => {
      app.get('new-chat').click();
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    assert.equal(focused(), !mobile);
    await act(async () => { app.window.location.hash = 'memory'; await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => { app.window.location.hash = 'chat'; await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(focused(), !mobile);
  });
}

test('agents stay visible under their heading and pinning keeps at most three first', async t => {
  const sessions = Array.from({ length: 4 }, (_, index) => ({ id: `agent-${index + 1}`, title: `Agent ${index + 1}`, messages: [] }));
  const app = await mount(t, false, sessions);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  assert.match(app.get('new-chat').textContent, /New agent/);
  const pinButton = id => app.window.document.querySelector(`#sessions-list [data-agent-id="${id}"]`);
  assert.equal(app.window.document.querySelectorAll('#sessions-list [data-agent-id]').length, 4);
  for (const session of sessions.slice(0, 3)) act(() => pinButton(session.id).click());
  const rows = () => [...app.window.document.querySelectorAll('#sessions-list [data-agent-id]')].map(button => button.parentElement.querySelector('button[title]').textContent);
  assert.deepEqual(rows(), ['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4']);
  assert.equal(app.get('agents-heading').textContent, 'Agents');
  assert.equal(app.get('sessions-list').getAttribute('aria-label'), 'Agents');
  assert.equal(app.window.document.querySelector('#agents-sessions'), null);
  assert.deepEqual(JSON.parse(app.window.localStorage.getItem('sunday-pinned-agent-ids')), ['agent-1', 'agent-2', 'agent-3']);
  act(() => pinButton('agent-4').click());
  assert.equal(app.get('toast').textContent, 'You can pin up to 3 agents. Unpin one first.');
  assert.equal(app.window.document.querySelectorAll('#sessions-list [data-agent-id][aria-pressed="true"]').length, 3);
  act(() => pinButton('agent-2').click());
  act(() => pinButton('agent-4').click());
  assert.deepEqual(rows(), ['Agent 1', 'Agent 3', 'Agent 4', 'Agent 2']);
});

test('scheduled-job sessions stay out of both pinned and regular sidebar sessions', async t => {
  const app = await mount(t, false, [
    { id: 'scheduled', title: 'Scheduled run', scheduledJobId: 'job-1', messages: [] },
    { id: 'pinned', title: 'Pinned chat', messages: [] },
    { id: 'regular', title: 'Regular chat', messages: [] },
  ], ['scheduled', 'pinned']);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  const rows = [...app.window.document.querySelectorAll('#sessions-list [data-agent-id]')];
  assert.deepEqual(rows.map(button => button.parentElement.querySelector('button[title]').textContent), ['Pinned chat', 'Regular chat']);
  assert.equal(app.window.document.querySelector('#sessions-list [data-agent-id="scheduled"]'), null);
});

test('mobile startup reuses an existing agent without creating a session', async t => {
  const app = await mount(t, true);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  assert.equal(app.requests.some(request => request.method === 'POST'), false);
  assert.ok(app.requests.some(request => request.url === '/api/sessions/sidebar-test'));
  assert.equal(app.window.localStorage.getItem('sunday-session-id'), 'sidebar-test');
});

function state(harness, { mobile, open }) {
  const sidebar = harness.get('sidebar');
  assert.equal(sidebar.inert, !open, 'closed sidebar cannot receive interaction');
  assert.equal(harness.get('mobile-menu').getAttribute('aria-expanded'), String(open));
  const backdrop = harness.get('sidebar-backdrop');
  assert.equal(backdrop.getAttribute('aria-hidden'), String(!mobile || !open));
  assert.equal(backdrop.tabIndex, -1);
}

test('desktop collapse and rapid reopen keep the sidebar and backdrop mounted', async t => {
  const app = await mount(t);
  const sidebar = app.get('sidebar'), backdrop = app.get('sidebar-backdrop');
  state(app, { mobile: false, open: true });
  for (let i = 0; i < 3; i++) {
    app.click('collapse-sidebar');
    state(app, { mobile: false, open: false });
    assert.ok(sidebar.className.includes('transition-[width,transform,padding]'));
    assert.ok(sidebar.className.includes('duration-300'));
    assert.ok(sidebar.classList.contains('w-0'));
    assert.ok(sidebar.classList.contains('-translate-x-72'));
    assert.ok(!sidebar.classList.contains('opacity-0'), 'sidebar closes by sliding, not fading');
    assert.ok(!sidebar.classList.contains('hidden'), 'closed sidebar stays mounted to animate');
    assert.equal(app.window.document.activeElement, app.get('mobile-menu'));
    app.click('mobile-menu');
    state(app, { mobile: false, open: true });
    assert.ok(sidebar.classList.contains('translate-x-0'));
    assert.ok(!sidebar.classList.contains('opacity-100'), 'sidebar opens without a fade effect');
    assert.equal(app.get('sidebar'), sidebar);
    assert.equal(app.get('sidebar-backdrop'), backdrop);
  }
  app.key('Escape');
  state(app, { mobile: false, open: true });
});

test('mobile close button, Escape and backdrop close restore menu focus; reopening is immediate', async t => {
  const app = await mount(t, true);
  const sidebar = app.get('sidebar'), backdrop = app.get('sidebar-backdrop');
  state(app, { mobile: true, open: false });
  assert.ok(sidebar.classList.contains('-translate-x-full'));
  assert.ok(backdrop.classList.contains('opacity-0'));
  assert.ok(backdrop.classList.contains('pointer-events-none'));
  for (const close of [() => app.click('collapse-sidebar'), () => app.key('Escape'), () => app.click('sidebar-backdrop')]) {
    app.click('mobile-menu');
    state(app, { mobile: true, open: true });
    assert.ok(sidebar.classList.contains('translate-x-0'));
    assert.ok(backdrop.classList.contains('opacity-100'));
    assert.equal(app.window.document.activeElement, app.get('collapse-sidebar'));
    close();
    state(app, { mobile: true, open: false });
    assert.equal(app.window.document.activeElement, app.get('mobile-menu'));
    app.click('mobile-menu');
    state(app, { mobile: true, open: true });
    assert.equal(app.get('sidebar'), sidebar);
    assert.equal(app.get('sidebar-backdrop'), backdrop);
    app.click('collapse-sidebar');
  }
});

test('mobile Tab trap wraps visible controls and is removed when closed', async t => {
  const app = await mount(t, true);
  app.click('mobile-menu');
  const first = app.get('sidebar').querySelector('a[href]');
  const last = app.get('open-settings');
  first.focus();
  assert.equal(app.key('Tab', true).defaultPrevented, true);
  assert.equal(app.window.document.activeElement, last);
  assert.equal(app.key('Tab').defaultPrevented, true);
  assert.equal(app.window.document.activeElement, first);
  app.get('mobile-menu').focus();
  assert.equal(app.key('Tab').defaultPrevented, true);
  assert.equal(app.window.document.activeElement, first);
  app.key('Escape');
  assert.equal(app.key('Tab').defaultPrevented, false);
});

test('media changes reset sidebar state and mobile-only keyboard handling', async t => {
  const app = await mount(t);
  app.resize(true);
  state(app, { mobile: true, open: false });
  app.click('mobile-menu');
  state(app, { mobile: true, open: true });
  app.resize(false);
  state(app, { mobile: false, open: true });
  app.key('Escape');
  state(app, { mobile: false, open: true });
  app.click('collapse-sidebar');
  app.resize(true);
  state(app, { mobile: true, open: false });
});

test('running indicator remains present while agent pinning stays interactive', async t => {
  const app = await mount(t, false, [
    { id: 'sidebar-test', title: 'Test chat', messages: [] },
    { id: 'working-test', title: 'A very long running agent name that must not hide the indicator', messages: [], running: true },
  ]);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  const pill = app.window.document.querySelector('#sessions-list [aria-label="Running"]');
  const pin = app.window.document.querySelector('#sessions-list [data-agent-id="working-test"]');
  assert.ok(pill);
  assert.ok(pill.classList.contains('size-2.5'), 'running indicator has an explicit visible dot size');
  assert.ok(pill.classList.contains('bg-success'), 'running indicator uses the success color');
  assert.equal(pin.disabled, false);
  act(() => pin.click());
  assert.deepEqual(JSON.parse(app.window.localStorage.getItem('sunday-pinned-agent-ids')), ['working-test']);
});

test('ordinary sessions remain pinnable in the sidebar', async t => {
  const app = await mount(t, false, [
    { id: 'session-a', title: 'Session A', messages: [] },
    { id: 'session-b', title: 'Session B', messages: [] },
  ]);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  assert.ok(app.window.document.querySelector('#sessions-list [data-agent-id="session-b"]'));
  assert.equal(app.window.document.querySelector('#sessions-list [data-agent-id="session-b"]')?.getAttribute('aria-pressed'), 'false');
  assert.equal(app.window.document.getElementById('dashboard-link'), null);
});
