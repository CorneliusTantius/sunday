import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

export default function Repositories({ toast }) {
  const [repos, setRepos] = useState([]);
  const [status, setStatus] = useState('Loading repositories…');
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const generation = useRef(0);
  async function load() {
    const current = ++generation.current;
    setStatus('Loading repositories…');
    try {
      const data = await request('/api/repos');
      if (current !== generation.current) return;
      setRepos(data.repos); setStatus(data.repos.length ? '' : 'No repositories yet.');
    } catch (error) { if (current === generation.current) setStatus(error.message); }
  }
  useEffect(() => { load(); return () => { generation.current++; }; }, []);
  async function clone(event) {
    event.preventDefault();
    if (cloning) return;
    setCloning(true); setStatus('Cloning repository…');
    try { const data = await jsonRequest('/api/repos', 'POST', { url: url.trim() }); setUrl(''); await load(); toast(`Cloned ${data.repo.name}`); }
    catch (error) { setStatus(error.message); }
    finally { setCloning(false); }
  }
  return <section class="repositories-page" id="repositories-page" aria-labelledby="repositories-title">
    <header class="repositories-header"><div><p class="eyebrow">WORKSPACE</p><h1 id="repositories-title" tabIndex="-1">Repositories</h1><p class="field-note">~/sunday/workspace/repos/</p></div><button class="secondary-button" id="refresh-repos" disabled={cloning} onClick={load}>Refresh</button></header>
    <form class="repository-clone" id="clone-form" onSubmit={clone}><label class="field-label" for="repo-url">Clone repository</label><div class="code-row"><input class="text-input" id="repo-url" type="url" required placeholder="https://github.com/owner/repo.git" value={url} disabled={cloning} onInput={event => setUrl(event.currentTarget.value)} /><button class="primary-button" id="clone-repo" type="submit" disabled={cloning}>Git clone</button></div></form>
    <p class="field-note" id="repo-status" role="status">{status}</p><ul id="repos-list" class="repos-list" aria-label="Cloned repositories">{repos.map(repo => <li key={repo.name}>{repo.name}</li>)}</ul>
  </section>;
}
