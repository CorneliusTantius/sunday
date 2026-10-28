import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BASIC_TOOLS } from '../src/server/tools.js';
import { CONTEXT_GRAPH_HEIGHT, CONTEXT_GRAPH_WIDTH, animateContextGraph, layoutContextGraph } from '../src/web/context-graph.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// Execute the actual component body, replacing only imports and its JSX return.
// Effects run after render, with dependency comparisons and cleanup on rerender.
function mount(name, props, request, jsonRequest = async () => ({}), globals = {}) {
  const source = readFileSync(new URL(`../src/web/components/${name}.jsx`, import.meta.url), 'utf8');
  const body = source.slice(0, source.indexOf('  return <')).replace(/^import .*;\n/gm, '').replace('export default function', 'function')
    .replace(/const (dialog|titleInput) = useRef\(null\);/g, 'const $1 = useRef({ showModal() {}, focus() {} });');
  const bindings = [...body.matchAll(/const \[(\w+), (\w+)\] = useState/g)].flatMap(match => [match[1], match[2]]);
  const actions = [...body.matchAll(/(?:async )?function (\w+)\(/g)].map(match => match[1]).filter(value => value !== name && !['keydown', 'load', 'onKeyDown', 'poll'].includes(value));
  const slots = [], effects = [], timers = new Map(), timerDelays = [];
  let cursor = 0, dirty = false, nextTimer = 0, view;
  const context = vm.createContext({
    request, jsonRequest, CONTEXT_GRAPH_HEIGHT, CONTEXT_GRAPH_WIDTH, animateContextGraph, layoutContextGraph,
    document: { addEventListener() {}, removeEventListener() {} },
    ...globals,
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, fn); timerDelays.push(ms); return id; },
    clearTimeout(id) { timers.delete(id); },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        slots[index] = { deps, value: fn() };
      }
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        slots[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  });
  const component = vm.runInContext(`${body}\nreturn { ${[...bindings, ...actions].join(', ')} };\n}\n${name}`, context);
  function render() {
    do {
      dirty = false; cursor = 0;
      view = component(props);
      while (effects.length) effects.shift()();
    } while (dirty);
    return view;
  }
  render();
  return {
    get view() { return view; }, render, timerDelays,
    get pendingTimers() { return timers.size; },
    async settle() { await flush(); render(); await flush(); render(); },
    async tick() {
      const pending = [...timers.values()]; timers.clear();
      for (const fn of pending) fn();
      await this.settle();
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

const settings = {
  provider: 'openai', mode: 'oauth', model: 'saved', thinkingLevel: 'off', oauthConnected: true,
  providers: [{ id: 'openai', oauthConnected: true, hasApiKey: true }],
  models: [{ id: 'saved', thinkingLevels: ['off', 'high'] }, { id: 'draft', thinkingLevels: ['off', 'high'] }],
};
function settingsHarness(status) {
  const calls = [];
  const harness = mount('Settings', { settings, onClose() {}, onReload() {}, toast() {} }, async url => {
    calls.push(url);
    return url === '/api/auth/status' ? status() : settings;
  });
  return { harness, calls };
}
const authCalls = calls => calls.filter(url => url === '/api/auth/status');
const refreshCalls = calls => calls.filter(url => url.startsWith('/api/settings'));

test('Settings saves chat defaults without closing and shows a toast', async () => {
  const calls = [], toasts = [];
  let closed = 0;
  const configSettings = {
    ...settings,
    connectedModels: [{ id: 'saved', provider: 'openai', mode: 'oauth', thinkingLevels: ['off', 'high'] }],
  };
  const h = mount('Settings', {
    settings: configSettings, onClose() { closed++; }, onReload() {}, toast(message) { toasts.push(message); },
  }, async () => configSettings, async (...args) => { calls.push(args); });
  await h.settle();
  h.view.openConfig(); h.render();
  await h.view.save(); await h.settle();
  assert.equal(calls[0][0], '/api/settings');
  assert.equal(calls[0][1], 'PUT');
  assert.equal(closed, 0);
  assert.equal(h.view.page, 'config');
  assert.deepEqual(toasts, ['Settings saved']);
  h.unmount();
});

test('Repositories Pull all attempts every repository and reports partial failures', async () => {
  const source = readFileSync(new URL('../src/web/components/Repositories.jsx', import.meta.url), 'utf8');
  assert.match(source, /id="pull-all-repos"/);
  assert.match(source, /onClick=\{syncAll\}/);
  const repos = [{ name: 'one' }, { name: 'two' }], pulls = [], toasts = [];
  const h = mount('Repositories', { toast(message) { toasts.push(message); } }, async () => ({ repos }), async (url, method, body) => {
    pulls.push({ url, method, body });
    if (pulls.length === 1) throw new Error('No upstream');
    return {};
  });
  await h.settle();
  await h.view.syncAll(); await h.settle();
  assert.deepEqual(pulls.map(pull => pull.url), ['/api/repos/one/pull', '/api/repos/two/pull']);
  assert.equal(h.view.status, 'Could not pull one: No upstream');
  assert.equal(h.view.syncingAll, false);
  assert.deepEqual(toasts, ['Pulled 1 of 2 repositories']);
  h.unmount();
});

test('Repositories auto-pull is opt-in, persists its preference, and only pulls clean main repositories', async () => {
  const storage = new Map();
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  };
  const repos = [
    { name: 'clean-main', branch: 'main', gitStatus: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } },
    { name: 'dirty-main', branch: 'main', gitStatus: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 } },
    { name: 'clean-feature', branch: 'feature', gitStatus: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } },
    { name: 'unknown-status', branch: 'main', gitStatus: null },
    { name: 'incomplete-status', branch: 'main', gitStatus: {} },
  ];
  const requests = [], pulls = [];
  const h = mount('Repositories', { toast() {} }, async url => {
    requests.push(url);
    return { repos };
  }, async (url, method, body) => {
    pulls.push({ url, method, body });
    return {};
  }, { localStorage });
  await h.settle();
  assert.equal(h.pendingTimers, 0, 'automatic pulling is disabled by default');
  h.view.toggleAutoPull({ currentTarget: { checked: true } });
  await h.settle();
  assert.equal(storage.get('sunday-repositories-auto-pull'), 'true');
  assert.deepEqual(h.timerDelays, [5 * 60 * 1000]);

  await h.tick();
  assert.deepEqual(pulls.map(({ url, method }) => ({ url, method })), [{ url: '/api/repos/clean-main/pull', method: 'POST' }]);
  assert.equal(h.view.autoPullStatus, 'Auto-pull checked 1 clean main-branch repository (4 skipped).');
  assert.equal(h.view.autoPulling, false);
  assert.equal(h.pendingTimers, 1, 'the next check is scheduled after the current pull cycle finishes');
  h.view.toggleAutoPull({ currentTarget: { checked: false } });
  h.render();
  assert.equal(storage.get('sunday-repositories-auto-pull'), 'false');
  assert.equal(h.pendingTimers, 0, 'disabling automatic pulling cancels the pending check');
  h.unmount();
});

