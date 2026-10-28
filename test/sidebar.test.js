import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('new agent label and pinning keep at most three agents first without a heading', async t => {
  const sessions = Array.from({ length: 4 }, (_, index) => ({ id: `agent-${index + 1}`, title: `Agent ${index + 1}`, messages: [] }));
  const app = await mount(t, false, sessions);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  assert.match(app.get('new-chat').textContent, /New agent/);
  app.click('agents-toggle');
  const pinButton = id => app.window.document.querySelector(`.pin-session[data-agent-id="${id}"]`);
  assert.equal(app.window.document.querySelectorAll('.pin-session').length, 4);
  for (const session of sessions.slice(0, 3)) act(() => pinButton(session.id).click());
  const rows = () => [...app.window.document.querySelectorAll('.session-row')].map(row => row.querySelector('.session-item').textContent);
  assert.deepEqual(rows(), ['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4']);
  assert.deepEqual([...app.window.document.querySelectorAll('.agent-list-heading')], []);
  assert.deepEqual(JSON.parse(app.window.localStorage.getItem('sunday-pinned-agent-ids')), ['agent-1', 'agent-2', 'agent-3']);
  act(() => pinButton('agent-4').click());
  assert.equal(app.get('toast').textContent, 'You can pin up to 3 agents. Unpin one first.');
  assert.equal(app.window.document.querySelectorAll('.pin-session.pinned').length, 3);
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
  app.click('agents-toggle');
  const rows = [...app.window.document.querySelectorAll('.session-row')];
  assert.deepEqual(rows.map(row => row.querySelector('.session-item').textContent), ['Pinned chat', 'Regular chat']);
  assert.equal(app.window.document.querySelector('[data-agent-id="scheduled"]'), null);
});

test('mobile startup reuses an existing agent without creating a session', async t => {
  const app = await mount(t, true);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  assert.equal(app.requests.some(request => request.method === 'POST'), false);
  assert.ok(app.requests.some(request => request.url === '/api/sessions/sidebar-test'));
  assert.equal(app.window.localStorage.getItem('sunday-session-id'), 'sidebar-test');
});

test('mobile sidebar has an opaque background', () => {
  const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.sidebar\s*\{[^}]*background: var\(--sidebar-bg\)/);
});

