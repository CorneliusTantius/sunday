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
  const pullLock = useRef(false);
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
    if (cloning || syncingRepo || syncingAll || pullLock.current) return;
    pullLock.current = true;
    setCloning(true); setStatus('Cloning repository…');
    try { const data = await jsonRequest('/api/repos', 'POST', { url: url.trim() }); setUrl(''); await load(); toast(`Cloned ${data.repo.name}`); }
    catch (error) { setStatus(error.message); }
    finally { pullLock.current = false; setCloning(false); }
  }
  async function sync(repo) {
    if (syncingRepo || syncingAll || pullLock.current) return;
    pullLock.current = true;
    setSyncingRepo(repo.name);
    try {
      await jsonRequest(`/api/repos/${encodeURIComponent(repo.name)}/pull`, 'POST', {});
      await load();
      toast(`Pulled latest for ${repo.name}`);
    } catch (error) { setStatus(`Could not pull ${repo.name}: ${error.message}`); }
    finally { pullLock.current = false; setSyncingRepo(''); }
  }
  async function syncAll() {
    if (cloning || syncingRepo || syncingAll || pullLock.current || !repos.length) return;
    pullLock.current = true;
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
    } finally { pullLock.current = false; setSyncingAll(false); }
  }
  return <section class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden px-4 py-8 sm:px-6 sm:py-12" id="repositories-page" aria-labelledby="repositories-title">
    <header class="mb-6 flex flex-none flex-wrap items-center justify-between gap-4"><div><p class="text-xs font-bold tracking-widest text-primary">WORKSPACE</p><h1 id="repositories-title" tabIndex="-1">Repositories</h1><p class="text-sm text-base-content/70">~/sunday/workspace/repos/</p></div><div class="flex flex-wrap gap-2"><button class="btn btn-ghost border-0" id="pull-all-repos" disabled={Boolean(cloning || syncingRepo || syncingAll || !repos.length)} onClick={syncAll}>{syncingAll ? 'Pulling…' : 'Pull all'}</button><button class="btn btn-ghost border-0" id="refresh-repos" disabled={Boolean(cloning || syncingRepo || syncingAll)} onClick={load}>Refresh</button></div></header>
    <form class="mb-4 flex-none rounded-box border border-base-300 border-t-2 border-t-primary bg-base-200 p-4 sm:p-6" id="clone-form" onSubmit={clone}><label class="label font-semibold" for="repo-url">Clone repository</label><div class="flex flex-wrap gap-2 [&>input]:min-w-0 [&>input]:flex-1"><input class="input input-bordered w-full" id="repo-url" type="url" required placeholder="https://github.com/owner/repo.git" value={url} disabled={Boolean(cloning || syncingRepo || syncingAll)} onInput={event => setUrl(event.currentTarget.value)} /><button class="btn btn-primary border-0" id="clone-repo" type="submit" disabled={Boolean(cloning || syncingRepo || syncingAll)}>Git clone</button></div></form>
    <p class="text-sm text-base-content/70 flex-none" id="repo-status" role="status">{status}</p><ul id="repos-list" class="grid min-h-0 flex-1 list-none gap-3 overflow-y-auto overscroll-y-contain p-0 pt-3" aria-label="Cloned repositories">{repos.map(repo => <li class="card card-border bg-base-100 p-4 sm:flex-row sm:items-center sm:justify-between" key={repo.name}><div class="flex min-w-0 flex-col gap-1"><span class="font-semibold break-all">{repo.name}</span><span class="text-sm text-base-content/70"><span class="font-medium text-base-content">Branch</span> {repo.branch || repo.branchError || 'Unavailable'}</span></div><span class="flex flex-wrap gap-2" aria-label={`Git status for ${repo.name}`}>{repo.gitStatus ? Object.entries(repo.gitStatus).filter(([, count]) => count > 0).map(([kind, count]) => <span class="badge badge-outline" key={kind}>{count} {kind}</span>) : <span class="badge badge-outline" title={repo.gitStatusError}>{repo.gitStatusError || 'Status unavailable'}</span>}</span><button type="button" class="btn btn-ghost border-0" aria-label={`Pull latest for ${repo.name}`} title={repo.branch ? 'Pull latest changes from this repository’s upstream branch' : (repo.branchError || 'Branch unavailable')} disabled={Boolean(cloning || syncingRepo || syncingAll || !repo.branch)} onClick={() => sync(repo)}>{syncingRepo === repo.name ? 'Pulling…' : 'Pull latest'}</button></li>)}</ul>
  </section>;
}
