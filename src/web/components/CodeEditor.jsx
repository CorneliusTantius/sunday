import { useEffect, useRef, useState } from 'preact/hooks';
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { request, jsonRequest } from '../api.js';

function language(path) {
  const extension = path.split('.').pop().toLowerCase();
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(extension)) return javascript({ jsx: /jsx|tsx/.test(extension), typescript: /ts|tsx/.test(extension) });
  if (extension === 'json') return json();
  if (extension === 'py') return python();
  if (['html', 'htm'].includes(extension)) return html();
  if (extension === 'css') return css();
  return [];
}

const darkTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg, #090b10)', color: 'var(--text, #e7edf5)', height: '100%' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
  '.cm-content': { caretColor: '#c5a3ff' },
  '.cm-gutters': { backgroundColor: 'var(--panel, #11151d)', color: '#8994a5', borderColor: '#303846' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#1a202b' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#493260' },
  '.cm-cursor': { borderLeftColor: '#c5a3ff' },
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
      basicSetup, darkTheme, syntaxHighlighting(defaultHighlightStyle), language(path),
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
    return <button type="button" class="code-editor-file-button" disabled={saving}
      aria-current={file === path ? 'page' : undefined} onClick={() => openFile(path)}>{label}</button>;
  }

  function directoryContents(path) {
    const directory = directories[path];
    return <div class="code-editor-directory" id={`code-editor-directory-${encodeURIComponent(path)}`} aria-busy={directory?.loading}>
      {directory?.loading && <p class="field-note" role="status">Loading files…</p>}
      {directory?.error && <div class="code-editor-directory-error">
        <p class="form-error" role="alert">{directory.error}</p>
        <button type="button" class="secondary-button" onClick={() => loadDirectory(path)}>Retry {path || root}</button>
      </div>}
      {directory && !directory.loading && !directory.error && !directory.entries.length && <p class="field-note">This directory is empty.</p>}
      <ul class="code-editor-tree-list">
        {directory?.entries.map(entry => {
          const childPath = path ? `${path}/${entry.name}` : entry.name;
          const isDirectory = entry.type === 'directory';
          return <li class="code-editor-tree-item" key={childPath}>
            {isDirectory ? <>
              <button type="button" class="code-editor-directory-button" aria-expanded={expanded.has(childPath)}
                aria-controls={`code-editor-directory-${encodeURIComponent(childPath)}`} onClick={() => toggleDirectory(childPath)}>
                <span aria-hidden="true">{expanded.has(childPath) ? '▾' : '▸'} </span>{entry.name}/
              </button>
              {expanded.has(childPath) && directoryContents(childPath)}
            </> : fileButton(childPath, entry.name)}
          </li>;
        })}
      </ul>
    </div>;
  }

  return <section class="code-editor-page" aria-labelledby="code-editor-title">
    <header class="code-editor-header"><div><p class="eyebrow">WORKSPACE</p><h1 id="code-editor-title" tabIndex="-1">Files</h1></div>
      <button type="button" class="primary-button" onClick={save} disabled={!file || !dirty || saving || loadingFile} aria-keyshortcuts="Control+s Meta+s">{saving ? 'Saving…' : 'Save'}</button>
    </header>
    <div class="code-editor-layout">
      <aside class="code-editor-sidebar" aria-label="File browser">
        <div class="code-editor-sidebar-header"><h2 class="code-editor-tree-title">FILE TREE</h2>
          <button type="button" class="secondary-button" onClick={refreshFiles}>Refresh files</button>
        </div>
        <form class="code-editor-search" onSubmit={changeDirectory}>
          <label class="field-label" for="code-editor-root-input">Directory</label>
          <div class="code-editor-search-controls">
            <input class="text-input" id="code-editor-root-input" value={directoryInput} onInput={event => setDirectoryInput(event.currentTarget.value)} placeholder="~/sunday or /absolute/path" spellcheck={false} />
            <button type="submit" class="secondary-button" disabled={!directoryInput.trim() || saving || loadingFile}>Open</button>
            <button type="button" class="secondary-button" disabled={root === '/' || saving || loadingFile}
              onClick={() => changeDirectory(null, root.split('/').slice(0, -1).join('/') || '/')}>Up</button>
          </div>
          {directoryError && <p class="form-error" role="alert">{directoryError}</p>}
        </form>
        <form class="code-editor-search" onSubmit={searchFiles}>
          <label class="field-label" for="code-editor-search">Search filenames</label>
          <div class="code-editor-search-controls">
            <input class="text-input" id="code-editor-search" type="search" value={query} onInput={changeQuery} placeholder="Filename contains…" />
            <button type="submit" class="secondary-button" disabled={!query.trim() || searching}>Search</button>
          </div>
        </form>
        <div class="code-editor-search-results" aria-busy={searching}>
          {searching && <p class="field-note" role="status">Searching files…</p>}
          {searchError && <p class="form-error" role="alert">{searchError}</p>}
          {results && <>
            <p class="field-note" role="status">{results.files.length ? `${results.files.length} matching files.` : 'No matching files.'}{results.truncated ? ' Results truncated; narrow your search.' : ''}</p>
            <ul class="code-editor-results-list" aria-label="Matching files">
              {results.files.map(path => <li key={path}>{fileButton(path, path)}</li>)}
            </ul>
          </>}
        </div>
        <nav class="code-editor-tree" aria-label={`Files in ${root}`}>
          <button type="button" class="code-editor-root code-editor-directory-button" aria-expanded={expanded.has('')}
            aria-controls="code-editor-directory-" onClick={() => toggleDirectory('')}>
            <span aria-hidden="true">{expanded.has('') ? '▾' : '▸'} </span>{root}
          </button>
          {expanded.has('') && directoryContents('')}
        </nav>
      </aside>
      <div class="code-editor-main">
        <p class="code-editor-file-label field-label" id="code-editor-file">{file ? `${file}${dirty ? ' — Unsaved changes' : ''}` : 'Choose a file to edit.'}</p>
        {error && <p class="form-error" role="alert">{error}</p>}
        <p class="code-editor-status field-note" role="status">{loadingFile ? 'Loading file…' : status}</p>
        <div class="code-editor-host" ref={host} aria-describedby="code-editor-file" aria-busy={loadingFile || saving} />
        <p class="code-editor-save-hint field-note">Save with Ctrl+S or ⌘S.</p>
      </div>
    </div>
  </section>;
}
