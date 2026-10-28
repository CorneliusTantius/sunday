import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

// Run the actual component logic, omitting JSX and mocking only hooks/CodeMirror.
function mount({ request, loadLanguage = async () => [], localStorage = storage(), jsonRequest = async () => ({}), onDirtyChange = () => {}, onSavingChange = () => {} }) {
  const source = readFileSync(new URL('../src/web/components/CodeEditor.jsx', import.meta.url), 'utf8');
  const body = source.slice(0, source.indexOf('  function fileButton('))
    .replace(/^import .*;\n/gm, '').replace('export default function', 'function');
  const slots = [], effects = [], listeners = new Map(), calls = [], notifications = [];
  let cursor = 0, pending = false, state;
  const facet = { of: value => value };
  class EditorView {
    static theme() { return {}; }
    static lineWrapping = {};
    static contentAttributes = facet;
    static updateListener = { of: listener => ({ listener }) };
    constructor({ state }) { this.state = state; }
    setState(state) { this.state = state; }
    dispatch(transaction) { this.lastTransaction = transaction; }
    focus() {}
    destroy() { this.destroyed = true; }
    edit(content) {
      this.state = { ...this.state, doc: { toString: () => content }, sliceDoc: () => content };
      for (const extension of this.state.extensions.flat(Infinity)) {
        extension?.listener?.({ docChanged: true, state: this.state });
      }
    }
  }
  const context = vm.createContext({
    URLSearchParams, EditorView,
    Compartment: class { of(value) { return value; } reconfigure(value) { return { language: value }; } },
    loadLanguage,
    EditorState: { create: config => ({ ...config, doc: { toString: () => config.doc }, sliceDoc: () => config.doc }), readOnly: facet, lineSeparator: facet },
    basicSetup: {}, defaultHighlightStyle: {}, syntaxHighlighting: () => ({}),
    javascript: () => [], json: () => [], python: () => [], html: () => [], css: () => [],
    request: url => { calls.push(url); return request(url); }, jsonRequest,
    window: {
      localStorage,
      confirm: () => { confirmations++; return allowDiscard; },
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; pending = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(fn, deps) {
      const index = cursor++, old = slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        slots[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  });
  let allowDiscard = false, confirmations = 0;
  const component = vm.runInContext(`${body}\nreturn { root, directoryInput, directoryError, location, setDirectoryInput, changeDirectory, directories, expanded, query, results, searching, searchError, file, dirty, loadingFile, saving, error, status, view, loadDirectory, toggleDirectory, refreshFiles, changeQuery, searchFiles, openFile, save };\n}\nCodeEditor`, context);
  function render() {
    do {
      pending = false; cursor = 0;
      state = component({ toast: message => notifications.push(message), onDirtyChange, onSavingChange });
      while (effects.length) effects.shift()();
    } while (pending);
  }
  render();
  return {
    get state() { return state; }, calls, notifications, listeners, localStorage,
    get confirmations() { return confirmations; },
    set allowDiscard(value) { allowDiscard = value; },
    render,
    async settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); render(); } },
    toggle(path) { state.toggleDirectory(path); render(); },
    directory(value) { state.setDirectoryInput(value); render(); },
    openRoot(value) {
      if (value !== undefined) this.directory(value);
      let prevented = false;
      const promise = state.changeDirectory({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      render();
      return promise;
    },
    refresh() { state.refreshFiles(); render(); },
    query(value) { state.changeQuery({ currentTarget: { value } }); render(); },
    search() {
      let prevented = false;
      const promise = state.searchFiles({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      render();
      return promise;
    },
    edit(content) { state.view.current.edit(content); render(); },
    unmount() {
      for (const slot of slots) {
        slot?.cleanup?.();
        if (slot) slot.cleanup = undefined;
      }
    },
  };
}

const defaultRoot = '/home/test/sunday';
const locationKey = 'sunday-files-location';
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    values, writes,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); writes.push([key, String(value)]); },
  };
}
const savedLocation = h => JSON.parse(h.localStorage.getItem(locationKey));
const apiURL = (pathname, params, root = defaultRoot) => `${pathname}?${new URLSearchParams({ root, ...params })}`;
const listingURL = (path = '', root = defaultRoot) => apiURL('/api/files', { path }, root);
const fileURL = path => apiURL('/api/file', { path });

const entries = [
  { name: 'z.js', type: 'file' },
  { name: 'src', type: 'directory' },
  { name: 'a.js', type: 'file' },
  { name: 'assets', type: 'directory' },
];
const fixture = async url => {
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname === '/api/files') return { entries, root: parsed.searchParams.get('root') === '~/sunday' ? defaultRoot : parsed.searchParams.get('root') };
  if (parsed.pathname === '/api/files/search') return { files: ['src/a.js'], truncated: false };
  assert.equal(parsed.pathname, '/api/file', `Unexpected request: ${url}`);
  return { content: 'original' };
};
async function loaded(options = {}) {
  const h = mount({ request: fixture, ...options });
  await h.settle();
  await h.state.openFile('src/a.js'); await h.settle();
  return h;
}
const names = directory => Array.from(directory.entries, entry => entry.name);

