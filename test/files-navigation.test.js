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

test('Files route aliases preserve dirty and saving guards', () => {
  const source = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const currentPage = source.slice(source.indexOf('function currentPage()'), source.indexOf('function greeting'));
  const route = source.slice(source.indexOf('const route = () =>'), source.indexOf('const layout = matchMedia'));
  let page = 'editor', confirmations = 0, alerts = 0, discard = false, skillsExiting = false;
  let nextTimer = 0;
  const timers = new Map(), timerDelays = [];
  const context = {
    location: { hash: '#editor' }, editorDirty: { current: true }, editorSaving: { current: false },
    pageRef: { current: 'editor' }, skillsExitTimer: { current: null },
    setPage: next => { page = next; }, setSkillsExiting: value => { skillsExiting = value; },
    matchMedia: () => ({ matches: false }),
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

  context.pageRef.current = 'socials';
  context.location.hash = '#repositories'; navigate();
  assert.equal(page, 'repositories');
  assert.equal(timers.size, 0);

  context.pageRef.current = 'skills';
  context.location.hash = '#chat'; navigate();
  assert.equal(page, 'chat');
  assert.equal(skillsExiting, true);
  assert.equal(timerDelays.at(-1), 260);
  assert.equal(timers.size, 1, 'the Skills page stays mounted for its exit animation');
  context.location.hash = '#skills'; navigate();
  assert.equal(skillsExiting, false);
  assert.equal(timers.size, 0, 'navigating back cancels the pending Skills exit');
});