test('Repositories automatic pull locks out manual pulls while the check is running', async () => {
  const gate = deferred();
  const repos = [{ name: 'clean-main', branch: 'main', gitStatus: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } }];
  let repoRequests = 0;
  const pulls = [];
  const h = mount('Repositories', { toast() {} }, async url => {
    if (url === '/api/repos' && ++repoRequests === 2) return gate.promise;
    return { repos };
  }, async url => { pulls.push(url); return {}; });
  await h.settle();

  const running = h.view.autoPull();
  await flush(); h.render();
  assert.equal(h.view.autoPulling, true);
  await h.view.sync(repos[0]);
  assert.deepEqual(pulls, [], 'a manual pull cannot overlap the automatic pull cycle');

  gate.resolve({ repos });
  await running; await h.settle();
  assert.deepEqual(pulls, ['/api/repos/clean-main/pull']);
  assert.equal(h.view.autoPulling, false);
  h.unmount();
});

test('Repositories automatic pull continues after an individual repository fails', async () => {
  const repos = ['first', 'second'].map(name => ({
    name, branch: 'main', gitStatus: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  }));
  const pulls = [];
  const h = mount('Repositories', { toast() {} }, async () => ({ repos }), async url => {
    pulls.push(url);
    if (url.includes('/first/')) throw new Error('Network unavailable');
    return {};
  });
  await h.settle();

  await h.view.autoPull(); await h.settle();
  assert.deepEqual(pulls, ['/api/repos/first/pull', '/api/repos/second/pull']);
  assert.equal(h.view.autoPullStatus, 'Auto-pull checked 2; 1 completed; failed: first: Network unavailable.');
  assert.equal(h.view.autoPulling, false);
  h.unmount();
});

