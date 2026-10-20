import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

export default function Memory({ toast }) {
  const [sources, setSources] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [links, setLinks] = useState([]);
  const [linkTarget, setLinkTarget] = useState('');
  const [linkRelation, setLinkRelation] = useState('related');
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [graphLoading, setGraphLoading] = useState(true);
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [indexOpen, setIndexOpen] = useState(false);
  const indexButton = useRef(null);
  const indexDialog = useRef(null);
  const sourceInput = useRef(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  async function refreshSources() {
    const data = await request('/api/context/sources');
    setSources(data.sources);
    const next = data.sources.find(item => item.id === selected?.id) || data.sources[0];
    setSelected(next ? (await request(`/api/context/sources/${next.id}`)).source : null);
  }

  async function refreshGraph() {
    setGraphLoading(true);
    setError('');
    try { setGraph(await request('/api/context/graph')); }
    catch (reason) { setError(reason.message); }
    finally { setGraphLoading(false); }
  }

  useEffect(() => {
    let active = true;
    request('/api/context/graph')
      .then(data => { if (active) setGraph(data); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setGraphLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) { setLinks([]); return; }
    let active = true;
    setLinksLoading(true);
    request(`/api/context/links?source=${encodeURIComponent(selected.source)}`)
      .then(data => { if (active) setLinks(data.links); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLinksLoading(false); });
    return () => { active = false; };
  }, [selected?.source]);

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

  useEffect(() => {
    if (!indexOpen) return;
    const dialog = indexDialog.current;
    const trigger = indexButton.current;
    sourceInput.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        setError('');
        setIndexOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
        .filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [indexOpen]);

  function openIndexer() { setError(''); setIndexOpen(true); }
  function closeIndexer() {
    if (busyRef.current) return;
    setError('');
    setIndexOpen(false);
  }

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

  async function refreshLinks(sourceName) {
    const data = await request(`/api/context/links?source=${encodeURIComponent(sourceName)}`);
    setLinks(data.links);
  }

  async function linkSource(event) {
    event.preventDefault();
    if (!selected || !linkTarget) return;
    setLinkBusy(true);
    setError('');
    try {
      await jsonRequest('/api/context/links', 'POST', { source: selected.source, target: linkTarget, relation: linkRelation.trim() || 'related' });
      await Promise.all([refreshLinks(selected.source), refreshGraph()]);
      setLinkTarget(''); setLinkRelation('related');
    } catch (reason) { setError(reason.message); }
    finally { setLinkBusy(false); }
  }

  async function unlinkSource(link) {
    setLinkBusy(true);
    setError('');
    try {
      await jsonRequest('/api/context/links', 'DELETE', { source: link.source, target: link.target });
      await Promise.all([refreshLinks(selected.source), refreshGraph()]);
    } catch (reason) { setError(reason.message); }
    finally { setLinkBusy(false); }
  }

  async function indexSource(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await jsonRequest('/api/context/sources', 'POST', { source, title, content });
      await Promise.all([refreshSources(), refreshGraph()]);
      setSource(''); setTitle(''); setContent('');
      setIndexOpen(false);
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
      await Promise.all([refreshSources(), refreshGraph()]);
      toast?.('Context source removed');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const graphColumns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(graph.nodes.length))));
  const graphRows = Math.ceil(graph.nodes.length / graphColumns);
  const graphWidth = Math.max(420, graphColumns * 190 + 20);
  const graphHeight = Math.max(190, graphRows * 110 + 25);
  const graphOffsetX = (graphWidth - graphColumns * 190) / 2;
  const graphNodes = graph.nodes.map((node, index) => ({
    ...node,
    x: graphOffsetX + 95 + (index % graphColumns) * 190,
    y: 60 + Math.floor(index / graphColumns) * 110,
  }));
  const graphPositionBySource = new Map(graphNodes.map(node => [node.source, node]));

  return <section class="context-page" aria-labelledby="context-title">
    <header class="context-header">
      <div><p class="eyebrow">CONTEXT MODE</p><h1 id="context-title" tabIndex="-1">Indexed context</h1><p>Add selected documents and durable facts for agents to retrieve later.</p></div>
      <div class="context-header-actions">
        <div class="context-count"><strong>{sources.length}</strong> sources</div>
        <button ref={indexButton} class="context-button" type="button" onClick={openIndexer}>＋ Index a source</button>
      </div>
    </header>
    {error && !indexOpen && <p class="context-error" role="alert">{error}</p>}
    <section class="context-panel context-global-panel" aria-labelledby="context-global-title">
      <header class="context-global-header">
        <div><h2 id="context-global-title">Knowledge graph</h2><p>All indexed notes and their directed links. Select a note to inspect it.</p></div>
        <div class="context-global-meta"><span>{graph.nodes.length} notes · {graph.links.length} links</span><button class="context-button secondary" type="button" disabled={graphLoading} onClick={refreshGraph}>{graphLoading ? 'Refreshing…' : 'Refresh graph'}</button></div>
      </header>
      {graphLoading ? <p class="context-empty">Loading graph…</p> : graph.nodes.length ? <div class="context-global-scroll" role="group" aria-label="Graph of all indexed context notes">
        <div class="context-global-canvas" style={{ width: `${graphWidth}px`, height: `${graphHeight}px` }}>
          <svg class="context-global-edges" width={graphWidth} height={graphHeight} viewBox={`0 0 ${graphWidth} ${graphHeight}`} aria-hidden="true">
            <defs><marker id="context-link-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
            {graph.links.map(link => {
              const from = graphPositionBySource.get(link.source), to = graphPositionBySource.get(link.target);
              if (!from || !to) return null;
              return <g key={`${link.source}:${link.target}`}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#context-link-arrow)" />
                <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5}>{link.relation}</text>
              </g>;
            })}
          </svg>
          {graphNodes.map(node => <button key={node.id} class={`context-graph-node context-global-node${selected?.id === node.id ? ' active' : ''}`} type="button" title={node.source} aria-label={`Open note: ${node.title}`} style={{ left: `${node.x}px`, top: `${node.y}px` }} onClick={() => openSource(node.id)}><strong>{node.title}</strong><span>{node.source}</span></button>)}
        </div>
      </div> : <p class="context-empty">No indexed notes yet. Index notes to populate the graph.</p>}
    </section>
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
            <section class="context-note-links" aria-labelledby="context-links-title">
              <h3 id="context-links-title">Linked notes</h3>
              {linksLoading ? <p class="context-empty">Loading links…</p> : links.length ? <>
                <ul class="context-link-list">
                  {links.map(link => {
                    const other = link.source === selected.source ? link.target : link.source;
                    const item = sources.find(sourceItem => sourceItem.source === other);
                    return <li key={`${link.source}:${link.target}`}><button type="button" class="context-link-open" onClick={() => item && openSource(item.id)}>{item?.title || other}</button><span>{link.relation} · {link.source === selected.source ? 'outgoing' : 'incoming'}</span><button type="button" class="context-link-remove" aria-label={`Remove link to ${item?.title || other}`} disabled={linkBusy} onClick={() => unlinkSource(link)}>×</button></li>;
                  })}
                </ul>
              </> : <p class="context-empty">No linked notes yet.</p>}
              <form class="context-link-form" onSubmit={linkSource}>
                <label class="field-label" for="context-link-target">Link to note</label>
                <div class="context-link-controls">
                  <select class="text-input" id="context-link-target" required value={linkTarget} onChange={event => setLinkTarget(event.currentTarget.value)}>
                    <option value="">Choose an indexed note…</option>
                    {sources.filter(item => item.source !== selected.source).map(item => <option key={item.id} value={item.source}>{item.title} · {item.source}</option>)}
                  </select>
                  <input class="text-input" aria-label="Relationship" placeholder="Relationship" maxLength={80} value={linkRelation} onInput={event => setLinkRelation(event.currentTarget.value)} />
                  <button class="context-button" type="submit" disabled={linkBusy || !linkTarget}>{linkBusy ? 'Linking…' : 'Link note'}</button>
                </div>
              </form>
            </section>
          </> : <p class="context-empty">Select a source to inspect it.</p>}
        </section>
      </div>
    </div>
    {indexOpen && <div class="modal-backdrop context-modal-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) closeIndexer(); }}>
      <section ref={indexDialog} class="context-modal" role="dialog" aria-modal="true" aria-labelledby="context-index-title" aria-describedby="context-index-help">
        <header class="context-modal-header">
          <div><p class="eyebrow">CONTEXT MODE</p><h2 id="context-index-title">Index a source</h2></div>
          <button class="icon-button" type="button" aria-label="Close index source dialog" disabled={busy} onClick={closeIndexer}>×</button>
        </header>
        <p class="field-note" id="context-index-help">Sources are shared with agents that have Context search enabled. Reuse the same source name to update it.</p>
        {error && <p class="context-error" role="alert">{error}</p>}
        <form class="context-index-form" onSubmit={indexSource}>
          <label class="field-label" for="context-source">Source ID</label>
          <input ref={sourceInput} class="text-input" id="context-source" required maxLength={300} value={source} onInput={event => setSource(event.currentTarget.value)} placeholder="docs/release-guide.md" />
          <label class="field-label" for="context-source-title">Title</label>
          <input class="text-input" id="context-source-title" required maxLength={120} value={title} onInput={event => setTitle(event.currentTarget.value)} placeholder="Release guide" />
          <label class="field-label" for="context-content">Content</label>
          <textarea class="text-input context-content-input" id="context-content" required maxLength={200000} value={content} onInput={event => setContent(event.currentTarget.value)} placeholder="Paste selected text or durable facts to make them searchable." />
          <div class="context-modal-actions">
            <button class="context-button secondary" type="button" disabled={busy} onClick={closeIndexer}>Cancel</button>
            <button class="context-button" type="submit" disabled={busy}>{busy ? 'Indexing…' : 'Index source'}</button>
          </div>
        </form>
      </section>
    </div>}
  </section>;
}