test('CodeEditor loads sorted root entries and lazily caches expanded directories', async t => {
  const h = mount({ request: fixture }); t.after(() => h.unmount());
  assert.equal(h.state.directories[''].loading, true);
  assert.equal(h.state.expanded.has(''), true);
  assert.deepEqual(h.calls, [listingURL('', '~/sunday')]);
  await h.settle();
  assert.deepEqual(names(h.state.directories['']), ['assets', 'src', 'a.js', 'z.js']);
  assert.equal(h.state.directories.src, undefined);
  h.toggle('src');
  assert.equal(h.state.expanded.has('src'), true);
  assert.equal(h.state.directories.src.loading, true);
  h.toggle('src'); h.toggle('src');
  assert.equal(h.calls.filter(url => url === listingURL('src')).length, 1, 'pending requests are cached too');
  await h.settle();
  h.toggle('src'); h.toggle('src');
  assert.equal(h.calls.filter(url => url === listingURL('src')).length, 1);
  h.toggle(''); h.toggle('');
  assert.equal(h.calls.filter(url => url === listingURL('', '~/sunday')).length, 1);
  await h.state.openFile('src/a #.js'); await h.settle();
  assert.ok(h.calls.includes(fileURL('src/a #.js')));
  assert.equal(h.state.file, 'src/a #.js');
  assert.equal(h.state.view.current.state.sliceDoc(), 'original');
  assert.equal(h.state.dirty, false);
  assert.equal(h.state.loadingFile, false);
});

test('CodeEditor refresh resets expansion/cache without discarding the editor', async t => {
  const h = await loaded(); t.after(() => h.unmount());
  h.toggle('src'); await h.settle(); h.edit('draft');
  h.refresh();
  assert.deepEqual(Array.from(h.state.expanded), ['']);
  assert.deepEqual(Object.keys(h.state.directories), ['']);
  assert.equal(h.state.directories[''].loading, true);
  assert.equal(h.state.file, 'src/a.js');
  assert.equal(h.state.view.current.state.sliceDoc(), 'draft');
  assert.equal(h.state.dirty, true);
  assert.equal(h.confirmations, 0);
  await h.settle(); h.toggle('src'); await h.settle();
  assert.equal(h.calls.filter(url => url === listingURL('src')).length, 2);
});

for (const fail of [false, true]) {
  test(`CodeEditor ignores stale directory ${fail ? 'failure' : 'completion'} after refresh`, async t => {
    const root = deferred(), child = deferred();
    let roots = 0, children = 0;
    const h = mount({ request: url => {
      if (new URL(url, 'http://localhost').pathname === '/api/files' && new URL(url, 'http://localhost').searchParams.get('path') === '' && ++roots === 1) return root.promise;
      if (new URL(url, 'http://localhost').pathname === '/api/files' && new URL(url, 'http://localhost').searchParams.get('path') === 'src' && ++children === 1) return child.promise;
      return fixture(url);
    } });
    t.after(() => h.unmount());
    h.toggle('src'); h.refresh(); await h.settle();
    h.toggle('src'); await h.settle();
    if (fail) { root.reject(new Error('stale root')); child.reject(new Error('stale child')); }
    else { root.resolve({ entries: [{ name: 'stale', type: 'file' }] }); child.resolve({ entries: [] }); }
    await h.settle();
    for (const path of ['', 'src']) {
      assert.deepEqual(names(h.state.directories[path]), ['assets', 'src', 'a.js', 'z.js']);
      assert.equal(h.state.directories[path].error, '');
      assert.equal(h.state.directories[path].loading, false);
    }
  });
}

test('CodeEditor exposes directory failures and supports retry with encoded paths', async t => {
  let attempts = 0;
  const h = mount({ request: url => {
    if (url === listingURL('space & dir') && ++attempts === 1) return Promise.reject(new Error('Cannot list'));
    return url === listingURL('space & dir') ? Promise.resolve({ entries: [] }) : fixture(url);
  } });
  t.after(() => h.unmount()); await h.settle();
  h.toggle('space & dir'); await h.settle();
  assert.equal(h.state.directories['space & dir'].error, 'Cannot list');
  assert.equal(h.state.directories['space & dir'].loading, false);
  await h.state.loadDirectory('space & dir'); await h.settle();
  assert.equal(attempts, 2);
  assert.equal(h.state.directories['space & dir'].error, '');
  assert.deepEqual(names(h.state.directories['space & dir']), []);
});

test('CodeEditor searches filenames only on submit and opens result paths', async t => {
  const late = deferred();
  const h = mount({ request: url => url.startsWith('/api/files/search?') ? late.promise : fixture(url) });
  t.after(() => h.unmount()); await h.settle();
  h.query('  a & b  ');
  assert.deepEqual(h.calls, [listingURL('', '~/sunday')]);
  const searching = h.search();
  assert.equal(h.state.searching, true);
  assert.equal(h.state.results, null);
  assert.ok(h.calls.includes(apiURL('/api/files/search', { q: 'a & b' })));
  late.resolve({ files: ['deep/space & file.js', 'a.js'], truncated: true });
  await searching; await h.settle();
  assert.equal(h.state.searching, false);
  assert.deepEqual(Array.from(h.state.results.files), ['deep/space & file.js', 'a.js']);
  assert.equal(h.state.results.truncated, true);
  await h.state.openFile(h.state.results.files[0]); await h.settle();
  assert.equal(h.state.file, 'deep/space & file.js');
  assert.ok(h.calls.includes(fileURL('deep/space & file.js')));
  h.query('   ');
  assert.equal(h.state.results, null);
  const before = h.calls.length;
  await h.search(); await h.settle();
  assert.equal(h.calls.length, before);
  assert.equal(h.state.searching, false);
});

