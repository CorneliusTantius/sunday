import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

export default function SessionConfig({ session, onClose, onSaved, onDelete, toast }) {
  const dialog = useRef(null);
  const titleInput = useRef(null);
  const alive = useRef(true);
  const deleteTimer = useRef(null);
  const deletingRef = useRef(false);
  const [title, setTitle] = useState(session.title);
  const [personaId, setPersonaId] = useState(session.profile?.personaId || 'sunday');
  const [allowed, setAllowed] = useState(session.allowedRepositories || []);
  const [personas, setPersonas] = useState([]);
  const [repos, setRepos] = useState([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteReady, setDeleteReady] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState('off');
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  const animateClose = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => { dialog.current?.close(); onClose(); }, 180);
  };
  useEffect(() => {
    let active = true;
    alive.current = true;
    dialog.current.showModal();
    Promise.all([request('/api/personas'), request('/api/repos?namesOnly=1'), request(`/api/sessions/${encodeURIComponent(session.id)}`)]).then(([profiles, repositories, data]) => {
      if (!active) return;
      setPersonas(profiles.personas); setRepos(repositories.repos); setModels(data.session.models || []); setModel(data.session.config.model); setThinking(data.session.config.thinkingLevel || 'off');
      setAllowed(previous => previous.filter(name => repositories.repos.some(repo => repo.name === name)));
      setBusy(false); titleInput.current?.focus();
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; alive.current = false; clearTimeout(deleteTimer.current); clearTimeout(closeTimer.current); };
  }, []);
  function clearDeleteArm() {
    clearTimeout(deleteTimer.current); deleteTimer.current = null;
    setDeleteArmed(false); setDeleteReady(false); setDeleteCountdown(0);
  }
  function close() { clearDeleteArm(); onClose(); }
  function armDelete() {
    if (deletingRef.current || busy || saving) return;
    if (deleteReady) { deleteSession(); return; }
    if (deleteTimer.current !== null) return;
    setError(''); setDeleteArmed(true); setDeleteCountdown(3);
    let remaining = 3;
    const tick = () => {
      if (!alive.current) return;
      remaining--;
      setDeleteCountdown(remaining);
      if (remaining === 0) setDeleteReady(true);
      else deleteTimer.current = setTimeout(tick, 1000);
    };
    deleteTimer.current = setTimeout(tick, 1000);
  }
  async function deleteSession() {
    if (deletingRef.current || !deleteReady) return;
    deletingRef.current = true; setDeleting(true); setError('');
    try { await onDelete(session); }
    catch (error) {
      if (alive.current) { clearDeleteArm(); setError(error.message || 'Unable to delete session'); }
    } finally {
      deletingRef.current = false;
      if (alive.current) setDeleting(false);
    }
  }
  async function save(event) {
    event.preventDefault(); clearDeleteArm(); if (busy || deletingRef.current) return;
    setBusy(true); setSaving(true); setError('');
    try {
      await jsonRequest(`/api/sessions/${encodeURIComponent(session.id)}`, 'PATCH', { title: title.trim(), personaId, allowedRepositories: allowed, config: { model, thinkingLevel: thinking } });
      await onSaved();
      if (alive.current) { close(); toast('Session settings saved'); }
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) { setBusy(false); setSaving(false); } }
  }
  const levels = models.find(item => item.id === model)?.thinkingLevels || ['off'];
  const selectedThinking = levels.includes(thinking) ? thinking : levels[0];
  return <dialog ref={dialog} id="session-config-dialog" class="modal" aria-labelledby="session-config-heading" onClick={event => { if (event.target === dialog.current) animateClose(); }} onCancel={event => { event.preventDefault(); animateClose(); }} onClose={() => { if (alive.current && !closing) close(); }}>
    <div class="modal-box max-h-[calc(100dvh-2.5rem)] w-[min(560px,calc(100%-2rem))] overflow-y-auto bg-base-100 p-0 text-base-content">
    <header class="flex items-center justify-between border-b border-base-300 p-5"><h2 id="session-config-heading" class="text-lg font-bold">Agent settings</h2><button class="btn btn-ghost btn-square" id="close-session-config" type="button" aria-label="Close session settings" onClick={animateClose}>×</button></header>
    <form id="session-config-form" onSubmit={save}><div class="space-y-4 p-5">
      <div class="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(120px,1fr)_minmax(0,1.5fr)]"><label class="label font-semibold" for="session-config-title">Agent name</label><input ref={titleInput} class="input input-bordered w-full" id="session-config-title" required maxLength="120" value={title} onInput={event => setTitle(event.currentTarget.value)} /></div>
      <div class="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(120px,1fr)_minmax(0,1.5fr)]"><label class="label font-semibold" for="session-config-persona">Persona</label><select class="select select-bordered w-full" id="session-config-persona" required value={personaId} disabled={busy} onChange={event => setPersonaId(event.currentTarget.value)}>{personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></div>
      <div class="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(120px,1fr)_minmax(0,1.5fr)]"><label class="label font-semibold" for="session-config-model">Model</label><select class="select select-bordered w-full" id="session-config-model" value={model} disabled={busy || !models.length} onChange={event => { setModel(event.currentTarget.value); const nextLevels = models.find(item => item.id === event.currentTarget.value)?.thinkingLevels || ['off']; if (!nextLevels.includes(thinking)) setThinking(nextLevels[0]); }}>{models.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></div>
      <div class="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(120px,1fr)_minmax(0,1.5fr)]"><label class="label font-semibold" for="session-config-thinking">Thinking level</label><select class="select select-bordered w-full" id="session-config-thinking" value={selectedThinking} disabled={busy || levels.length === 1} onChange={event => setThinking(event.currentTarget.value)}>{levels.map(level => <option key={level} value={level}>{level === 'xhigh' ? 'Extra high' : level[0].toUpperCase() + level.slice(1)}</option>)}</select></div>
      <fieldset class="fieldset w-full"><legend class="fieldset-legend">Allowed repositories</legend><div id="session-config-repos" class="max-h-56 overflow-y-auto rounded-box border border-base-300 bg-base-200 p-2">{repos.map(repo => <label key={repo.name} class="label cursor-pointer justify-start gap-3 rounded-field p-2 hover:bg-base-300"><input class="checkbox rounded-md" type="checkbox" value={repo.name} checked={allowed.includes(repo.name)} disabled={busy} onChange={event => setAllowed(event.currentTarget.checked ? [...allowed, repo.name] : allowed.filter(name => name !== repo.name))} /><span>{repo.name}</span></label>)}{!busy && !repos.length && <p class="text-sm text-base-content/70">No repositories yet. Clone one on the Repositories page.</p>}</div></fieldset>
      <p class="text-sm text-base-content/70">Checked repositories are copied into this agent’s private workspace; unchecking one removes its copy. All repositories are enabled by default for new agents. Available tools are controlled by the selected persona.</p>{saving && <div class="space-y-2 text-sm text-base-content/70"><span>Updating workspace copies…</span><progress class="progress progress-primary w-full" role="progressbar" aria-label="Updating agent workspace" aria-valuetext="Copying selected repositories" /></div>}<p class="alert alert-error empty:hidden py-2" id="session-config-error" role="alert">{error}</p>{deleteArmed && <p class="text-sm text-base-content/70" role="status">Deleting this agent permanently removes its chat history and private workspace.</p>}
    </div><footer class="flex flex-wrap justify-between gap-2 border-t border-base-300 p-5"><button class="btn btn-outline btn-error !text-error mr-auto" id="delete-session-config" type="button" onClick={armDelete} disabled={busy || saving || deleting || (deleteArmed && !deleteReady)}>{deleting ? 'Deleting…' : deleteReady ? 'Confirm delete' : deleteArmed ? `Wait ${deleteCountdown}s…` : 'Delete agent'}</button><button class="btn btn-outline" id="cancel-session-config" type="button" onClick={animateClose}>Cancel</button><button class="btn btn-primary" id="save-session-config" type="submit" disabled={busy || deleting}>{saving ? 'Saving…' : 'Save agent'}</button></footer></form>
    </div>
  </dialog>;
}