function state(harness, { mobile, open }) {
  const sidebar = harness.get('sidebar');
  assert.equal(sidebar.className, `sidebar${mobile && open ? ' open' : ''}${!mobile && !open ? ' collapsed' : ''}`);
  assert.equal(sidebar.inert, !open, 'closed sidebar cannot receive interaction');
  assert.equal(harness.get('mobile-menu').getAttribute('aria-expanded'), String(open));
  const backdrop = harness.get('sidebar-backdrop');
  assert.equal(backdrop.className, `sidebar-backdrop${mobile && open ? ' open' : ''}`);
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
    assert.equal(app.window.document.activeElement, app.get('mobile-menu'));
    app.click('mobile-menu');
    state(app, { mobile: false, open: true });
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
  for (const close of [() => app.click('collapse-sidebar'), () => app.key('Escape'), () => app.click('sidebar-backdrop')]) {
    app.click('mobile-menu');
    state(app, { mobile: true, open: true });
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

// jsdom does not evaluate viewport media queries or run animations. Flatten
// matching CSSOM media rules, then let its CSS cascade resolve real selectors,
// specificity, shorthands and !important. No App source parsing is involved.
function cssFixture(t, mobile, reduced = false) {
  const dom = new JSDOM('<aside class="sidebar"></aside><button class="sidebar-backdrop"></button>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const source = document.createElement('style');
  source.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  document.head.append(source);
  function active(condition) {
    return condition.split(',').some(query => {
      if (/max-width:\s*(?:900|700|480|440)px/.test(query)) return mobile;
      if (/min-width:\s*701px/.test(query)) return !mobile;
      if (/prefers-reduced-motion:\s*reduce/.test(query)) return reduced;
      if (/forced-colors:\s*active/.test(query)) return false;
      if (/hover:\s*hover/.test(query)) return false;
      throw new Error(`Unhandled CSS media query: ${query}`);
    });
  }
  function flatten(rules) {
    return [...rules].flatMap(rule => {
      if (rule.type === dom.window.CSSRule.STYLE_RULE) return [rule.cssText];
      if (rule.type === dom.window.CSSRule.MEDIA_RULE && active(rule.conditionText)) return flatten(rule.cssRules);
      return [];
    });
  }
  const css = flatten(source.sheet.cssRules).join('\n');
  source.remove();
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  return (selector, className) => {
    const element = document.querySelector(selector);
    element.className = className;
    return dom.window.getComputedStyle(element);
  };
}

function milliseconds(value) { return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000); }
function transition(style, property, duration, delay) {
  const entries = style.transition.split(/,(?![^()]*\))/).map(value => value.trim());
  const index = entries.findIndex(value => value.split(/\s+/)[0] === property);
  assert.notEqual(index, -1, `${property} has an explicit transition: ${style.transition}`);
  const times = entries[index].match(/\b(?:\d*\.)?\d+m?s\b/g) || [];
  assert.equal(milliseconds(times[0] || '0s'), duration, `${property} duration`);
  const delays = style.transitionDelay.split(',').map(value => value.trim()).filter(Boolean);
  assert.equal(milliseconds(delays.length ? delays[index % delays.length] : times[1] || '0s'), delay, `${property} delay`);
}

test('desktop CSS animates layout without display:none or discrete display transitions', t => {
  const css = cssFixture(t, false);
  for (const open of [true, false, true]) {
    const style = css('.sidebar', open ? 'sidebar' : 'sidebar collapsed');
    assert.equal(style.display, 'flex');
    assert.equal(style.width, open ? '280px' : '0px');
    assert.equal(style.paddingLeft, open ? '12px' : '0px');
    assert.equal(style.paddingRight, open ? '12px' : '0px');
    assert.equal(style.marginRight, open ? '0px' : '-1px');
    assert.equal(style.opacity, open ? '1' : '0');
    assert.equal(style.overflowX, 'hidden');
    assert.equal(style.overflowY, 'hidden');
    assert.equal(style.visibility, open ? 'visible' : 'hidden');
    for (const property of ['width', 'padding', 'margin-right']) transition(style, property, 240, 0);
    transition(style, 'visibility', 0, open ? 0 : 240);
    assert.doesNotMatch(style.transition, /\b(?:display|allow-discrete)\b/);
  }
});

test('mobile CSS keeps the transform transition and resets the delayed visibility on reopen', t => {
  const css = cssFixture(t, true);
  for (const open of [false, true, false, true]) {
    const style = css('.sidebar', open ? 'sidebar open' : 'sidebar');
    assert.equal(style.display, 'flex');
    assert.equal(style.transform, open ? 'translateX(0)' : 'translateX(-100%)');
    assert.equal(style.visibility, open ? 'visible' : 'hidden');
    transition(style, 'transform', 240, 0);
    transition(style, 'visibility', 0, open ? 0 : 240);
  }
});

test('backdrop CSS fades in both directions, blocks clicks only while open, and does not animate mounts', t => {
  const css = cssFixture(t, true);
  for (const open of [false, true, false, true]) {
    const style = css('.sidebar-backdrop', open ? 'sidebar-backdrop open' : 'sidebar-backdrop');
    assert.notEqual(style.display, 'none');
    assert.equal(style.opacity, open ? '1' : '0');
    assert.equal(style.pointerEvents, open ? 'auto' : 'none');
    assert.equal(style.visibility, open ? 'visible' : 'hidden');
    transition(style, 'opacity', 180, 0);
    transition(style, 'visibility', 0, open ? 0 : 180);
    assert.ok(!style.animation || style.animation === 'none', 'no mount animation can override the opacity transition');
  }
});

test('global reduced-motion CSS disables transitions and animations for sidebar, backdrop and pseudo-elements', t => {
  for (const mobile of [false, true]) {
    const css = cssFixture(t, mobile, true);
    for (const className of ['sidebar', 'sidebar collapsed', 'sidebar open', 'sidebar-backdrop', 'sidebar-backdrop open']) {
      const style = css(className.startsWith('sidebar-backdrop') ? '.sidebar-backdrop' : '.sidebar', className);
      assert.equal(style.transition, 'none');
      assert.equal(style.animation, 'none');
      assert.equal(style.scrollBehavior, 'auto');
    }
  }
  const dom = new JSDOM('<style></style>');
  t.after(() => dom.window.close());
  const style = dom.window.document.querySelector('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  const rules = [...style.sheet.cssRules].filter(rule => rule.type === dom.window.CSSRule.MEDIA_RULE && /prefers-reduced-motion:\s*reduce/.test(rule.conditionText));
  assert.ok(rules.some(rule => [...rule.cssRules].some(rule => {
    const selectors = rule.selectorText?.split(',').map(value => value.trim()) || [];
    return ['*', '*::before', '*::after'].every(selector => selectors.includes(selector)) &&
      ['transition', 'animation'].every(property => rule.style.getPropertyValue(property) === 'none' && rule.style.getPropertyPriority(property) === 'important');
  })), 'global !important reduced-motion rule also covers pseudo-elements');
});

test('session pin and running indicator have independent columns beside truncated agent names', async t => {
  const app = await mount(t, false, [
    { id: 'sidebar-test', title: 'Test chat', messages: [] },
    { id: 'working-test', title: 'A very long running agent name that must not hide the indicator', messages: [], running: true },
  ]);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  app.click('agents-toggle');
  const style = app.window.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  app.window.document.head.append(style);
  const css = selector => app.window.getComputedStyle(app.window.document.querySelector(selector));
  const row = css('.session-row');
  assert.equal(row.paddingTop, '8px');
  assert.equal(row.paddingBottom, '8px');
  assert.equal(row.gridTemplateColumns, '22px minmax(0, 1fr) 14px repeat(2, 24px)');
  assert.equal(app.window.document.querySelector('.delete-session'), null);
  const pill = app.window.document.querySelector('.session-running-pill');
  assert.equal(pill.parentElement.className, 'session-row');
  assert.ok(pill.nextElementSibling.classList.contains('pin-session'));
  assert.equal(pill.nextElementSibling.disabled, false);
  act(() => pill.nextElementSibling.click());
  assert.deepEqual(JSON.parse(app.window.localStorage.getItem('sunday-pinned-agent-ids')), ['working-test']);
  assert.equal(css('.session-running-pill').gridColumn, '3');
  assert.equal(css('.session-running-pill').width, '14px');
  for (const [selector, column] of [['.session-item', '2'], ['.pin-session', '4'], ['.configure-session', '5']]) {
    const control = css(`.session-row ${selector}`);
    assert.equal(control.gridRow, '1');
    assert.equal(control.gridColumn, column);
    assert.notEqual(control.position, 'absolute');
  }
});

test('sessions are pinned as ordinary sessions and sidebar brand stays outside the scroller', async t => {
  const app = await mount(t, false, [
    { id: 'session-a', title: 'Session A', messages: [] },
    { id: 'session-b', title: 'Session B', messages: [] },
  ]);
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  app.click('agents-toggle');
  assert.ok(app.window.document.querySelector('.pin-session[data-agent-id="session-b"]'));
  const scroller = app.window.document.querySelector('.sidebar-scroll');
  assert.equal(scroller.contains(app.window.document.querySelector('.sidebar-brand')), false);
  assert.ok(scroller.contains(app.get('sessions-list')));
  assert.equal(app.window.document.getElementById('dashboard-link'), null);
});