test('Repositories reads a saved automatic-pull preference', async () => {
  const storage = new Map([['sunday-repositories-auto-pull', 'true']]);
  const h = mount('Repositories', { toast() {} }, async () => ({ repos: [] }), async () => ({}), {
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, value); } },
  });
  await h.settle();
  assert.equal(h.view.autoPullEnabled, true);
  assert.equal(h.pendingTimers, 1);
  assert.match(h.view.autoPullStatus, /every 5 minutes while this page is open/);
  h.unmount();
});

test('Settings exposes an Update action that only posts to the pull endpoint', () => {
  const source = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
  assert.match(source, /id="settings-update-nav"/);
  assert.match(source, /id="settings-update-page"/);
  assert.match(source, /id="update-app"/);
  assert.match(source, /jsonRequest\('\/api\/update', 'POST', \{\}\)/);
  assert.match(source, /disabled=\{updating\}/);
  assert.match(source, /updating \? 'Updating…'/);
  assert.match(source, /toast\('Update complete'\)/);
  assert.match(source, /id="update-output"/);
  assert.match(source, /catch \(error\) \{ if \(alive\.current\) setError\(error\.message\); \}/);
  assert.doesNotMatch(source.slice(source.indexOf('  async function update()'), source.indexOf('  return <div ref={backdrop}')), /window\.location\.(?:reload|replace)|onReload\(\)/);
  assert.match(source, /id="restart-app"/);
  assert.match(source, /Install dependencies, build, and restart Sunday/);
  assert.match(source, /setUpdateOutput\('Installing dependencies…'\)/);
  assert.match(source, /Runs npm install, builds, and restarts the server/);
  assert.match(source, /jsonRequest\('\/api\/restart', 'POST', \{\}\)/);
});

test('Settings polls only on OpenAI OAuth connect, not Config or API key', async () => {
  const { harness: h, calls } = settingsHarness(() => ({ status: 'pending' }));
  await h.settle();
  assert.equal(authCalls(calls).length, 0, 'providers page must not poll');
  h.view.openConfig(); h.render(); await h.settle(); await h.tick();
  assert.equal(authCalls(calls).length, 0, 'Config must not poll');
  h.view.navigate('connect'); h.view.chooseProvider('openai', 'api_key'); h.render(); await h.settle();
  assert.equal(authCalls(calls).length, 0, 'API key must not poll');
  h.view.chooseProvider('anthropic', 'api_key'); h.render(); await h.settle();
  assert.equal(authCalls(calls).length, 0, 'other providers must not poll');
  h.view.chooseProvider('openai', 'oauth'); h.render(); await h.settle();
  assert.equal(authCalls(calls).length, 1);
  h.unmount();
});

test('Settings existing done does not reload or refresh', async () => {
  const { harness: h, calls } = settingsHarness(() => ({ status: 'done' }));
  await h.settle();
  h.view.navigate('connect'); h.render(); await h.settle();
  assert.equal(authCalls(calls).length, 1);
  assert.equal(refreshCalls(calls).length, 0);
  h.unmount();
});

test('Settings pending to done reloads and refreshes once', async () => {
  let status = 'pending';
  const { harness: h, calls } = settingsHarness(() => ({ status }));
  h.view.navigate('connect'); h.render(); await h.settle();
  assert.equal(refreshCalls(calls).length, 0);
  status = 'done'; await h.tick();
  assert.deepEqual(refreshCalls(calls), ['/api/settings', '/api/settings?provider=openai&mode=oauth']);
  await h.tick();
  assert.equal(refreshCalls(calls).length, 2);
  h.unmount();
});

