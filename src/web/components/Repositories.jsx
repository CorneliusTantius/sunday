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
  return <section class="repositories-page" id="repositories-page" aria-labelledby="repositories-title">
    <header class="repositories-header"><div><p class="eyebrow">WORKSPACE</p><h1 id="repositories-title" tabIndex="-1">Repositories</h1><p class="field-note">~/sunday/workspace/repos/</p></div><div class="repository-actions"><button class="secondary-button" id="pull-all-repos" disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling || !repos.length)} onClick={syncAll}>{syncingAll ? 'Pulling…' : 'Pull all'}</button><button class="secondary-button" id="refresh-repos" disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling)} onClick={load}>Refresh</button></div></header>
    <form class="repository-clone" id="clone-form" onSubmit={clone}><label class="field-label" for="repo-url">Clone repository</label><div class="code-row"><input class="text-input" id="repo-url" type="url" required placeholder="https://github.com/owner/repo.git" value={url} disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling)} onInput={event => setUrl(event.currentTarget.value)} /><button class="primary-button" id="clone-repo" type="submit" disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling)}>Git clone</button></div></form>
    <label class="repository-auto-pull"><input id="auto-pull-repositories" type="checkbox" checked={autoPullEnabled} onChange={toggleAutoPull} /> Automatically pull clean repositories on <code>main</code> every 5 minutes while this page is open</label>
    <p class="field-note" id="auto-pull-status" role="status">{autoPullStatus}</p>
    <p class="field-note" id="repo-status" role="status">{status}</p><ul id="repos-list" class="repos-list" aria-label="Cloned repositories">{repos.map(repo => <li key={repo.name}><div class="repo-identity"><span class="repo-name">{repo.name}</span><span class="repo-branch"><span class="repo-branch-label">Branch</span> {repo.branch || repo.branchError || 'Unavailable'}</span></div><span class="repo-git-status" aria-label={`Git status for ${repo.name}`}>{repo.gitStatus ? Object.entries(repo.gitStatus).filter(([, count]) => count > 0).map(([kind, count]) => <span class={`repo-status-pill ${kind}`} key={kind}>{count} {kind}</span>) : <span class="repo-status-pill" title={repo.gitStatusError}>{repo.gitStatusError || 'Status unavailable'}</span>}</span><button type="button" class="secondary-button repo-sync-button" aria-label={`Pull latest for ${repo.name}`} title={repo.branch ? 'Pull latest changes from this repository’s upstream branch' : (repo.branchError || 'Branch unavailable')} disabled={Boolean(cloning || syncingRepo || syncingAll || autoPulling || !repo.branch)} onClick={() => sync(repo)}>{syncingRepo === repo.name ? 'Pulling…' : 'Pull latest'}</button></li>)}</ul>
  </section>;
}