test('CodeEditor search failure clears on input and empty results are retained', async t => {
  let attempts = 0;
  const h = mount({ request: url => url.startsWith('/api/files/search?')
    ? (++attempts === 1 ? Promise.reject(new Error('Search failed')) : Promise.resolve({ files: [], truncated: false }))
    : fixture(url) });
  t.after(() => h.unmount()); await h.settle();
  h.query('missing'); await h.search(); await h.settle();
  assert.equal(h.state.searchError, 'Search failed');
  assert.equal(h.state.searching, false);
  h.query('other');
  assert.equal(h.state.searchError, '');
  await h.search(); await h.settle();
  assert.deepEqual(Array.from(h.state.results.files), []);
  assert.equal(h.state.results.truncated, false);
});

for (const fail of [false, true]) {
  for (const resubmit of [false, true]) {
    test(`CodeEditor ignores stale search ${fail ? 'failure' : 'results'} after ${resubmit ? 'new submit' : 'input change'}`, async t => {
      const late = deferred(), next = deferred();
      let searches = 0;
      const h = mount({ request: url => url.startsWith('/api/files/search?')
        ? (++searches === 1 ? late.promise : next.promise) : fixture(url) });
      t.after(() => h.unmount()); await h.settle();
      h.query('old'); const first = h.search();
      h.query('new');
      const second = resubmit ? h.search() : null;
      if (fail) late.reject(new Error('stale search'));
      else late.resolve({ files: ['old.js'], truncated: true });
      await first; await h.settle();
      assert.equal(h.state.query, 'new');
      assert.equal(h.state.results, null);
      assert.equal(h.state.searchError, '');
      assert.equal(h.state.searching, resubmit, 'stale finally cannot stop a newer search');
      if (resubmit) {
        next.resolve({ files: ['new.js'], truncated: false }); await second; await h.settle();
        assert.deepEqual(Array.from(h.state.results.files), ['new.js']);
        assert.equal(h.state.searching, false);
      }
    });
  }
}

test('CodeEditor saves current content and clears dirty, including save shortcuts', async t => {
  const saves = [], dirtyChanges = [], savingChanges = [];
  const h = await loaded({ onDirtyChange: value => dirtyChanges.push(value), onSavingChange: value => savingChanges.push(value),
    jsonRequest: async (...args) => { saves.push(args); } });
  t.after(() => h.unmount());
  for (const modifier of ['ctrlKey', 'metaKey']) {
    h.edit(`updated ${modifier}`);
    assert.equal(dirtyChanges.at(-1), true);
    let prevented = false;
    h.listeners.get('keydown')({ [modifier]: true, key: 'S', preventDefault() { prevented = true; } });
    await h.settle();
    assert.equal(prevented, true);
    assert.equal(h.state.dirty, false);
    assert.equal(h.state.saving, false);
    assert.equal(dirtyChanges.at(-1), false);
    assert.equal(savingChanges.at(-1), false);
  }
  assert.equal(saves.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0])), ['/api/file', 'PUT', { root: defaultRoot, path: 'src/a.js', content: 'updated ctrlKey', originalContent: 'original' }]);
  assert.equal(saves[1][2].originalContent, 'updated ctrlKey');
  assert.equal(h.state.status, 'Saved src/a.js.');
  assert.deepEqual(h.notifications, ['Saved src/a.js', 'Saved src/a.js']);
  await h.state.save(); assert.equal(saves.length, 2, 'clean content is not saved again');
});

test('CodeEditor protects dirty content from file changes and beforeunload', async t => {
  const h = await loaded(); t.after(() => h.unmount());
  h.edit('draft'); const before = h.calls.length;
  await h.state.openFile('z.js');
  assert.equal(h.calls.length, before);
  assert.equal(h.confirmations, 1);
  let prevented = false;
  const unload = { preventDefault() { prevented = true; } };
  h.listeners.get('beforeunload')(unload);
  assert.equal(prevented, true); assert.equal(unload.returnValue, '');
  h.allowDiscard = true;
  await h.state.openFile('z.js'); await h.settle();
  assert.equal(h.state.file, 'z.js'); assert.equal(h.state.dirty, false);
  const cleanUnload = { preventDefault() { assert.fail('clean editor must not block unloading'); } };
  h.listeners.get('beforeunload')(cleanUnload);
  assert.equal(cleanUnload.returnValue, undefined);
  const view = h.state.view.current;
  h.unmount(); assert.equal(h.listeners.size, 0); assert.equal(view.destroyed, true);
});

