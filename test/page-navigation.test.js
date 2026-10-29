import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
const currentPage = app.slice(app.indexOf('function currentPage()'), app.indexOf('function greeting'));

test('removed Files and Socials routes fall back to Chat; active routes remain available', () => {
  const routes = [
    ['#context', 'context'], ['#memory', 'context'], ['#context/skills', 'skills'],
    ['#scheduled-job', 'scheduled-job'], ['#repositories', 'repositories'], ['#mcp', 'mcp'],
    ['#files', 'chat'], ['#editor', 'chat'], ['#socials', 'chat'], ['#dashboard', 'chat'],
  ];
  for (const [hash, expected] of routes) {
    assert.equal(runInNewContext(`${currentPage}\ncurrentPage()`, { location: { hash } }), expected, hash);
  }
});

test('removed page UI, server endpoints, and editor-only dependencies are cleaned up', () => {
  const server = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /CodeEditor|Socials|id="editor-link"|id="socials-link"/);
  assert.doesNotMatch(server, /fileEditor|searchEditorFiles|openEditorRoot|checkEditorLocation/);
  assert.doesNotMatch(server, /['"]\/api\/files(?:\/search)?['"]|['"]\/api\/file['"]/);
  assert.doesNotMatch(packageJson, /codemirror/i);
});

test('page routes animate out, retain the latest destination, cancel reversals, and honor reduced motion', () => {
  const route = app.slice(app.indexOf('const route = () =>'), app.indexOf('const layout = matchMedia'));
  let page = 'chat', phase = 'enter', reducedMotion = false, nextTimer = 0;
  const timers = new Map(), timerDelays = [];
  const context = {
    location: { hash: '#chat' },
    pageRef: { current: 'chat' },
    pendingPage: { current: null },
    pageTransitionTimer: { current: null },
    setPage: next => { page = next; },
    setPagePhase: next => { phase = next; },
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      timerDelays.push(delay);
      return id;
    },
    clearTimeout: id => timers.delete(id),
  };
  const navigate = runInNewContext(`${currentPage}\n${route}\nroute`, context);
  const finishTransition = () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };

  context.location.hash = '#repositories';
  navigate();
  assert.equal(page, 'chat');
  assert.equal(phase, 'exit');
  assert.equal(timerDelays.at(-1), 140);
  context.location.hash = '#scheduled-job';
  navigate();
  assert.equal(context.pendingPage.current, 'scheduled-job');
  finishTransition();
  assert.equal(page, 'scheduled-job');
  assert.equal(phase, 'enter');

  context.location.hash = '#context/skills';
  navigate();
  assert.equal(phase, 'exit');
  context.location.hash = '#scheduled-job';
  navigate();
  assert.equal(phase, 'enter');
  assert.equal(timers.size, 0, 'returning to the active page cancels its exit');

  reducedMotion = true;
  context.location.hash = '#context/skills';
  navigate();
  assert.equal(page, 'skills');
  assert.equal(phase, 'enter');
  assert.equal(timers.size, 0, 'reduced motion skips the transition delay');
});