test('Settings explicitly started attempt may refresh when first status is done', async () => {
  const { harness: h, calls } = settingsHarness(() => ({ status: 'done' }));
  h.view.navigate('connect'); h.render(); await h.settle();
  calls.length = 0;
  await h.view.authAction('/api/auth/start'); h.render(); await h.settle();
  assert.equal(authCalls(calls).length, 1);
  assert.deepEqual(refreshCalls(calls), ['/api/settings', '/api/settings?provider=openai&mode=oauth']);
  h.unmount();
});

for (const stage of ['status', 'reload', 'refresh']) {
  test(`Settings late auth ${stage} cannot overwrite Config draft`, async () => {
    const late = deferred();
    let statusCount = 0, held = false, armed = false;
    const calls = [];
    const h = mount('Settings', { settings, onClose() {}, onReload() {}, toast() {} }, async url => {
      calls.push(url);
      if (url === '/api/auth/status') {
        if (++statusCount === 1) return { status: 'pending' };
        if (stage === 'status') return late.promise;
        return { status: 'done' };
      }
      if (armed && !held && ((stage === 'reload' && url === '/api/settings') || (stage === 'refresh' && url.includes('?')))) {
        held = true; return late.promise;
      }
      return settings;
    });
    h.view.navigate('connect'); h.render(); await h.settle();
    armed = true; await h.tick();
    h.view.openConfig(); h.render(); await h.settle();
    h.view.setModel('draft'); h.view.setThinking('high'); h.render();
    const before = calls.length;
    late.resolve(stage === 'status' ? { status: 'done' } : settings);
    await h.settle();
    assert.equal(h.view.model, 'draft');
    assert.equal(h.view.thinking, 'high');
    assert.equal(calls.length, before, 'stale completion must not start another refresh');
    h.unmount();
  });
}

test('SessionConfig removes missing repositories after fetch and saves accepted names', async () => {
  const repositories = deferred();
  let payload, saved = 0, closed = 0;
  const h = mount('SessionConfig', {
    session: { id: 'session/1', title: 'Chat', allowedRepositories: ['kept', 'deleted'] },
    onSaved() { saved++; }, onClose() { closed++; }, toast() {},
  }, async url => url === '/api/repos?namesOnly=1' ? repositories.promise : url.startsWith('/api/sessions/') ? { session: { config: { model: 'test', thinkingLevel: 'off' } } } : { personas: [{ id: 'sunday', name: 'Sunday' }] }, async (url, method, body) => {
    if (url === '/api/sessions/session%2F1') {
      assert.equal(method, 'PATCH');
      payload = body;
      if (body.allowedRepositories.some(name => name !== 'kept')) throw new Error('Unknown repository');
    } else assert.fail(`Unexpected settings write: ${url}`);
  });
  assert.equal(h.view.busy, true);
  repositories.resolve({ repos: [{ name: 'kept' }, { name: 'other' }] });
  await h.settle();
  assert.deepEqual(Array.from(h.view.allowed), ['kept']);
  await h.view.save({ preventDefault() {} }); await h.settle();
  assert.deepEqual(Array.from(payload.allowedRepositories), ['kept']);
  assert.equal(h.view.error, '');
  assert.equal(saved, 1); assert.equal(closed, 1);
  h.unmount();
});

test('SessionConfig shows workspace copy progress while saving', async () => {
  const pendingSave = deferred();
  const h = mount('SessionConfig', {
    session: { id: 'agent-session', title: 'Agent', allowedRepositories: [] },
    onSaved() {}, onClose() {}, toast() {},
  }, async url => url === '/api/repos?namesOnly=1' ? { repos: [{ name: 'demo' }] } : url.startsWith('/api/sessions/') ? { session: { config: { model: 'test', thinkingLevel: 'off' } } } : { personas: [{ id: 'sunday', name: 'Sunday' }] }, () => pendingSave.promise);
  await h.settle();
  const save = h.view.save({ preventDefault() {} });
  h.render();
  assert.equal(h.view.saving, true);
  pendingSave.resolve({});
  await save; await h.settle();
  assert.equal(h.view.saving, false);
  h.unmount();
});

