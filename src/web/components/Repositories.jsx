import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

export default function Repositories({ toast }) {
  const [repos, setRepos] = useState([]);
  const [status, setStatus] = useState('Loading repositories…');
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [syncingRepo, setSyncingRepo] = useState('');
  const [syncingAll, setSyncingAll] = useState(false);
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
    if (cloning || syncingRepo || syncingAll) return;
    setCloning(true); setStatus('Cloning repository…');
    try { const data = await jsonRequest('/api/repos', 'POST', { url: url.trim() }); setUrl(''); await load(); toast(`Cloned ${data.repo.name}`); }
    catch (error) { setStatus(error.message); }
    finally { setCloning(false); }
  }
  async function sync(repo) {
    if (syncingRepo || syncingAll) return;
    setSyncingRepo(repo.name);
    try {
      await jsonRequest(`/api/repos/${encodeURIComponent(repo.name)}/pull`, 'POST', {});
      await load();
      toast(`Pulled latest for ${repo.name}`);
    } catch (error) { setStatus(`Could not pull ${repo.name}: ${error.message}`); }
    finally { setSyncingRepo(''); }
  }
  async function syncAll() {
    if (cloning || syncingRepo || syncingAll || !repos.length) return;
    setSyncingAll(true);
    const failures = [];
    try {
      for (const [index, repo] of repos.entries()) {
        setStatus(`Pulling ${repo.name} (${index + 1}/${repos.length})…`);
        try { await jsonRequest(`/api/repos/${encodeURIComponent(repo.name)}/pull`, 'POST', {}); }
        catch (error) { failures.push(`${repo.name}: ${error.message}`); }
      }
      await load();
      if (failures.length) setStatus(`Could not pull ${failures.join('; ')}`);
      else setStatus(`Pulled all ${repos.length} repositories.`);
      toast(failures.length ? `Pulled ${repos.length - failures.length} of ${repos.length} repositories` : 'Pulled all repositories');
    } finally { setSyncingAll(false); }
  }
  return <section class="repositories-page" id="repositories-page" aria-labelledby="repositories-title">
    <header class="repositories-header"><div><p class="eyebrow">WORKSPACE</p><h1 id="repositories-title" tabIndex="-1">Repositories</h1><p class="field-note">~/sunday/workspace/repos/</p></div><div class="repository-actions"><button class="secondary-button" id="pull-all-repos" disabled={Boolean(cloning || syncingRepo || syncingAll || !repos.length)} onClick={syncAll}>{syncingAll ? 'Pulling…' : 'Pull all'}</button><button class="secondary-button" id="refresh-repos" disabled={Boolean(cloning || syncingRepo || syncingAll)} onClick={load}>Refresh</button></div></header>
    <form class="repository-clone" id="clone-form" onSubmit={clone}><label class="field-label" for="repo-url">Clone repository</label><div class="code-row"><input class="text-input" id="repo-url" type="url" required placeholder="https://github.com/owner/repo.git" value={url} disabled={Boolean(cloning || syncingRepo || syncingAll)} onInput={event => setUrl(event.currentTarget.value)} /><button class="primary-button" id="clone-repo" type="submit" disabled={Boolean(cloning || syncingRepo || syncingAll)}>Git clone</button></div></form>
    <p class="field-note" id="repo-status" role="status">{status}</p><ul id="repos-list" class="repos-list" aria-label="Cloned repositories">{repos.map(repo => <li key={repo.name}><div class="repo-identity"><span class="repo-name">{repo.name}</span><span class="repo-branch"><span class="repo-branch-label">Branch</span> {repo.branch || repo.branchError || 'Unavailable'}</span></div><span class="repo-git-status" aria-label={`Git status for ${repo.name}`}>{repo.gitStatus ? (Object.values(repo.gitStatus).some(Boolean) ? Object.entries(repo.gitStatus).filter(([, count]) => count > 0).map(([kind, count]) => <span class={`repo-status-pill ${kind}`} key={kind}>{count} {kind}</span>) : <span class="repo-status-pill clean">Clean</span>) : <span class="repo-status-pill" title={repo.gitStatusError}>{repo.gitStatusError || 'Status unavailable'}</span>}</span><button type="button" class="secondary-button repo-sync-button" aria-label={`Pull latest for ${repo.name}`} title={repo.branch ? 'Pull latest changes from this repository’s upstream branch' : (repo.branchError || 'Branch unavailable')} disabled={Boolean(cloning || syncingRepo || syncingAll || !repo.branch)} onClick={() => sync(repo)}>{syncingRepo === repo.name ? 'Pulling…' : 'Pull latest'}</button></li>)}</ul>
  </section>;
}