for (const fail of [false, true]) {
  test(`CodeEditor ignores stale file ${fail ? 'failure' : 'completion'} after a newer request`, async t => {
    const late = deferred(), next = deferred();
    const h = await loaded({ request: url => url === fileURL('slow.js') ? late.promise
      : url === fileURL('new.js') ? next.promise : fixture(url) });
    t.after(() => h.unmount());
    const opening = h.state.openFile('slow.js'); h.render();
    const newer = h.state.openFile('new.js'); h.render();
    if (fail) late.reject(new Error('stale file')); else late.resolve({ content: 'stale' });
    await opening; await h.settle();
    assert.equal(h.state.loadingFile, true);
    assert.equal(h.state.file, 'src/a.js'); assert.equal(h.state.error, '');
    next.resolve({ content: 'new content' }); await newer; await h.settle();
    assert.equal(h.state.file, 'new.js');
    assert.equal(h.state.view.current.state.sliceDoc(), 'new content');
    assert.equal(h.state.loadingFile, false);
  });
}

test('CodeEditor protects edits made while a file request is pending and blocks saving', async t => {
  const late = deferred(), saves = [];
  const h = await loaded({ request: url => url.includes('path=slow.js') ? late.promise : fixture(url),
    jsonRequest: async (...args) => saves.push(args) });
  t.after(() => h.unmount());
  const opening = h.state.openFile('slow.js'); h.render();
  h.edit('new draft'); await h.state.save(); assert.equal(saves.length, 0);
  late.resolve({ content: 'replacement' }); await opening; await h.settle();
  assert.equal(h.confirmations, 1); assert.equal(h.state.file, 'src/a.js');
  assert.equal(h.state.view.current.state.sliceDoc(), 'new draft');
  assert.equal(h.state.dirty, true); assert.equal(h.state.loadingFile, false);
});

test('CodeEditor save completion preserves newer edits as dirty', async t => {
  const late = deferred(), saves = [], savingChanges = [];
  const h = await loaded({ onSavingChange: value => savingChanges.push(value),
    jsonRequest: (...args) => { saves.push(args); return late.promise; } });
  t.after(() => h.unmount()); h.edit('saved snapshot');
  const saving = h.state.save(); h.render();
  assert.equal(h.state.saving, true); assert.equal(savingChanges.at(-1), true);
  h.edit('newer draft'); await h.state.save();
  const before = h.calls.length; await h.state.openFile('z.js');
  assert.equal(h.calls.length, before); assert.equal(h.state.file, 'src/a.js');
  assert.equal(saves.length, 1); assert.equal(saves[0][2].content, 'saved snapshot');
  late.resolve({}); await saving; await h.settle();
  assert.equal(h.state.saving, false); assert.equal(savingChanges.at(-1), false);
  assert.equal(h.state.dirty, true);
  assert.equal(h.state.view.current.state.sliceDoc(), 'newer draft');
  h.edit('saved snapshot');
  assert.equal(h.state.dirty, false, 'successful save advances the baseline to its snapshot');
});

test('CodeEditor failed save retains dirty content and original baseline for retry', async t => {
  const saves = [];
  const h = await loaded({ jsonRequest: async (...args) => {
    saves.push(args); if (saves.length === 1) throw new Error('File changed on disk');
  } });
  t.after(() => h.unmount()); h.edit('draft');
  await h.state.save(); await h.settle();
  assert.equal(h.state.error, 'File changed on disk');
  assert.equal(h.state.dirty, true); assert.equal(h.state.saving, false);
  assert.deepEqual(h.notifications, []);
  await h.state.save(); await h.settle();
  assert.equal(saves[1][2].originalContent, 'original');
  assert.equal(h.state.error, ''); assert.equal(h.state.dirty, false);
});

test('CodeEditor file failure preserves the current document', async t => {
  const h = await loaded({ request: url => url === fileURL('missing.js')
    ? Promise.reject(new Error('File not found')) : fixture(url) });
  t.after(() => h.unmount());
  await h.state.openFile('missing.js'); await h.settle();
  assert.equal(h.state.error, 'File not found'); assert.equal(h.state.loadingFile, false);
  assert.equal(h.state.file, 'src/a.js'); assert.equal(h.state.view.current.state.sliceDoc(), 'original');
});

test('CodeEditor ignores directory, search, file and save completions after unmount', async () => {
  const directory = deferred(), search = deferred(), save = deferred();
  const h = await loaded({ request: url => url === listingURL('assets') ? directory.promise
    : url.startsWith('/api/files/search?') ? search.promise : fixture(url), jsonRequest: () => save.promise });
  h.toggle('assets'); h.query('late'); const searching = h.search();
  h.edit('draft'); const saving = h.state.save(); h.render();
  const pendingFile = deferred();
  // A separate mount exercises a file response whose editor has already been destroyed.
  const other = mount({ request: url => url.startsWith('/api/file?') ? pendingFile.promise : fixture(url) });
  await other.settle(); const otherOpening = other.state.openFile('late.js'); other.render();
  h.unmount(); other.unmount();
  directory.resolve({ entries: [] }); search.resolve({ files: ['late.js'], truncated: false });
  save.resolve({}); pendingFile.resolve({ content: 'too late' });
  await Promise.all([searching, saving, otherOpening]); await h.settle(); await other.settle();
  assert.equal(h.state.directories.assets.loading, true);
  assert.equal(h.state.results, null); assert.equal(h.state.dirty, true);
  assert.deepEqual(h.notifications, []); assert.equal(h.state.view.current, null);
  assert.equal(other.state.file, ''); assert.equal(other.state.view.current, null);
});

