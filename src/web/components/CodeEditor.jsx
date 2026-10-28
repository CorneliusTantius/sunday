import { useEffect, useRef, useState } from 'preact/hooks';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { request, jsonRequest } from '../api.js';
import { loadLanguage } from './editor-language.js';

const darkTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--color-base-100)', color: 'var(--color-base-content)', height: '100%' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
  '.cm-content': { caretColor: 'var(--color-primary)' },
  '.cm-gutters': { backgroundColor: 'var(--color-base-200)', color: 'var(--color-base-content)', borderColor: 'var(--color-base-300)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--color-base-200)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in oklab, var(--color-primary) 35%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
}, { dark: true });

const locationKey = 'sunday-files-location';
function storedLocation() {
  const fallback = { root: '~/sunday', folder: '', file: '' };
  try {
    const saved = JSON.parse(window.localStorage.getItem(locationKey));
    if (!saved || typeof saved.root !== 'string' || !saved.root) return fallback;
    return { root: saved.root, folder: typeof saved.folder === 'string' ? saved.folder : '', file: typeof saved.file === 'string' ? saved.file : '' };
  } catch { return fallback; }
}
function folderAncestors(folder) {
  const paths = [''];
  for (const part of folder.split('/').filter(Boolean)) paths.push(paths.at(-1) ? `${paths.at(-1)}/${part}` : part);
  return paths;
}

