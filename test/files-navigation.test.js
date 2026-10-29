import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('Context route supports the current and legacy hash', () => {
  const source = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const currentPage = source.slice(source.indexOf('function currentPage()'), source.indexOf('function greeting'));
  assert.equal(runInNewContext(`${currentPage}\ncurrentPage()`, { location: { hash: '#context' } }), 'context');
  assert.equal(runInNewContext(`${currentPage}\ncurrentPage()`, { location: { hash: '#memory' } }), 'context');
  assert.equal(runInNewContext(`${currentPage}\ncurrentPage()`, { location: { hash: '#context/skills' } }), 'skills');
  assert.equal(runInNewContext(`${currentPage}\ncurrentPage()`, { location: { hash: '#dashboard' } }), 'chat');
});

test('page routes animate out before switching, preserve file guards, and honor reduced motion', () => {
  const source = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const currentPage = source.slice(source.indexOf('function currentPage()'), source.indexOf('function greeting'));
  const route = source.slice(source.indexOf('const route = () =>'), source.indexOf('const layout = matchMedia'));
  let page = 'editor', phase = 'enter', confirmations = 0, alerts = 0, discard = false, reducedMotion = false;
  let nextTimer = 0;
  const timers = new Map(), timerDelays = [];
  const context = {
    location: { hash: '#editor' }, editorDirty: { current: true }, editorSaving: { current: false },
    pageRef: { current: 'editor' }, pendingPage: { current: null }, pageTransitionTimer: { current: null },
    setPage: next => { page = next; }, setPagePhase: next => { phase = next; },
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, callback); timerDelays.push(delay); return id; },
    clearTimeout: id => timers.delete(id),
    window: { confirm: () => { confirmations++; return discard; }, alert: () => { alerts++; } },
    history: { replaceState: (_state, _title, hash) => { context.location.hash = hash; } },
  };
  const navigate = runInNewContext(`${currentPage}\n${route}\nroute`, context);
  const finishExit = () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };
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
  assert.equal(page, 'editor');
  assert.equal(phase, 'exit');
  assert.equal(timerDelays.at(-1), 140);
  finishExit();
  assert.equal(page, 'repositories');
  assert.equal(phase, 'enter');
  assert.equal(context.editorDirty.current, false);

  page = 'socials'; context.pageRef.current = 'socials';
  context.location.hash = '#repositories'; navigate();
  context.location.hash = '#scheduled-job'; navigate();
  assert.equal(page, 'socials');
  assert.equal(context.pendingPage.current, 'scheduled-job');
  finishExit();
  assert.equal(page, 'scheduled-job', 'rapid navigation switches to the latest requested page');

  page = 'skills'; context.pageRef.current = 'skills';
  context.location.hash = '#chat'; navigate();
  assert.equal(phase, 'exit');
  assert.equal(timers.size, 1);
  context.location.hash = '#context/skills'; navigate();
  assert.equal(phase, 'enter');
  assert.equal(timers.size, 0, 'returning to the current page cancels its pending exit');

  reducedMotion = true;
  context.location.hash = '#repositories'; navigate();
  assert.equal(page, 'repositories');
  assert.equal(phase, 'enter');
  assert.equal(timers.size, 0, 'reduced-motion preferences skip the transition delay');
});