test('CodeEditor preserves CRLF in save payloads and detects reverted edits as clean', async t => {
  const content = 'first\r\nsecond\r\n', saves = [];
  const h = await loaded({ request: url => url.startsWith('/api/file?') ? Promise.resolve({ content }) : fixture(url),
    jsonRequest: async (...args) => saves.push(args) });
  t.after(() => h.unmount());
  assert.equal(h.state.view.current.state.sliceDoc(), content);
  h.edit(`x${content}`); assert.equal(h.state.dirty, true);
  h.edit(content); assert.equal(h.state.dirty, false);
  h.edit(`x${content}`); await h.state.save(); await h.settle();
  assert.equal(saves[0][2].content, `x${content}`);
  assert.equal(saves[0][2].originalContent, content); assert.equal(h.state.dirty, false);
});

test('CodeMirror serialization preserves CRLF content through edits and undo', async () => {
  const { EditorState } = await import('@codemirror/state');
  const content = 'first\r\nsecond\r\n';
  const state = EditorState.create({ doc: content, extensions: [EditorState.lineSeparator.of('\r\n')] });
  assert.equal(state.sliceDoc(), content);
  const edited = state.update({ changes: { from: 0, insert: 'x' } }).state;
  assert.equal(edited.sliceDoc(), `x${content}`);
  const reverted = edited.update({ changes: { from: 0, to: 1 } }).state;
  assert.equal(reverted.sliceDoc(), content);
});

test('CodeEditor opens a canonical root and scopes listing, search, file and save requests', async t => {
  const saves = [];
  const h = await loaded({ request: url => url === listingURL('', '~/other & project')
    ? Promise.resolve({ root: '/home/test/other & project', entries: [{ name: 'new.js', type: 'file' }] }) : fixture(url),
  jsonRequest: async (...args) => saves.push(args) });
  t.after(() => h.unmount());
  h.query('old'); await h.search(); await h.settle();
  await h.openRoot('  ~/other & project  '); await h.settle();
  const root = '/home/test/other & project';
  assert.equal(h.state.root, root);
  assert.equal(h.state.directoryInput, root);
  assert.equal(h.state.directoryError, '');
  assert.equal(h.state.file, '');
  assert.equal(h.state.view.current.state.sliceDoc(), '');
  assert.equal(h.state.dirty, false);
  assert.equal(h.state.query, '');
  assert.equal(h.state.results, null);
  assert.deepEqual(Array.from(h.state.expanded), ['']);
  assert.deepEqual(Object.keys(h.state.directories), ['']);
  assert.deepEqual(names(h.state.directories['']), ['new.js']);
  assert.deepEqual(savedLocation(h), { root, folder: '', file: '' });
  h.toggle('src'); await h.settle();
  h.query('a & b'); await h.search(); await h.settle();
  await h.state.openFile('new.js'); await h.settle();
  h.edit('new content'); await h.state.save(); await h.settle();
  assert.ok(h.calls.includes(listingURL('src', root)));
  assert.ok(h.calls.includes(apiURL('/api/files/search', { q: 'a & b' }, root)));
  assert.ok(h.calls.includes(apiURL('/api/file', { path: 'new.js' }, root)));
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0])), ['/api/file', 'PUT', {
    root, path: 'new.js', content: 'new content', originalContent: 'original',
  }]);
});

test('CodeEditor invalid root preserves the last successful location and editor', async t => {
  const h = await loaded({ request: url => url === listingURL('', '/missing')
    ? Promise.reject(new Error('Directory not found')) : fixture(url) });
  t.after(() => h.unmount());
  const remembered = savedLocation(h);
  await h.openRoot('/missing'); await h.settle();
  assert.equal(h.state.directoryError, 'Directory not found');
  assert.equal(h.state.directoryInput, '/missing');
  assert.equal(h.state.root, defaultRoot);
  assert.equal(h.state.file, 'src/a.js');
  assert.equal(h.state.view.current.state.sliceDoc(), 'original');
  assert.equal(h.state.loadingFile, false);
  assert.deepEqual(savedLocation(h), remembered);
  await h.openRoot('/valid'); await h.settle();
  assert.equal(h.state.directoryError, '');
  assert.equal(h.state.root, '/valid');
});

test('CodeEditor persists paths only and restores the last folder and file on remount', async t => {
  const localStorage = storage();
  const h = await loaded({ localStorage });
  t.after(() => h.unmount());
  await h.state.openFile('src/deep/a.js'); await h.settle();
  h.toggle('assets'); await h.settle();
  h.edit('private unsaved document');
  const remembered = { root: defaultRoot, folder: 'assets', file: 'src/deep/a.js' };
  assert.deepEqual(savedLocation(h), remembered);
  for (const [key, value] of localStorage.writes) {
    assert.equal(key, locationKey);
    assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ['file', 'folder', 'root']);
    assert.equal(value.includes('private unsaved document'), false);
    assert.equal(value.includes('original'), false);
  }
  h.unmount();
  const restored = mount({ request: fixture, localStorage });
  t.after(() => restored.unmount()); await restored.settle();
  assert.equal(restored.calls[0], listingURL());
  assert.ok(restored.calls.includes(listingURL('assets')));
  assert.ok(restored.calls.includes(fileURL('src/deep/a.js')));
  assert.equal(restored.state.expanded.has('assets'), true);
  assert.equal(restored.state.file, 'src/deep/a.js');
  assert.equal(restored.state.view.current.state.sliceDoc(), 'original');
  assert.equal(restored.state.dirty, false);
  assert.deepEqual(savedLocation(restored), remembered);
});

