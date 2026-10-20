import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BASIC_TOOLS } from '../src/server/tools.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// Execute the actual component body, replacing only imports and its JSX return.
// Effects run after render, with dependency comparisons and cleanup on rerender.
function mount(name, props, request, jsonRequest = async () => ({})) {
  const source = readFileSync(new URL(`../src/web/components/${name}.jsx`, import.meta.url), 'utf8');
  const body = source.slice(0, source.indexOf('  return <')).replace(/^import .*;\n/gm, '').replace('export default function', 'function')
    .replace(/const (dialog|titleInput) = useRef\(null\);/g, 'const $1 = useRef({ showModal() {}, focus() {} });');
  const bindings = [...body.matchAll(/const \[(\w+), (\w+)\] = useState/g)].flatMap(match => [match[1], match[2]]);
  const actions = [...body.matchAll(/(?:async )?function (\w+)\(/g)].map(match => match[1]).filter(value => value !== name && value !== 'keydown' && value !== 'poll');
  const slots = [], effects = [], timers = new Map(), timerDelays = [];
  let cursor = 0, dirty = false, nextTimer = 0, view;
  const context = vm.createContext({
    request, jsonRequest,
    document: { addEventListener() {}, removeEventListener() {} },
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
  }, async url => url === '/api/repos' ? repositories.promise : url.startsWith('/api/sessions/') ? { session: { config: { model: 'test', thinkingLevel: 'off' } } } : { personas: [{ id: 'sunday', name: 'Sunday' }] }, async (url, method, body) => {
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
  }, async url => url === '/api/repos' ? { repos: [{ name: 'demo' }] } : url.startsWith('/api/sessions/') ? { session: { config: { model: 'test', thinkingLevel: 'off' } } } : { personas: [{ id: 'sunday', name: 'Sunday' }] }, () => pendingSave.promise);
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
    "tools: ['subagent_create', 'subagent_send_prompt', 'subagent_list']",
    "tools: ['context_search', 'context_index', 'context_compress']",
    "tools: ['agent_list', 'agent_whisper']",
  ]) assert.ok(source.includes(names), `missing grouped tool entry ${names}`);
  assert.match(source, /class="repository-checkbox persona-tool-group"/);
  assert.match(source, /groupedTools\.map\(tool => tool\.name\)/);
  assert.doesNotMatch(source, /groupedTools\.map\(tool => <label/);
  assert.match(source, /tools\.filter\(tool => !toolGroups\.some/);
});

test('persona initial load defaults to the loaded registry, not stale state', async () => {
  const tools = [{ name: 'context_search', description: 'Search indexed context' }, { name: 'agent_whisper', description: 'Delegate' }];
  const h = mount('Personas', { toast() {} }, async () => ({ tools, personas: [{ id: 'default', name: 'Default' }] }));
  await h.settle();
  assert.deepEqual(Array.from(h.view.profile.allowedTools), tools.map(tool => tool.name));
  h.unmount();
});

function deleteConfigHarness(onDelete, extras = {}) {
  return mount('SessionConfig', {
    session: { id: 'delete-agent', title: 'Agent', allowedRepositories: [] },
    onDelete, onSaved() {}, onClose() {}, toast() { assert.fail('Deletion must not show a toast'); }, ...extras,
  }, async url => url === '/api/repos' ? { repos: [] } : url === '/api/sessions/delete-agent' ? { session: { config: { model: 'child-model', thinkingLevel: 'high' }, models: [{ id: 'child-model', thinkingLevels: ['off', 'high'] }] } } : { personas: [{ id: 'sunday', name: 'Sunday' }] });
}

test('agent settings loads and saves its own model and thinking without changing defaults', async () => {
  const calls = [];
  const h = mount('SessionConfig', {
    session: { id: 'child', title: 'Child' }, onSaved() {}, onClose() {}, toast() {},
  }, async url => {
    calls.push(url);
    if (url === '/api/personas') return { personas: [] };
    if (url === '/api/repos') return { repos: [] };
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
