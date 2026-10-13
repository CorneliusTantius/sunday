import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

export default function SessionConfig({ session, onClose, onSaved, toast }) {
  const dialog = useRef(null);
  const titleInput = useRef(null);
  const alive = useRef(true);
  const [title, setTitle] = useState(session.title);
  const [personaId, setPersonaId] = useState(session.profile?.personaId || 'sunday');
  const [allowed, setAllowed] = useState(session.allowedRepositories || []);
  const [personas, setPersonas] = useState([]);
  const [repos, setRepos] = useState([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    alive.current = true;
    dialog.current.showModal();
    Promise.all([request('/api/personas'), request('/api/repos')]).then(([profiles, repositories]) => {
      if (!active) return;
      setPersonas(profiles.personas); setRepos(repositories.repos);
      setAllowed(previous => previous.filter(name => repositories.repos.some(repo => repo.name === name)));
      setBusy(false); titleInput.current?.focus();
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; alive.current = false; };
  }, []);
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setSaving(true); setError('');
    try {
      await jsonRequest(`/api/sessions/${encodeURIComponent(session.id)}`, 'PATCH', { title: title.trim(), personaId, allowedRepositories: allowed });
      await onSaved();
      if (alive.current) { onClose(); toast('Session settings saved'); }
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) { setBusy(false); setSaving(false); } }
  }
  return <dialog ref={dialog} id="session-config-dialog" class="session-config-dialog" aria-labelledby="session-config-heading" onCancel={onClose} onClose={onClose}>
    <header class="modal-header"><h2 id="session-config-heading">Agent settings</h2><button class="icon-button" id="close-session-config" type="button" aria-label="Close session settings" onClick={onClose}>×</button></header>
    <form id="session-config-form" onSubmit={save}><div class="modal-content">
      <label class="field-label" for="session-config-title">Agent name</label><input ref={titleInput} class="text-input" id="session-config-title" required maxLength="120" value={title} onInput={event => setTitle(event.currentTarget.value)} />
      <label class="field-label" for="session-config-persona">Persona</label><select class="select" id="session-config-persona" required value={personaId} disabled={busy} onChange={event => setPersonaId(event.currentTarget.value)}>{personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select>
      <fieldset class="repository-options"><legend class="field-label">Allowed repositories</legend><div id="session-config-repos">{repos.map(repo => <label key={repo.name} class="repository-checkbox"><input type="checkbox" value={repo.name} checked={allowed.includes(repo.name)} disabled={busy} onChange={event => setAllowed(event.currentTarget.checked ? [...allowed, repo.name] : allowed.filter(name => name !== repo.name))} /><span>{repo.name}</span></label>)}{!busy && !repos.length && <p class="field-note">No repositories yet. Clone one on the Repositories page.</p>}</div></fieldset>
      <p class="field-note">Checked repositories are copied into this agent’s private workspace; unchecking one removes its copy. All repositories are enabled by default for new agents. Available tools are controlled by the selected persona.</p>{saving && <div class="workspace-save-progress"><span>Updating workspace copies…</span><div class="workspace-progress" role="progressbar" aria-label="Updating agent workspace" aria-valuetext="Copying selected repositories" /></div>}<p class="form-error" id="session-config-error" role="alert">{error}</p>
    </div><footer class="modal-footer"><button class="secondary-button" id="cancel-session-config" type="button" onClick={onClose}>Cancel</button><button class="primary-button" id="save-session-config" type="submit" disabled={busy}>{saving ? 'Saving…' : 'Save agent'}</button></footer></form>
  </dialog>;
}