export default function CodeEditor({ toast, onDirtyChange, onSavingChange }) {
  const location = useRef(null);
  if (!location.current) location.current = storedLocation();
  const [root, setRoot] = useState(location.current.root);
  const [directoryInput, setDirectoryInput] = useState(location.current.root);
  const [directoryError, setDirectoryError] = useState('');
  const [directories, setDirectories] = useState({});
  const [expanded, setExpanded] = useState(new Set(folderAncestors(location.current.folder)));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [file, setFile] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const languageSupport = useRef(new Compartment());
  const host = useRef(null);
  const view = useRef(null);
  const live = useRef(false);
  const current = useRef({ root: location.current.root, file: '', baseline: '', dirty: false, saving: false, loading: false });
  const directoryRequests = useRef(new Map());
  const searchGeneration = useRef(0);
  const fileGeneration = useRef(0);
  const restorePending = useRef({ ...location.current });
  const saveAction = useRef(null);

  function editorState(content, path) {
    return EditorState.create({ doc: content, extensions: [
      basicSetup, darkTheme, syntaxHighlighting(defaultHighlightStyle), languageSupport.current.of([]),
      EditorState.lineSeparator.of(content.includes('\r\n') ? '\r\n' : '\n'),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': path ? `Editing ${path}` : 'File editor' }),
      EditorState.readOnly.of(!path),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        const changed = update.state.sliceDoc() !== current.current.baseline;
        current.current.dirty = changed;
        setDirty(changed); onDirtyChange?.(changed);
      }),
    ] });
  }

  useEffect(() => {
    live.current = true;
    onDirtyChange?.(false); onSavingChange?.(false);
    view.current = new EditorView({ state: editorState('', ''), parent: host.current });
    loadDirectory('');
    const beforeUnload = event => {
      if (!current.current.dirty && !current.current.saving) return;
      event.preventDefault(); event.returnValue = '';
    };
    const shortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); saveAction.current?.();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', shortcut);
    return () => {
      live.current = false;
      directoryRequests.current.clear(); searchGeneration.current++; fileGeneration.current++;
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', shortcut);
      view.current.destroy(); view.current = null;
    };
  }, []);

  function mayDiscard() {
    return !current.current.dirty || window.confirm('Discard unsaved changes?');
  }

  function remember(update) {
    location.current = { ...location.current, ...update };
    try { window.localStorage.setItem(locationKey, JSON.stringify(location.current)); } catch { /* Storage may be unavailable. */ }
  }

  async function loadDirectory(path) {
    const selectedRoot = current.current.root;
    const token = {};
    directoryRequests.current.set(path, token);
    setDirectories(previous => ({ ...previous, [path]: { entries: [], loading: true, error: '' } }));
    try {
      const data = await request(`/api/files?${new URLSearchParams({ root: selectedRoot, path })}`);
      if (!live.current || directoryRequests.current.get(path) !== token) return;
      const entries = [...data.entries].sort((a, b) => a.type === b.type
        ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
      if (path === '' && data.root) {
        current.current.root = data.root;
        setRoot(data.root); setDirectoryInput(previous => previous === selectedRoot ? data.root : previous); remember({ root: data.root });
      }
      setDirectories(previous => ({ ...previous, [path]: { entries, loading: false, error: '' } }));
      if (path === '' && restorePending.current) {
        const saved = restorePending.current;
        restorePending.current = null;
        const ancestors = folderAncestors(saved.folder);
        setExpanded(previous => new Set([...previous, ...ancestors]));
        for (const ancestor of ancestors.slice(1)) loadDirectory(ancestor);
        if (saved.file) openFile(saved.file, true);
      }
      return data;
    } catch (error) {
      if (!live.current || directoryRequests.current.get(path) !== token) return;
      setDirectories(previous => ({ ...previous, [path]: { entries: [], loading: false, error: error.message } }));
    }
  }

  function toggleDirectory(path) {
    const opening = !expanded.has(path);
    setExpanded(previous => {
      const next = new Set(previous);
      if (opening) next.add(path);
      else next.delete(path);
      return next;
    });
    if (opening) remember({ folder: path });
    else if (path === '' || location.current.folder === path || location.current.folder.startsWith(`${path}/`)) remember({ folder: path.split('/').slice(0, -1).join('/') });
    if (opening && !directories[path]) loadDirectory(path);
  }

  async function changeDirectory(event, target = directoryInput) {
    event?.preventDefault();
    if (current.current.saving || !mayDiscard()) return;
    restorePending.current = null;
    const generation = ++fileGeneration.current;
    const snapshot = view.current.state.sliceDoc();
    current.current.loading = true;
    setLoadingFile(true); setDirectoryError('');
    try {
      const data = await request(`/api/files?${new URLSearchParams({ root: target.trim(), path: '' })}`);
      if (!live.current || generation !== fileGeneration.current) return;
      if (current.current.dirty && view.current.state.sliceDoc() !== snapshot && !mayDiscard()) return;
      const selectedRoot = data.root;
      directoryRequests.current.clear(); searchGeneration.current++;
      current.current.root = selectedRoot; current.current.file = ''; current.current.baseline = ''; current.current.dirty = false;
      view.current.setState(editorState('', ''));
      setRoot(selectedRoot); setDirectoryInput(selectedRoot);
      setDirectories({ '': { entries: [...data.entries].sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1), loading: false, error: '' } });
      setExpanded(new Set([''])); setQuery(''); setResults(null); setSearching(false); setSearchError('');
      setFile(''); setDirty(false); onDirtyChange?.(false); setError(''); setStatus('');
      remember({ root: selectedRoot, folder: '', file: '' });
    } catch (error) {
      if (live.current && generation === fileGeneration.current) setDirectoryError(error.message);
    } finally {
      if (live.current && generation === fileGeneration.current) { current.current.loading = false; setLoadingFile(false); }
    }
  }

  function refreshFiles() {
    directoryRequests.current.clear();
    setDirectories({});
    setExpanded(new Set(['']));
    loadDirectory('');
  }

  function changeQuery(event) {
    searchGeneration.current++;
    setQuery(event.currentTarget.value);
    setResults(null); setSearching(false); setSearchError('');
  }

  async function searchFiles(event) {
    event.preventDefault();
    const generation = ++searchGeneration.current;
    const q = query.trim();
    setResults(null); setSearchError('');
    if (!q) { setSearching(false); return; }
    setSearching(true);
    try {
      const data = await request(`/api/files/search?${new URLSearchParams({ root: current.current.root, q })}`);
      if (!live.current || generation !== searchGeneration.current) return;
      setResults(data);
    } catch (error) {
      if (live.current && generation === searchGeneration.current) setSearchError(error.message);
    } finally {
      if (live.current && generation === searchGeneration.current) setSearching(false);
    }
  }

  async function openFile(path, restoring = false) {
    if (current.current.saving || !mayDiscard()) return;
    if (!restoring) restorePending.current = null;
    const generation = ++fileGeneration.current;
    const snapshot = view.current.state.sliceDoc();
    current.current.loading = true;
    setLoadingFile(true); setError(''); setStatus('');
    try {
      const data = await request(`/api/file?${new URLSearchParams({ root: current.current.root, path })}`);
      if (!live.current || generation !== fileGeneration.current) return;
      // Edits made while the request was pending must also be protected.
      if (current.current.dirty && view.current.state.sliceDoc() !== snapshot && !mayDiscard()) return;
      current.current.file = path; current.current.baseline = data.content; current.current.dirty = false;
      view.current.setState(editorState(data.content, path));
      // Highlighting must not delay displaying the file or replace edits made while loading.
      loadLanguage(path).then(extension => {
        if (!live.current || generation !== fileGeneration.current) return;
        view.current.dispatch({ effects: languageSupport.current.reconfigure(extension) });
      }).catch(() => {
        if (live.current && generation === fileGeneration.current) {
          setStatus('Syntax highlighting unavailable; plain-text editing is still available.');
        }
      });
      setFile(path); setDirty(false); onDirtyChange?.(false);
      if (restoring) remember({ file: path });
      else {
        const folder = path.split('/').slice(0, -1).join('/');
        const ancestors = folderAncestors(folder);
        remember({ file: path, folder });
        setExpanded(previous => new Set([...previous, ...ancestors]));
        for (const ancestor of ancestors.slice(1)) if (!directories[ancestor]) loadDirectory(ancestor);
        view.current.focus();
      }
    } catch (error) {
      if (live.current && generation === fileGeneration.current) setError(error.message);
    } finally {
      if (live.current && generation === fileGeneration.current) { current.current.loading = false; setLoadingFile(false); }
    }
  }

  async function save() {
    const selected = current.current;
    if (!selected.file || !selected.dirty || selected.saving || selected.loading) return;
    const content = view.current.state.sliceDoc();
    selected.saving = true; setSaving(true); onSavingChange?.(true); setError(''); setStatus('');
    try {
      await jsonRequest('/api/file', 'PUT', { root: selected.root, path: selected.file, content, originalContent: selected.baseline });
      if (!live.current || current.current !== selected) return;
      selected.baseline = content;
      selected.dirty = view.current.state.sliceDoc() !== content;
      setDirty(selected.dirty); onDirtyChange?.(selected.dirty); setStatus(`Saved ${selected.file}.`); toast?.(`Saved ${selected.file}`);
    } catch (error) {
      if (live.current && current.current === selected) setError(error.message);
    } finally {
      if (live.current && current.current === selected) { selected.saving = false; setSaving(false); onSavingChange?.(false); }
    }
  }
  saveAction.current = save;

  function fileButton(path, label) {
    return <button type="button" class="btn btn-ghost border-0 min-h-9 w-full justify-start gap-2 rounded-field px-2.5 py-2 text-left text-[13px] leading-snug text-base-content [overflow-wrap:anywhere] aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary disabled:opacity-60 sm:min-h-11" disabled={saving}
      aria-current={file === path ? 'page' : undefined} onClick={() => openFile(path)}><span class="w-4 flex-none text-center text-base-content/60" aria-hidden="true">◇</span><span>{label}</span></button>;
  }

  function directoryContents(path) {
    const directory = directories[path];
    return <div id={`code-editor-directory-${encodeURIComponent(path)}`} aria-busy={directory?.loading}>
      {directory?.loading && <p class="py-2 text-sm text-base-content/70" role="status">Loading files…</p>}
      {directory?.error && <div class="space-y-2">
        <p class="alert alert-error py-2" role="alert">{directory.error}</p>
        <button type="button" class="btn btn-ghost btn-sm border-0" onClick={() => loadDirectory(path)}>Retry {path || root}</button>
      </div>}
      {directory && !directory.loading && !directory.error && !directory.entries.length && <p class="py-2 text-sm text-base-content/70">This directory is empty.</p>}
      <ul class="m-1 list-none space-y-1 p-0 [&_ul]:ml-3 [&_ul]:border-l [&_ul]:border-base-300 [&_ul]:pl-1">
        {directory?.entries.map(entry => {
          const childPath = path ? `${path}/${entry.name}` : entry.name;
          const isDirectory = entry.type === 'directory';
          return <li class="my-1" key={childPath}>
            {isDirectory ? <>
              <button type="button" class="btn btn-ghost border-0 min-h-9 w-full justify-start gap-2 rounded-field px-2.5 py-2 text-left text-[13px] font-semibold leading-snug text-base-content [overflow-wrap:anywhere] sm:min-h-11" aria-expanded={expanded.has(childPath)}
                aria-controls={`code-editor-directory-${encodeURIComponent(childPath)}`} onClick={() => toggleDirectory(childPath)}>
                <span class="w-4 flex-none text-center text-base-content/60" aria-hidden="true">{expanded.has(childPath) ? '▾' : '▸'}</span><span>{entry.name}</span>
              </button>
              {expanded.has(childPath) && directoryContents(childPath)}
            </> : fileButton(childPath, entry.name)}
          </li>;
        })}
      </ul>
    </div>;
  }

  return <section class="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-6" aria-labelledby="code-editor-title">
    <header class="mb-3 flex flex-none items-center justify-between gap-3 sm:mb-5"><div><p class="mb-1 text-xs font-bold tracking-widest text-primary">WORKSPACE</p><h1 class="m-0 text-2xl font-bold sm:text-[28px]" id="code-editor-title" tabIndex="-1">Files</h1></div>
      <button type="button" class="btn btn-primary border-0" onClick={save} disabled={!file || !dirty || saving || loadingFile} aria-keyshortcuts="Control+s Meta+s">{saving ? 'Saving…' : 'Save'}</button>
    </header>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-box border border-base-300 lg:flex-row">
      <aside class="max-h-[35dvh] min-h-0 w-full flex-[0_1_220px] overflow-auto border-b border-base-300 bg-base-200 p-2.5 lg:max-h-none lg:w-[260px] lg:flex-none lg:border-b-0 lg:border-r lg:p-3.5" aria-label="File browser">
        <div class="mb-2.5 flex items-center justify-between gap-2 lg:mb-4"><h2 class="m-0 text-[11px] font-bold tracking-widest text-base-content/70">FILE TREE</h2>
          <button type="button" class="btn btn-ghost btn-sm border-0" onClick={refreshFiles}>Refresh files</button>
        </div>
        <form class="mb-2.5 lg:mb-4" onSubmit={changeDirectory}>
          <label class="mb-2 block text-sm font-semibold" for="code-editor-root-input">Directory</label>
          <div class="flex flex-wrap gap-1.5">
            <input class="input input-bordered h-[38px] min-w-0 flex-[1_1_130px]" id="code-editor-root-input" value={directoryInput} onInput={event => setDirectoryInput(event.currentTarget.value)} placeholder="~/sunday or /absolute/path" spellcheck={false} />
            <button type="button" class="btn btn-ghost btn-sm border-0" disabled={root === '/' || saving || loadingFile}
              onClick={() => changeDirectory(null, root.split('/').slice(0, -1).join('/') || '/')}>Up</button>
          </div>
          {directoryError && <p class="alert alert-error py-2" role="alert">{directoryError}</p>}
        </form>
        <nav class="min-w-0" aria-label={`Files in ${root}`}>
          {directoryContents('')}
        </nav>
      </aside>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col p-2.5 lg:p-3.5">
        <p class="mb-2 block text-sm [overflow-wrap:anywhere]" id="code-editor-file">{file ? `${file}${dirty ? ' — Unsaved changes' : ''}` : 'Choose a file to edit.'}</p>
        {error && <p class="alert alert-error py-2" role="alert">{error}</p>}
        <p class="mb-2 text-sm text-base-content/70 empty:hidden" role="status">{loadingFile ? 'Loading file…' : status}</p>
        <div class="min-h-0 min-w-0 flex-1 overflow-hidden rounded-box border border-base-300 text-base lg:text-sm [&_.cm-editor.cm-focused]:outline [&_.cm-editor.cm-focused]:outline-2 [&_.cm-editor.cm-focused]:outline-primary" ref={host} aria-describedby="code-editor-file" aria-busy={loadingFile || saving} />
        <p class="mt-2 flex-none text-sm text-base-content/70">Save with Ctrl+S or ⌘S.</p>
      </div>
    </div>
  </section>;
}