test('CodeEditor restores all ancestors of a saved nested folder', async t => {
  const h = mount({ request: fixture, localStorage: storage({ [locationKey]: JSON.stringify({
    root: defaultRoot, folder: 'src/deep/nested', file: '',
  }) }) });
  t.after(() => h.unmount()); await h.settle();
  assert.deepEqual(Array.from(h.state.expanded), ['', 'src', 'src/deep', 'src/deep/nested']);
  for (const path of ['src', 'src/deep', 'src/deep/nested']) assert.ok(h.calls.includes(listingURL(path)));
});

for (const raw of ['{broken', 'null', '[]', '{}', '{"root":42}', '{"root":""}']) {
  test(`CodeEditor tolerates malformed stored location ${raw}`, async t => {
    const h = mount({ request: fixture, localStorage: storage({ [locationKey]: raw }) });
    t.after(() => h.unmount()); await h.settle();
    assert.equal(h.calls[0], listingURL('', '~/sunday'));
    assert.equal(h.state.root, defaultRoot);
    assert.equal(h.state.file, '');
    assert.deepEqual(savedLocation(h), { root: defaultRoot, folder: '', file: '' });
  });
}

test('CodeEditor ignores malformed stored folder/file fields', async t => {
  const h = mount({ request: fixture, localStorage: storage({ [locationKey]: JSON.stringify({
    root: '/project', folder: 12, file: { content: 'not a path' },
  }) }) });
  t.after(() => h.unmount()); await h.settle();
  assert.deepEqual(savedLocation(h), { root: '/project', folder: '', file: '' });
  assert.deepEqual(h.calls, [listingURL('', '/project')]);
});

for (const unavailable of ['missing', 'throws']) {
  test(`CodeEditor still navigates when localStorage ${unavailable}`, async t => {
    const h = await loaded({ localStorage: unavailable === 'missing' ? null : {
      getItem() { throw new Error('Storage denied'); },
      setItem() { throw new Error('Storage denied'); },
    } });
    t.after(() => h.unmount());
    assert.equal(h.state.file, 'src/a.js');
    await h.openRoot('/project'); await h.settle();
    await h.state.openFile('z.js'); await h.settle();
    assert.equal(h.state.root, '/project');
    assert.equal(h.state.file, 'z.js');
    assert.equal(h.state.error, '');
    assert.equal(h.state.directoryError, '');
  });
}

for (const fail of [false, true]) {
  test(`CodeEditor ignores stale root switch ${fail ? 'failure' : 'completion'}`, async t => {
    const old = deferred(), newer = deferred();
    const h = await loaded({ request: url => url === listingURL('', '/old') ? old.promise
      : url === listingURL('', '/new') ? newer.promise : fixture(url) });
    t.after(() => h.unmount());
    const first = h.openRoot('/old');
    const second = h.openRoot('/new');
    if (fail) old.reject(new Error('stale root error'));
    else old.resolve({ root: '/old', entries: [{ name: 'stale.js', type: 'file' }] });
    await first; await h.settle();
    assert.equal(h.state.loadingFile, true);
    assert.equal(h.state.root, defaultRoot);
    assert.equal(h.state.directoryInput, '/new');
    assert.equal(h.state.directoryError, '');
    newer.resolve({ root: '/new', entries: [] }); await second; await h.settle();
    assert.equal(h.state.root, '/new');
    assert.equal(h.state.loadingFile, false);
    assert.deepEqual(names(h.state.directories['']), []);
    assert.deepEqual(savedLocation(h), { root: '/new', folder: '', file: '' });
  });
}

test('CodeEditor rejects discarding dirty content before requesting a root', async t => {
  const h = await loaded(); t.after(() => h.unmount());
  h.edit('draft'); const before = h.calls.length, remembered = savedLocation(h);
  await h.openRoot('/other'); await h.settle();
  assert.equal(h.calls.length, before);
  assert.equal(h.confirmations, 1);
  assert.equal(h.state.root, defaultRoot);
  assert.equal(h.state.view.current.state.sliceDoc(), 'draft');
  assert.equal(h.state.dirty, true);
  assert.deepEqual(savedLocation(h), remembered);
  h.allowDiscard = true;
  await h.openRoot('/other'); await h.settle();
  assert.equal(h.state.root, '/other');
  assert.equal(h.state.dirty, false);
});