test('Settings update prevents duplicate requests, reports output, and releases controls', async () => {
  const pending = deferred(), calls = [], toasts = [];
  let reloads = 0;
  const h = mount('Settings', { settings, onClose() {}, onReload() { reloads++; }, toast(message) { toasts.push(message); } }, async () => settings,
    (url, method, body) => { calls.push({ url, method, body }); return pending.promise; });
  await h.settle();
  h.view.navigate('update'); h.render();
  const run = h.view.update(); h.render();
  assert.equal(h.view.updating, true);
  await h.view.update();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/update');
  assert.equal(calls[0].method, 'POST');
  assert.equal(Object.keys(calls[0].body).length, 0);
  pending.resolve({ output: 'Already up to date.' });
  await run; await h.settle();
  assert.equal(h.view.updating, false);
  assert.equal(h.view.updateOutput, 'Already up to date.');
  assert.deepEqual(toasts, ['Update complete']);
  assert.equal(reloads, 0);
  h.unmount();
});

test('Settings update displays git errors and permits retry', async () => {
  let calls = 0;
  const h = mount('Settings', { settings, onClose() {}, onReload() {}, toast() {} }, async () => settings,
    async () => { calls++; if (calls === 1) throw new Error('Git pull failed'); return { output: 'Updated' }; });
  await h.settle();
  await h.view.update(); await h.settle();
  assert.equal(h.view.error, 'Git pull failed');
  assert.equal(h.view.updating, false);
  await h.view.update(); await h.settle();
  assert.equal(calls, 2);
  assert.equal(h.view.error, '');
  assert.equal(h.view.updateOutput, 'Updated');
  h.unmount();
});

test('persona permissions use the tool registry and preserve explicit whitelists', async () => {
  const tools = BASIC_TOOLS.map(({ name, description }) => ({ name, description }));
  const personas = [{ id: 'empty', name: 'No tools', allowedTools: [] }, { id: 'reader', name: 'Reader', allowedTools: ['read'] }, { id: 'default', name: 'All tools' }];
  const h = mount('Personas', { toast() {} }, async () => ({ tools, personas }));
  await h.settle();
  assert.deepEqual(Array.from(h.view.tools, tool => tool.name), tools.map(tool => tool.name));
  assert.deepEqual(Array.from(h.view.profile.allowedTools), []);
  h.view.select(personas, 'reader'); h.render();
  assert.deepEqual(Array.from(h.view.profile.allowedTools), ['read']);
  h.view.setToolAllowed('edit', true); h.render();
  assert.deepEqual(Array.from(h.view.profile.allowedTools), ['read', 'edit']);
  h.view.setToolAllowed('read', false); h.render();
  assert.deepEqual(Array.from(h.view.profile.allowedTools), ['edit']);
  h.view.select(personas, 'default'); h.render();
  assert.deepEqual(Array.from(h.view.profile.allowedTools), tools.map(tool => tool.name));
  h.view.select(personas, ''); h.render();
  assert.deepEqual(Array.from(h.view.profile.allowedTools), tools.map(tool => tool.name));
  h.unmount();
});

