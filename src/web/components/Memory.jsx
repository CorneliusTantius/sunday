import { useEffect, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

export default function Memory({ toast }) {
  const [sources, setSources] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refreshSources() {
    const data = await request('/api/context/sources');
    setSources(data.sources);
    const next = data.sources.find(item => item.id === selected?.id) || data.sources[0];
    setSelected(next ? (await request(`/api/context/sources/${next.id}`)).source : null);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await request('/api/context/sources');
        if (!active) return;
        setSources(data.sources);
        if (data.sources.length) {
          const result = await request(`/api/context/sources/${data.sources[0].id}`);
          if (active) setSelected(result.source);
        }
      } catch (reason) { if (active) setError(reason.message); }
      finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, []);

  async function search(event) {
    event.preventDefault();
    setError('');
    if (!query.trim()) { setResults([]); return; }
    try { setResults((await request(`/api/context/search?q=${encodeURIComponent(query)}`)).results); }
    catch (reason) { setError(reason.message); }
  }

  async function openSource(id) {
    setError('');
    try { setSelected((await request(`/api/context/sources/${id}`)).source); }
    catch (reason) { setError(reason.message); }
  }

  async function indexSource(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await jsonRequest('/api/context/sources', 'POST', { source, title, content });
      setSource(''); setTitle(''); setContent('');
      await refreshSources();
      toast?.('Context source indexed');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function removeSource() {
    if (!selected || !confirm(`Remove “${selected.title}” from the context index?`)) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/context/sources/${selected.id}`, { method: 'DELETE' });
      setSelected(null);
      await refreshSources();
      toast?.('Context source removed');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  return <section class="context-page" aria-labelledby="context-title">
    <header class="context-header">
      <div><p class="eyebrow">CONTEXT MODE</p><h1 id="context-title" tabIndex="-1">Indexed context</h1><p>Add selected documents and durable facts for agents to retrieve later.</p></div>
      <div class="context-count"><strong>{sources.length}</strong> sources</div>
    </header>
    {error && <p class="context-error" role="alert">{error}</p>}
    <div class="context-layout">
      <section class="context-panel" aria-label="Indexed sources">
        <h2>Sources</h2>
        {loading ? <p class="context-empty">Loading sources…</p> : sources.length ? <ul class="context-source-list">
          {sources.map(item => <li key={item.id}><button class={`context-source${selected?.id === item.id ? ' active' : ''}`} onClick={() => openSource(item.id)}>
            <strong>{item.title}</strong><span>{item.source}</span><small>{item.chunks} chunks · {item.characters.toLocaleString()} characters</small>
          </button></li>)}
        </ul> : <p class="context-empty">No indexed sources yet.</p>}
        <form class="context-search" onSubmit={search}>
          <label class="field-label" for="context-search">Search indexed context</label>
          <div class="context-search-row"><input class="text-input" id="context-search" maxLength={300} value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search documents" /><button class="context-button" type="submit">Search</button></div>
        </form>
        {results.length > 0 && <div class="context-results" aria-label="Search results">
          {results.map((result, index) => <button class="context-result" key={`${result.source}-${index}`} onClick={() => { const item = sources.find(source => source.source === result.source); if (item) openSource(item.id); }}>
            <strong>{result.title}</strong><span>{result.source}</span><p>{result.excerpt}</p>
          </button>)}
        </div>}
      </section>
      <div class="context-detail-column">
        <section class="context-panel context-detail" aria-label="Selected source">
          {selected ? <>
            <div class="context-detail-header"><div><p class="eyebrow">{selected.scope}</p><h2>{selected.title}</h2><p>{selected.source}</p></div><button class="context-button secondary" type="button" disabled={busy} onClick={removeSource}>Remove</button></div>
            <pre>{selected.content}</pre>
          </> : <p class="context-empty">Select a source to inspect it.</p>}
        </section>
        <form class="context-panel context-index-form" onSubmit={indexSource}>
          <h2>Index a source</h2>
          <p class="field-note">Sources are shared with agents that have Context search enabled. Reuse the same source name to update it.</p>
          <label class="field-label" for="context-source">Source ID</label>
          <input class="text-input" id="context-source" required maxLength={300} value={source} onInput={event => setSource(event.currentTarget.value)} placeholder="docs/release-guide.md" />
          <label class="field-label" for="context-source-title">Title</label>
          <input class="text-input" id="context-source-title" required maxLength={120} value={title} onInput={event => setTitle(event.currentTarget.value)} placeholder="Release guide" />
          <label class="field-label" for="context-content">Content</label>
          <textarea class="text-input context-content-input" id="context-content" required maxLength={200000} value={content} onInput={event => setContent(event.currentTarget.value)} placeholder="Paste selected text or durable facts to make them searchable." />
          <button class="context-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Index source'}</button>
        </form>
      </div>
    </div>
  </section>;
}
