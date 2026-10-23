import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runInNewContext } from 'node:vm';

test('Context route supports the current and legacy hash', () => {
  const source = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const currentPage = source.slice(source.indexOf('function currentPage()'), source.indexOf('function greeting'));
  assert.equal(runInNewContext(`${currentPage}\ncurrentPage()`, { location: { hash: '#context' } }), 'context');
  assert.equal(runInNewContext(`${currentPage}\ncurrentPage()`, { location: { hash: '#memory' } }), 'context');
  assert.equal(runInNewContext(`${currentPage}\ncurrentPage()`, { location: { hash: '#context/skills' } }), 'skills');
});

test('Files route aliases preserve dirty and saving guards', () => {
  const source = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const currentPage = source.slice(source.indexOf('function currentPage()'), source.indexOf('function greeting'));
  const route = source.slice(source.indexOf('const route = () =>'), source.indexOf('const layout = matchMedia'));
  let page = 'editor', confirmations = 0, alerts = 0, discard = false, dashboardExiting = false;
  let nextTimer = 0;
  const timers = new Map(), timerDelays = [];
  const context = {
    location: { hash: '#editor' }, editorDirty: { current: true }, editorSaving: { current: false },
    pageRef: { current: 'editor' }, dashboardExitTimer: { current: null },
    setPage: next => { page = next; }, setDashboardExiting: value => { dashboardExiting = value; },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, callback); timerDelays.push(delay); return id; },
    clearTimeout: id => timers.delete(id),
    window: { confirm: () => { confirmations++; return discard; }, alert: () => { alerts++; } },
    history: { replaceState: (_state, _title, hash) => { context.location.hash = hash; } },
  };
  const navigate = runInNewContext(`${currentPage}\n${route}\nroute`, context);
  context.location.hash = '#files'; navigate();
  assert.equal(context.editorDirty.current, true);
  assert.equal(confirmations, 0);
  context.location.hash = '#repositories'; navigate();
  assert.equal(page, 'editor');
  assert.equal(context.location.hash, '#files');
  assert.equal(confirmations, 1);
  context.editorSaving.current = true;
  context.location.hash = '#repositories'; navigate();
  assert.equal(alerts, 1);
  assert.equal(confirmations, 1);
  assert.equal(page, 'editor');
  context.editorSaving.current = false;
  discard = true;
  context.location.hash = '#repositories'; navigate();
  assert.equal(page, 'repositories');
  assert.equal(context.editorDirty.current, false);

  context.pageRef.current = 'dashboard';
  context.location.hash = '#socials'; navigate();
  assert.equal(page, 'socials');
  assert.equal(dashboardExiting, true);
  assert.deepEqual(timerDelays, [380]);
  assert.equal(timers.size, 1);
  context.location.hash = '#dashboard'; navigate();
  assert.equal(dashboardExiting, false);
  assert.equal(timers.size, 0, 'a subsequent route cancels the pending exit cleanup');
});

test('Files is a top-level navigation item matching Repositories', t => {
  const source = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const repos = source.match(/<a class="([^"]+)" id="repos-link"/)[1];
  const files = source.match(/<a class="([^"]+)" id="editor-link" href="#files"/)[1];
  assert.match(source, /href="#files"[^>]*><MenuIcon name="files" \/><span>Files<\/span><\/a>/);
  const dom = new JSDOM(`<aside class="sidebar"><section class="agents-feature"></section><a id="repos" class="${repos}">Repositories</a><a id="files" class="${files}">Files</a></aside>
    <section class="code-editor-page"><div class="code-editor-layout"><aside class="code-editor-sidebar"></aside><div class="code-editor-main"><div class="code-editor-host"></div></div></div></section>`);
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const css = id => dom.window.getComputedStyle(dom.window.document.getElementById(id));
  for (const property of ['fontSize', 'fontWeight', 'padding', 'marginLeft', 'marginTop']) {
    assert.equal(css('files')[property], css('repos')[property], property);
  }
  const layout = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
  for (const selector of ['.code-editor-page', '.code-editor-layout', '.code-editor-main', '.code-editor-host']) {
    assert.equal(layout(selector).minHeight, '0px', selector);
    assert.equal(layout(selector).display, selector === '.code-editor-host' ? 'block' : 'flex', selector);
  }
  assert.equal(layout('.code-editor-sidebar').width, '260px');
  assert.equal(layout('.code-editor-sidebar').overflow, 'auto');
  assert.equal(layout('.code-editor-host').overflow, 'hidden');
});