test('CodeEditor protects new edits during root loading and blocks save until it finishes', async t => {
  const late = deferred(), saves = [];
  const h = await loaded({ request: url => url === listingURL('', '/other') ? late.promise : fixture(url),
    jsonRequest: async (...args) => saves.push(args) });
  t.after(() => h.unmount());
  const remembered = savedLocation(h), opening = h.openRoot('/other');
  h.edit('new draft'); await h.state.save();
  assert.equal(saves.length, 0);
  late.resolve({ root: '/other', entries: [] }); await opening; await h.settle();
  assert.equal(h.confirmations, 1);
  assert.equal(h.state.root, defaultRoot);
  assert.equal(h.state.file, 'src/a.js');
  assert.equal(h.state.view.current.state.sliceDoc(), 'new draft');
  assert.equal(h.state.dirty, true);
  assert.equal(h.state.loadingFile, false);
  assert.deepEqual(savedLocation(h), remembered);
  await h.state.save(); await h.settle();
  assert.equal(saves.length, 1);
  assert.equal(saves[0][2].root, defaultRoot);
});

test('CodeEditor blocks root changes while saving without prompting or changing storage', async t => {
  const late = deferred();
  const h = await loaded({ jsonRequest: () => late.promise });
  t.after(() => h.unmount()); h.edit('draft');
  const saving = h.state.save(); h.render();
  const before = h.calls.length, remembered = savedLocation(h);
  await h.openRoot('/other'); await h.settle();
  assert.equal(h.calls.length, before);
  assert.equal(h.confirmations, 0);
  assert.equal(h.state.root, defaultRoot);
  assert.deepEqual(savedLocation(h), remembered);
  late.resolve({}); await saving; await h.settle();
  await h.openRoot('/other'); await h.settle();
  assert.equal(h.state.root, '/other');
});

for (const stage of ['listing', 'file']) {
  test(`CodeEditor restoration does not override a newer file click during saved ${stage} loading`, async t => {
    const late = deferred();
    const localStorage = storage({ [locationKey]: JSON.stringify({ root: defaultRoot, folder: 'src', file: 'src/saved.js' }) });
    const h = mount({ localStorage, request: url =>
      (stage === 'listing' && url === listingURL()) || (stage === 'file' && url === fileURL('src/saved.js'))
        ? late.promise : fixture(url) });
    t.after(() => h.unmount()); await h.settle();
    if (stage === 'file') assert.ok(h.calls.includes(fileURL('src/saved.js')));
    await h.state.openFile('clicked.js'); await h.settle();
    late.resolve(stage === 'listing' ? { root: defaultRoot, entries } : { content: 'saved document' });
    await h.settle();
    assert.equal(h.state.file, 'clicked.js');
    assert.equal(h.state.view.current.state.sliceDoc(), 'original');
    assert.equal(h.state.loadingFile, false);
    assert.deepEqual(savedLocation(h), { root: defaultRoot, folder: '', file: 'clicked.js' });
    if (stage === 'listing') assert.equal(h.calls.includes(fileURL('src/saved.js')), false);
  });
}

for (const fail of [false, true]) {
  test(`CodeEditor ignores old-root directory, search and file ${fail ? 'failures' : 'responses'} after a root switch`, async t => {
    const directory = deferred(), search = deferred(), file = deferred();
    const h = await loaded({ request: url => url === listingURL('assets') ? directory.promise
      : url.startsWith('/api/files/search?') ? search.promise
        : url === fileURL('slow.js') ? file.promise : fixture(url) });
    t.after(() => h.unmount());
    h.toggle('assets'); h.query('old'); const searching = h.search();
    const opening = h.state.openFile('slow.js'); h.render();
    await h.openRoot('/other'); await h.settle();
    const writes = h.localStorage.writes.length;
    if (fail) {
      directory.reject(new Error('old directory'));
      search.reject(new Error('old search'));
      file.reject(new Error('old file'));
    } else {
      directory.resolve({ root: defaultRoot, entries: [{ name: 'stale', type: 'file' }] });
      search.resolve({ files: ['stale.js'], truncated: false });
      file.resolve({ content: 'old content' });
    }
    await Promise.all([searching, opening]); await h.settle();
    assert.equal(h.state.root, '/other');
    assert.deepEqual(Object.keys(h.state.directories), ['']);
    assert.equal(h.state.results, null);
    assert.equal(h.state.searchError, '');
    assert.equal(h.state.error, '');
    assert.equal(h.state.file, '');
    assert.equal(h.state.view.current.state.sliceDoc(), '');
    assert.equal(h.state.loadingFile, false);
    assert.equal(h.state.searching, false);
    assert.equal(h.localStorage.writes.length, writes);
    assert.deepEqual(savedLocation(h), { root: '/other', folder: '', file: '' });
  });
}

test('CodeEditor stale initial restoration cannot replace a switched root or persist its location', async t => {
  const late = deferred();
  const h = mount({ localStorage: storage({ [locationKey]: JSON.stringify({
    root: defaultRoot, folder: 'src', file: 'src/saved.js',
  }) }), request: url => url === listingURL() ? late.promise : fixture(url) });
  t.after(() => h.unmount());
  await h.openRoot('/other'); await h.settle();
  const writes = h.localStorage.writes.length;
  late.resolve({ root: defaultRoot, entries }); await h.settle();
  assert.equal(h.state.root, '/other');
  assert.equal(h.state.file, '');
  assert.equal(h.calls.includes(fileURL('src/saved.js')), false);
  assert.equal(h.localStorage.writes.length, writes);
  assert.deepEqual(savedLocation(h), { root: '/other', folder: '', file: '' });
});