test('persona tool whitelist gives each related tool group a single checkbox', () => {
  const source = readFileSync(new URL('../src/web/components/Personas.jsx', import.meta.url), 'utf8');
  for (const names of [
    "tools: ['read', 'find', 'edit']",
    "tools: ['context_search', 'context_index', 'context_links', 'context_link', 'context_unlink']",
  ]) assert.ok(source.includes(names), `missing grouped tool entry ${names}`);
  assert.doesNotMatch(source, /subagent|agent_whisper|agent_list/);
  assert.match(source, /<fieldset class="grid gap-2"><legend class="sr-only">Tool permissions<\/legend>/);
  assert.match(source, /<input class="checkbox checkbox-primary rounded-md" type="checkbox" value=\{group\.name\}/);
  assert.match(source, /groupedTools\.map\(tool => tool\.name\)/);
  assert.match(source, /groupedTools\.map\(tool => <li key=\{tool\.name\}><code>\{tool\.name\}<\/code>:/);
  assert.match(source, /<li><code>\{tool\.name\}<\/code>:/);
  assert.match(source, /<strong>\{tool\.name === 'bash' \? 'Bash' : tool\.name\}<\/strong>/);
  assert.match(source, /shortToolDescription\(tool\.description\)/);
  assert.doesNotMatch(source, /groupedTools\.map\(tool => <label/);
  assert.match(source, /tools\.filter\(tool => !toolGroups\.some/);
});

test('context source indexing opens in an accessible modal', () => {
  const source = readFileSync(new URL('../src/web/components/Memory.jsx', import.meta.url), 'utf8');
  assert.match(source, /＋ Index a source/);
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="context-index-title"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /sourceInput\.current\?\.focus\(\)/);
  assert.match(source, /trigger\?\.focus\(\)/);
  assert.doesNotMatch(source, /<form class="context-panel context-index-form"/);
});

test('context notes load, create, and remove directed links', async () => {
  const sources = [{ id: 'a', source: 'notes/a.md', title: 'A' }, { id: 'b', source: 'notes/b.md', title: 'B' }];
  const selected = { ...sources[0], scope: 'shared', content: 'Note A' };
  let links = [];
  let graph = { nodes: sources, links };
  const calls = [], writes = [];
  const h = mount('Memory', { toast() {} }, async url => {
    calls.push(url);
    if (url === '/api/context/sources') return { sources };
    if (url === '/api/context/graph') return graph;
    if (url === '/api/context/sources/a') return { source: selected };
    if (url.startsWith('/api/context/links?source=')) return { links };
    assert.fail(`Unexpected request: ${url}`);
  }, async (url, method, body) => {
    writes.push({ url, method, body });
    if (method === 'POST') links = [{ source: body.source, target: body.target, relation: body.relation }];
    else links = [];
    graph = { ...graph, links };
    return {};
  });
  await h.settle();
  assert.deepEqual(Array.from(h.view.links), []);
  assert.deepEqual(Array.from(h.view.graph.nodes, node => node.source), ['notes/a.md', 'notes/b.md']);
  h.view.setLinkTarget('notes/b.md'); h.render();
  await h.view.linkSource({ preventDefault() {} });
  h.render();
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { url: '/api/context/links', method: 'POST', body: { source: 'notes/a.md', target: 'notes/b.md', relation: 'related' } });
  assert.equal(h.view.links[0].target, 'notes/b.md');
  assert.equal(h.view.graph.links[0].target, 'notes/b.md');
  await h.view.unlinkSource(h.view.links[0]);
  h.render();
  assert.deepEqual(JSON.parse(JSON.stringify(writes[1])), { url: '/api/context/links', method: 'DELETE', body: { source: 'notes/a.md', target: 'notes/b.md' } });
  assert.deepEqual(Array.from(h.view.links), []);
  assert.deepEqual(Array.from(h.view.graph.links), []);
  h.unmount();
});

test('context graph animates on load and cancels when reduced motion is enabled', async () => {
  const nodes = [{ id: 'a', source: 'a.md', title: 'A' }];
  const frames = new Map(); let nextFrame = 0, listener;
  const media = { matches: false, addEventListener(_type, fn) { listener = fn; }, removeEventListener() { listener = null; } };
  const browser = {
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia: () => media,
  };
  const h = mount('Memory', { toast() {} }, async url => {
    if (url === '/api/context/graph') return { nodes, links: [] };
    if (url === '/api/context/sources') return { sources: [] };
    assert.fail(`Unexpected request: ${url}`);
  }, undefined, { window: browser });
  await h.settle();
  assert.equal(h.view.graphAnimation.progress, 0);
  function step(time) { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(time); h.render(); }
  step(100); step(800);
  assert.equal(h.view.graphAnimation.progress, 0.5);
  media.matches = true; listener(); h.render();
  assert.equal(h.view.graphAnimation.progress, 1);
  assert.equal(frames.size, 0);
  h.unmount();
});

test('context graph skips animation when reduced motion is already enabled', async () => {
  let frames = 0;
  const browser = { requestAnimationFrame() { frames++; }, matchMedia: () => ({ matches: true }) };
  const h = mount('Memory', { toast() {} }, async url => url === '/api/context/graph'
    ? { nodes: [{ id: 'a', source: 'a.md', title: 'A' }], links: [] }
    : { sources: [] }, undefined, { window: browser });
  await h.settle();
  assert.equal(frames, 0);
  assert.equal(h.view.graphAnimation.progress, 1);
  h.unmount();
});

test('context page opens on graph and hides notes until the Notes view is selected', () => {
  const source = readFileSync(new URL('../src/web/components/Memory.jsx', import.meta.url), 'utf8');
  assert.match(source, /const \[graphOpen, setGraphOpen\] = useState\(true\)/);
  assert.match(source, /const \[graphOpen, setGraphOpen\] = useState\(true\)/);
  assert.match(source, /aria-pressed=\{!graphOpen\} onClick=\{\(\) => setGraphOpen\(false\)\}>Notes list/);
  assert.match(source, /\{graphOpen && <section class="card card-bordered bg-base-200 p-5 mb-4"/);
  assert.match(source, /\{!graphOpen && <div class="grid gap-4 lg:grid-cols-/);
  assert.match(source, /Select a dot, then switch to Notes to read it/);
});

test('context notes show an Obsidian-style dot graph and selected-note link controls', () => {
  const source = readFileSync(new URL('../src/web/components/Memory.jsx', import.meta.url), 'utf8');
  assert.match(source, /layoutContextGraph\(graph\.nodes, graph\.links\)/);
  assert.match(source, /<svg class="block h-\[min\(620px,65vh\)\] min-h-90 w-full select-none"[^>]*role="group" aria-label="Connected notes graph"/);
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /<circle r=\{radius\} fill=\{isActive \? 'var\(--color-primary\)'/);
  assert.match(source, /<title>\{`\$\{node\.title\} — \$\{node\.source\}`\}<\/title>/);
  assert.doesNotMatch(source, /Graph zoom controls|startGraphPan|graphView|graphPositions/);
  assert.match(source, /aria-label={`Open note: \$\{node\.title\}`}/);
  assert.match(source, /Linked notes/);
  assert.match(source, /aria-label="Relationship"/);
  assert.match(source, /link\.source === selected\.source \? link\.target : link\.source/);
});

test('persona initial load defaults to the loaded registry, not stale state', async () => {
  const tools = [{ name: 'context_search', description: 'Search indexed context' }];
  const h = mount('Personas', { toast() {} }, async () => ({ tools, personas: [{ id: 'default', name: 'Default' }] }));
  await h.settle();
  assert.deepEqual(Array.from(h.view.profile.allowedTools), tools.map(tool => tool.name));
  h.unmount();
});

function deleteConfigHarness(onDelete, extras = {}) {
  return mount('SessionConfig', {
    session: { id: 'delete-agent', title: 'Agent', allowedRepositories: [] },
    onDelete, onSaved() {}, onClose() {}, toast() { assert.fail('Deletion must not show a toast'); }, ...extras,
  }, async url => url === '/api/repos?namesOnly=1' ? { repos: [] } : url === '/api/sessions/delete-agent' ? { session: { config: { model: 'child-model', thinkingLevel: 'high' }, models: [{ id: 'child-model', thinkingLevels: ['off', 'high'] }] } } : { personas: [{ id: 'sunday', name: 'Sunday' }] });
}

test('agent settings loads and saves its own model and thinking without changing defaults', async () => {
  const calls = [];
  const h = mount('SessionConfig', {
    session: { id: 'child', title: 'Child' }, onSaved() {}, onClose() {}, toast() {},
  }, async url => {
    calls.push(url);
    if (url === '/api/personas') return { personas: [] };
    if (url === '/api/repos?namesOnly=1') return { repos: [] };
    assert.equal(url, '/api/sessions/child');
    return { session: { config: { model: 'child-model', thinkingLevel: 'high' }, models: [{ id: 'child-model', thinkingLevels: ['off', 'high'] }] } };
  }, async (url, method, body) => {
    calls.push(url);
    assert.equal(url, '/api/sessions/child');
    assert.equal(method, 'PATCH');
    assert.equal(body.config.model, 'child-model');
    assert.equal(body.config.thinkingLevel, 'high');
  });
  await h.settle();
  assert.equal(h.view.model, 'child-model');
  assert.equal(h.view.thinking, 'high');
  await h.view.save({ preventDefault() {} });
  assert.ok(!calls.includes('/api/settings'));
  h.unmount();
});

test('agent deletion requires a second click after a three-second wait and prevents duplicate requests', async () => {
  const pending = deferred();
  let deletions = 0;
  const h = deleteConfigHarness(session => {
    assert.equal(session.id, 'delete-agent');
    deletions++;
    return pending.promise;
  });
  await h.settle();
  h.view.armDelete(); h.view.armDelete(); h.render();
  assert.equal(h.view.deleteArmed, true);
  assert.equal(h.view.deleteReady, false);
  assert.equal(h.view.deleteCountdown, 3);
  assert.deepEqual(h.timerDelays, [1000]);
  h.view.armDelete(); await h.view.deleteSession();
  assert.equal(deletions, 0, 'Clicks during countdown cannot delete');
  for (const remaining of [2, 1, 0]) {
    await h.tick();
    assert.equal(h.view.deleteCountdown, remaining);
    assert.equal(h.view.deleteReady, remaining === 0);
    if (remaining > 0) { h.view.armDelete(); await h.view.deleteSession(); }
    assert.equal(deletions, 0, 'Countdown never automatically deletes');
  }
  assert.deepEqual(h.timerDelays, [1000, 1000, 1000]);
  h.view.armDelete(); h.view.armDelete(); h.render();
  assert.equal(deletions, 1);
  assert.equal(h.view.deleting, true);
  pending.resolve(); await h.settle();
  h.unmount();
});

test('delete confirmation is cleared on close, save and unmount', async () => {
  for (const action of ['close', 'save', 'unmount']) {
    const h = deleteConfigHarness(() => assert.fail('Cancelled confirmation cannot delete'), { toast() {} });
    await h.settle();
    h.view.armDelete(); h.render();
    await h.tick();
    assert.equal(h.view.deleteCountdown, 2);
    assert.equal(h.pendingTimers, 1);
    if (action === 'unmount') h.unmount();
    else if (action === 'save') await h.view.save({ preventDefault() {} });
    else h.view.close();
    assert.equal(h.pendingTimers, 0, action);
    if (action !== 'unmount') {
      await h.settle(); await h.tick();
      assert.equal(h.view.deleteReady, false);
      assert.equal(h.view.deleteArmed, false);
      assert.equal(h.view.deleteCountdown, 0);
      h.unmount();
    }
  }
});

test('delete failure stays inline and requires a fresh confirmation before retrying', async () => {
  let deletions = 0;
  const h = deleteConfigHarness(async () => { deletions++; throw new Error('Unable to delete agent'); });
  await h.settle();
  h.view.armDelete(); h.render();
  await h.tick(); await h.tick(); await h.tick();
  h.view.armDelete(); await h.settle();
  assert.equal(deletions, 1);
  assert.equal(h.view.error, 'Unable to delete agent');
  assert.equal(h.view.deleting, false);
  assert.equal(h.view.deleteReady, false);
  assert.equal(h.view.deleteArmed, false);
  h.view.armDelete(); h.render();
  assert.equal(h.view.deleteReady, false);
  assert.equal(deletions, 1);
  h.unmount();
});

test('agent settings contains the timed delete control without a native confirmation popup', () => {
  const component = readFileSync(new URL('../src/web/components/SessionConfig.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  assert.match(component, /id="delete-session-config" type="button"/);
  assert.match(component, /deleteArmed && !deleteReady/);
  assert.match(component, /Wait \$\{deleteCountdown\}s…/);
  assert.match(component, /Confirm delete/);
  assert.match(app, /onDelete=\{deleteSession\}/);
  assert.doesNotMatch(app.slice(app.indexOf('  async function deleteSession('), app.indexOf('  function togglePinnedAgent(')), /window\.confirm|toast\(/);
  assert.doesNotMatch(app, /class="icon-button session-action delete-session"/);
});
