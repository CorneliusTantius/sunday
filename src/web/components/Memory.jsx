import { useEffect, useMemo, useState } from 'preact/hooks';
import { request } from '../api.js';
import { renderMarkdown } from './MessageBubble.js';

export default function Memory({ toast }) {
  const [graph, setGraph] = useState({ nodes: [], edges: [], unresolved: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    request('/api/memory/graph').then(data => {
      if (!active) return;
      setGraph(data);
      setSelectedId(current => current && data.nodes.some(node => node.id === current) ? current : data.nodes[0]?.id || null);
    }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setNote(null); return; }
    let active = true;
    setNote(null);
    request(`/api/memory/notes/${encodeURIComponent(selectedId)}`).then(data => { if (active) setNote(data.note); })
      .catch(reason => { if (active) { setNote(null); toast?.(`Could not load memory note: ${reason.message}`); } });
    return () => { active = false; };
  }, [selectedId, toast]);

  const selected = graph.nodes.find(node => node.id === selectedId);
  const connected = useMemo(() => {
    const links = new Map(graph.nodes.map(node => [node.id, new Set()]));
    for (const edge of graph.edges) { links.get(edge.source)?.add(edge.target); links.get(edge.target)?.add(edge.source); }
    return links;
  }, [graph]);
  const unresolved = (graph.unresolved || []).filter(link => link.source === selectedId).map(link => link.target);
  const visible = graph.nodes.filter(node => !filter.trim() || node.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const visibleIds = new Set(visible.map(node => node.id));
  const positions = new Map(visible.map((node, index) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / Math.max(visible.length, 1);
    const radius = visible.length < 2 ? 0 : Math.min(265, Math.max(105, visible.length * 7));
    return [node.id, { x: 500 + Math.cos(angle) * radius, y: 350 + Math.sin(angle) * radius }];
  }));
  const related = [...(connected.get(selectedId) || [])].map(id => graph.nodes.find(node => node.id === id)).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));

  return <section class="memory-page" aria-labelledby="memory-title">
    <header class="memory-header">
      <div><p class="eyebrow">SHARED MEMORY</p><h1 id="memory-title">Memory graph</h1><p>Notes connect through <code>[[Exact note title]]</code> links.</p></div>
      <div class="memory-counts"><strong>{graph.nodes.length}</strong> notes <span>·</span> <strong>{graph.edges.length}</strong> links</div>
    </header>
    {error && <p class="memory-error" role="alert">Could not load memory graph: {error}</p>}
    <div class="memory-layout">
      <section class="memory-graph-panel" aria-label="Shared memory graph">
        <label class="memory-filter-label" for="memory-filter">Filter notes</label>
        <input id="memory-filter" class="text-input memory-filter" type="search" placeholder="Filter by title" value={filter} onInput={event => setFilter(event.currentTarget.value)} />
        {loading ? <p class="memory-empty">Loading shared notes…</p> : !visible.length ? <p class="memory-empty">{graph.nodes.length ? 'No note titles match.' : 'No shared notes yet. Agents can create notes with memory_update.'}</p> : <div class="memory-canvas">
          <svg viewBox="0 0 1000 700" role="img" aria-label={`${visible.length} shared memory notes and their links`}>
            {graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map(edge => {
              const from = positions.get(edge.source), to = positions.get(edge.target);
              return <line key={`${edge.source}-${edge.target}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} class="memory-edge" />;
            })}
            {visible.map(node => {
              const point = positions.get(node.id), active = node.id === selectedId;
              const radius = 9 + Math.min(7, (connected.get(node.id)?.size || 0) * 1.5);
              const label = node.title.length > 23 ? `${node.title.slice(0, 21)}…` : node.title;
              return <g key={node.id} class={`memory-node${active ? ' active' : ''}`} transform={`translate(${point.x} ${point.y})`} role="button" tabindex="0" aria-label={`Open note: ${node.title}`} aria-pressed={active} onClick={() => setSelectedId(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(node.id); } }}>
                <circle r={radius} /><text y={radius + 20}>{label}</text>
              </g>;
            })}
          </svg>
        </div>}
      </section>
      <aside class="memory-note-panel" aria-label="Selected memory note">
        {selected ? <>
          <p class="eyebrow">NOTE</p><h2>{selected.title}</h2>
          {note ? <div class="memory-note-content markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content || '_This note has no content._') }} /> : <p class="memory-empty">Loading note…</p>}
          {related.length > 0 && <div class="memory-related"><h3>Linked notes</h3>{related.map(item => <button key={item.id} class="memory-link" onClick={() => setSelectedId(item.id)}>{item.title}</button>)}</div>}
          {unresolved.length > 0 && <div class="memory-unresolved"><h3>Unresolved links</h3><p>{[...new Set(unresolved)].map(target => `[[${target}]]`).join(', ')}</p></div>}
        </> : <p class="memory-empty">Select a note to inspect it.</p>}
      </aside>
    </div>
  </section>;
}
