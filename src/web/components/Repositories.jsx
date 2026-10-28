import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

const AUTO_PULL_INTERVAL = 5 * 60 * 1000;
const AUTO_PULL_PREFERENCE = 'sunday-repositories-auto-pull';
function readAutoPullPreference() {
  try { return globalThis.localStorage?.getItem(AUTO_PULL_PREFERENCE) === 'true'; }
  catch { return false; }
}

export default function Repositories({ toast }) {
  const [repos, setRepos] = useState([]);
  const [status, setStatus] = useState('Loading repositories…');
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [syncingRepo, setSyncingRepo] = useState('');
  const [syncingAll, setSyncingAll] = useState(false);
  const [autoPullEnabled, setAutoPullEnabled] = useState(readAutoPullPreference());
  const [autoPulling, setAutoPulling] = useState(false);
  const [autoPullStatus, setAutoPullStatus] = useState('Automatic pull is off.');
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
  useEffect(() => {
    if (!autoPullEnabled) return;
    let active = true;
    let timer;
    setAutoPullStatus('Automatic pull is enabled; checking every 5 minutes while this page is open.');
    const schedule = () => {
      timer = setTimeout(async () => {
        await autoPull(() => active);
        if (active) schedule();
      }, AUTO_PULL_INTERVAL);
    };
    schedule();
    return () => { active = false; clearTimeout(timer); };
  }, [autoPullEnabled]);
  function toggleAutoPull(event) {
    const enabled = event.currentTarget.checked;
    setAutoPullEnabled(enabled);
    setAutoPullStatus(enabled ? 'Automatic pull is enabled; checking every 5 minutes while this page is open.' : 'Automatic pull is off.');
    try { globalThis.localStorage?.setItem(AUTO_PULL_PREFERENCE, String(enabled)); } catch { /* Storage may be unavailable. */ }
  }
  async function clone(event) {
    event.preventDefault();
    if (cloning || syncingRepo || syncingAll || autoPulling || pullLock.current) return;
    pullLock.current = true;
    setCloning(true); setStatus('Cloning repository…');
    try { const data = await jsonRequest('/api/repos', 'POST', { url: url.trim() }); setUrl(''); await load(); toast(`Cloned ${data.repo.name}`); }
    catch (error) { setStatus(error.message); }
    finally { pullLock.current = false; setCloning(false); }
  }
  async function sync(repo) {
    if (syncingRepo || syncingAll || autoPulling || pullLock.current) return;
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
    if (cloning || syncingRepo || syncingAll || autoPulling || pullLock.current || !repos.length) return;
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
  async function autoPull(isActive = () => true) {
    if (pullLock.current) return;
    pullLock.current = true;
    setAutoPulling(true);
    setAutoPullStatus('Automatic pull is checking repositories…');
    try {
      const data = await request('/api/repos');
      const eligible = data.repos.filter(repo => repo.branch === 'main' && repo.gitStatus
        && Object.keys(repo.gitStatus).length === 4
        && ['staged', 'unstaged', 'untracked', 'conflicted'].every(kind => repo.gitStatus[kind] === 0));
      const skipped = data.repos.length - eligible.length;
      if (!isActive()) return;
      if (!eligible.length) {
        setAutoPullStatus(`No clean repositories on main to pull${skipped ? ` (${skipped} skipped).` : '.'}`);
        return;
      }
      const failures = [];
      let pulled = 0;
      for (const repo of eligible) {
        if (!isActive()) return;
        try {
          await jsonRequest(`/api/repos/${encodeURIComponent(repo.name)}/pull`, 'POST', {});
          pulled++;
        } catch (error) { failures.push(`${repo.name}: ${error.message}`); }
      }
      if (!isActive()) return;
      await load();
      if (!isActive()) return;
      setAutoPullStatus(failures.length ? `Auto-pull checked ${eligible.length}; ${pulled} completed; failed: ${failures.join('; ')}.` : `Auto-pull checked ${pulled} clean main-branch ${pulled === 1 ? 'repository' : 'repositories'}${skipped ? ` (${skipped} skipped).` : '.'}`);
    } catch (error) {
      if (isActive()) setAutoPullStatus(`Automatic pull failed: ${error.message}`);
    } finally {
      pullLock.current = false;
      setAutoPulling(false);
    }
  }
  return <section class="mx-auto w-full max-w-5xl p-6" id="repositories-page" aria-labelledby="repositories-title">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-4"><div><p class="text-xs font-bold tracking-widest text-primary">WORKSPACE</p><h1 id="repositories-title" tabIndex="-1">Repositories</h1><p class="text-sm text-base-content/70">~/sunday/workspace/repos/</p></div><div class="flex flex-wrap gap-2"><button class="btn btn-outline" id="pull-all-repos" disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling || !repos.length)} onClick={syncAll}>{syncingAll ? 'Pulling…' : 'Pull all'}</button><button class="btn btn-outline" id="refresh-repos" disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling)} onClick={load}>Refresh</button></div></header>
    <form class="mb-4 border-t-2 border-primary pt-4" id="clone-form" onSubmit={clone}><label class="label font-semibold" for="repo-url">Clone repository</label><div class="flex flex-wrap gap-2 [&>input]:min-w-0 [&>input]:flex-1"><input class="input input-bordered w-full" id="repo-url" type="url" required placeholder="https://github.com/owner/repo.git" value={url} disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling)} onInput={event => setUrl(event.currentTarget.value)} /><button class="btn btn-primary" id="clone-repo" type="submit" disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling)}>Git clone</button></div></form>
    <label class="label cursor-pointer justify-start gap-3"><input class="checkbox" id="auto-pull-repositories" type="checkbox" checked={autoPullEnabled} onChange={toggleAutoPull} /> Automatically pull clean repositories on <code>main</code> every 5 minutes while this page is open</label>
    <p class="text-sm text-base-content/70" id="auto-pull-status" role="status">{autoPullStatus}</p>
    <p class="text-sm text-base-content/70" id="repo-status" role="status">{status}</p><ul id="repos-list" class="grid list-none gap-3 p-0" aria-label="Cloned repositories">{repos.map(repo => <li class="card card-border bg-base-100 p-4 sm:flex-row sm:items-center sm:justify-between" key={repo.name}><div class="flex min-w-0 flex-col gap-1"><span class="font-semibold break-all">{repo.name}</span><span class="text-sm text-base-content/70"><span class="font-medium text-base-content">Branch</span> {repo.branch || repo.branchError || 'Unavailable'}</span></div><span class="flex flex-wrap gap-2" aria-label={`Git status for ${repo.name}`}>{repo.gitStatus ? Object.entries(repo.gitStatus).filter(([, count]) => count > 0).map(([kind, count]) => <span class="badge badge-outline" key={kind}>{count} {kind}</span>) : <span class="badge badge-outline" title={repo.gitStatusError}>{repo.gitStatusError || 'Status unavailable'}</span>}</span><button type="button" class="btn btn-outline" aria-label={`Pull latest for ${repo.name}`} title={repo.branch ? 'Pull latest changes from this repository’s upstream branch' : (repo.branchError || 'Branch unavailable')} disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling || !repo.branch)} onClick={() => sync(repo)}>{syncingRepo === repo.name ? 'Pulling…' : 'Pull latest'}</button></li>)}</ul>
  </section>;
}
