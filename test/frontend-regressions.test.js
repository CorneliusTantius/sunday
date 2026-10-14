import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
  const body = source.slice(0, source.indexOf('  return <')).replace(/^import .*;\n/gm, '').replace('export default function', 'function');
  const bindings = [...body.matchAll(/const \[(\w+), (\w+)\] = useState/g)].flatMap(match => [match[1], match[2]]);
  const actions = [...body.matchAll(/(?:async )?function (\w+)\(/g)].map(match => match[1]).filter(value => value !== name && value !== 'keydown' && value !== 'poll');
  const slots = [], effects = [], timers = new Map();
  let cursor = 0, dirty = false, nextTimer = 0, view;
  const context = vm.createContext({
    request, jsonRequest,
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
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
      if (!slots[index]) slots[index] = { current: initial === null ? { showModal() {}, focus() {} } : initial };
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
    get view() { return view; }, render,
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
  assert.doesNotMatch(source, /window\.location\.(?:reload|replace)|onReload\(\)/);
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
  }, async url => url === '/api/repos' ? repositories.promise : { personas: [{ id: 'sunday', name: 'Sunday' }] }, async (url, method, body) => {
    assert.equal(url, '/api/sessions/session%2F1');
    assert.equal(method, 'PATCH');
    payload = body;
    if (body.allowedRepositories.some(name => name !== 'kept')) throw new Error('Unknown repository');
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
  }, async url => url === '/api/repos' ? { repos: [{ name: 'demo' }] } : { personas: [{ id: 'sunday', name: 'Sunday' }] }, () => pendingSave.promise);
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