test('CodeEditor initial canonical root response does not overwrite newer directory input', async t => {
  const late = deferred();
  const h = mount({ request: () => late.promise });
  t.after(() => h.unmount());
  h.directory('/typed/project');
  late.resolve({ root: defaultRoot, entries }); await h.settle();
  assert.equal(h.state.root, defaultRoot);
  assert.equal(h.state.directoryInput, '/typed/project');
  assert.deepEqual(savedLocation(h), { root: defaultRoot, folder: '', file: '' });
});

test('CodeEditor failed file opening does not persist the attempted path', async t => {
  const h = await loaded({ request: url => url === fileURL('missing/a.js')
    ? Promise.reject(new Error('File not found')) : fixture(url) });
  t.after(() => h.unmount());
  const remembered = savedLocation(h);
  await h.state.openFile('missing/a.js'); await h.settle();
  assert.equal(h.state.error, 'File not found');
  assert.deepEqual(savedLocation(h), remembered);
  assert.equal(h.state.location.current.file, 'src/a.js');
});

test('CodeEditor restores the saved folder and file after an initial listing failure and retry', async t => {
  let failed = false;
  const localStorage = storage({ [locationKey]: JSON.stringify({ root: defaultRoot, folder: 'src/nested', file: 'src/nested/a.js' }) });
  const h = mount({ localStorage, request: url => {
    if (url === listingURL() && !failed) { failed = true; return Promise.reject(new Error('Temporary failure')); }
    return fixture(url);
  } });
  t.after(() => h.unmount());
  await h.settle();
  assert.equal(h.state.file, '');
  assert.equal(h.state.directories[''].error, 'Temporary failure');
  await h.state.loadDirectory(''); await h.settle();
  assert.equal(h.state.file, 'src/nested/a.js');
  assert.ok(h.state.expanded.has('src/nested'));
  assert.ok(h.state.directories['src/nested']);
});

test('CodeEditor refresh during initial loading preserves pending folder and file restoration', async t => {
  const late = deferred();
  let initial = true;
  const localStorage = storage({ [locationKey]: JSON.stringify({ root: defaultRoot, folder: 'src', file: 'src/a.js' }) });
  const h = mount({ localStorage, request: url => {
    if (url === listingURL() && initial) { initial = false; return late.promise; }
    return fixture(url);
  } });
  t.after(() => h.unmount());
  h.refresh(); await h.settle();
  assert.equal(h.state.file, 'src/a.js');
  assert.ok(h.state.expanded.has('src'));
  late.resolve({ root: defaultRoot, entries: [] }); await h.settle();
  assert.equal(h.state.file, 'src/a.js');
  assert.deepEqual(names(h.state.directories['']), ['assets', 'src', 'a.js', 'z.js']);
});

test('CodeEditor does not persist a pending root response after unmount', async () => {
  const late = deferred();
  const h = await loaded({ request: url => url === listingURL('', '/other') ? late.promise : fixture(url) });
  const opening = h.openRoot('/other');
  const writes = h.localStorage.writes.length;
  h.unmount();
  late.resolve({ root: '/other', entries: [] }); await opening; await h.settle();
  assert.equal(h.localStorage.writes.length, writes);
  assert.equal(h.state.root, defaultRoot);
});

test('file tree renders root contents directly while child folders remain expandable', () => {
  const source = readFileSync(new URL('../src/web/components/CodeEditor.jsx', import.meta.url), 'utf8');
  const treeStart = source.indexOf('<nav class="min-w-0"');
  const tree = source.slice(treeStart, source.indexOf('</nav>', treeStart));
  assert.match(tree, /\{directoryContents\(''\)\}/);
  assert.doesNotMatch(tree, /toggleDirectory|expanded\.has|code-editor-root/);
  assert.match(tree, /aria-label=\{`Files in \$\{root\}`\}/);
  assert.match(source, /aria-controls=\{`code-editor-directory-\$\{encodeURIComponent\(childPath\)\}`\} onClick=\{\(\) => toggleDirectory\(childPath\)\}/);
  assert.match(source, /aria-expanded=\{expanded\.has\(childPath\)\}/);
});


test('delayed syntax support preserves edits and ignores an obsolete file', async () => {
  const first = deferred(), second = deferred();
  const h = await loaded({ loadLanguage: path => path === 'a.js' ? first.promise : second.promise });
  await h.state.openFile('a.js');
  h.edit('edited while language loads');
  first.resolve(['javascript']);
  await h.settle();
  assert.equal(h.state.view.current.state.sliceDoc(), 'edited while language loads');
  assert.deepEqual(Array.from(h.state.view.current.lastTransaction.effects.language), ['javascript']);
  h.allowDiscard = true;
  await h.state.openFile('b.py');
  await h.state.openFile('a.js');
  await h.settle();
  second.resolve(['python']);
  await h.settle();
  assert.deepEqual(Array.from(h.state.view.current.lastTransaction.effects.language), ['javascript']);
  h.unmount();
});

test('syntax download failure keeps the opened file editable', async () => {
  const h = await loaded({ loadLanguage: async () => { throw new Error('offline'); } });
  await h.state.openFile('a.js');
  await h.settle();
  assert.match(h.state.status, /plain-text editing/);
  h.edit('still editable');
  assert.equal(h.state.dirty, true);
  h.unmount();
});
