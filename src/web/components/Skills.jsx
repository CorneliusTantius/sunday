import { useEffect, useRef, useState } from 'preact/hooks';
import { jsonRequest, request } from '../api.js';

const blankDraft = { name: '', description: '', content: '' };
const SKILLS_MOTION_MS = 200;

function motionDuration() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : SKILLS_MOTION_MS;
}

export default function Skills({ exiting = false } = {}) {
  const [skills, setSkills] = useState([]);
  const [deviceSkills, setDeviceSkills] = useState([]);
  const dialog = useRef(null);
  const [source, setSource] = useState('sunday');
  const [displayedSource, setDisplayedSource] = useState('sunday');
  const [sourceLeaving, setSourceLeaving] = useState(false);
  const [removingId, setRemovingId] = useState('');
  const [form, setForm] = useState('');
  const [dialogClosing, setDialogClosing] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [editingId, setEditingId] = useState('');
  const [packageName, setPackageName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sourceTimer = useRef(null);
  const closeTimer = useRef(null);

  async function refresh() {
    const [managed, device] = await Promise.all([request('/api/skills'), request('/api/skills/device')]);
    setSkills(managed.skills); setDeviceSkills(device.skills);
  }
  useEffect(() => {
    let active = true;
    Promise.all([request('/api/skills'), request('/api/skills/device')])
      .then(([managed, device]) => { if (active) { setSkills(managed.skills); setDeviceSkills(device.skills); } })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => () => {
    clearTimeout(sourceTimer.current);
    clearTimeout(closeTimer.current);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (form && element && !element.open) element.showModal();
    else if (!form && element?.open) element.close();
  }, [form]);
  useEffect(() => {
    if (!exiting) return;
    clearTimeout(sourceTimer.current); clearTimeout(closeTimer.current);
    sourceTimer.current = closeTimer.current = null;
    if (dialog.current?.open) dialog.current.close();
    setForm(''); setError(''); setDialogClosing(false);
  }, [exiting]);

  function changeSource(next) {
    if (next === source) return;
    clearTimeout(sourceTimer.current);
    setSource(next);
    setSourceLeaving(true);
    sourceTimer.current = setTimeout(() => {
      setDisplayedSource(next);
      setSourceLeaving(false);
      sourceTimer.current = null;
    }, motionDuration());
  }

  function startCreate() {
    setDraft(blankDraft); setEditingId(''); setError(''); setNotice(''); changeSource('sunday'); setDialogClosing(false); setForm('create');
  }
  function startImport() {
    setPackageName(''); setError(''); setNotice(''); changeSource('npm'); setDialogClosing(false); setForm('npm');
  }
  function startEdit(skill) {
    setDraft({ name: skill.name, description: skill.description, content: skill.content });
    setEditingId(skill.id); setError(''); setNotice(''); setDialogClosing(false); setForm('edit');
  }
  function closeForm(force = false) {
    if ((busy && !force) || dialogClosing) return;
    setDialogClosing(true);
    closeTimer.current = setTimeout(() => {
      dialog.current?.close();
      setForm(''); setError(''); setDialogClosing(false);
      closeTimer.current = null;
    }, motionDuration());
  }

  function updateDraft(field, value) { setDraft(current => ({ ...current, [field]: value })); }

  async function saveSkill(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (form === 'edit') await jsonRequest(`/api/skills/${encodeURIComponent(editingId)}`, 'PUT', draft);
      else await jsonRequest('/api/skills', 'POST', draft);
      await refresh(); closeForm(true); setNotice(form === 'edit' ? 'Skill updated.' : 'Skill created. It is disabled until you enable it.');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function installNpmSkill(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await jsonRequest('/api/skills/npm', 'POST', { package: packageName });
      await refresh(); changeSource('npm'); closeForm(true);
      setNotice(`${result.skills.length} npm skill${result.skills.length === 1 ? '' : 's'} added. Review instructions before enabling.`);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function setEnabled(skill, enabled) {
    setBusy(true); setError(''); setNotice('');
    try {
      const endpoint = skill.source.type === 'device' ? `/api/skills/device/${encodeURIComponent(skill.id)}` : `/api/skills/${encodeURIComponent(skill.id)}`;
      await jsonRequest(endpoint, 'PUT', { enabled });
      await refresh(); setNotice(`${skill.name} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function removeSkill(skill) {
    if (!confirm(`Delete “${skill.name}” from Sunday’s skill library?`)) return;
    setBusy(true); setError(''); setNotice(''); setRemovingId(skill.id);
    try {
      await new Promise(resolve => setTimeout(resolve, motionDuration()));
      await request(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'DELETE' });
      await refresh(); setNotice(`${skill.name} deleted.`);
    } catch (reason) { setError(reason.message); }
    finally { setRemovingId(''); setBusy(false); }
  }

  const visibleSkills = displayedSource === 'device' ? deviceSkills : skills.filter(skill => skill.source.type === displayedSource);
  const sundayCount = skills.filter(skill => skill.source.type === 'sunday').length;
  const npmCount = skills.filter(skill => skill.source.type === 'npm').length;

  return <section class={`context-page skills-page${exiting ? ' exiting' : ''}`} aria-labelledby="skills-title" aria-hidden={exiting ? 'true' : undefined} inert={exiting}>
    <header class="context-header">
      <div>
        <p class="eyebrow">CONTEXT MODE</p>
        <h1 id="skills-title" tabIndex="-1">Skills</h1>
        <p>Reusable instructions that help Sunday agents handle a kind of task consistently.</p>
      </div>
      <div class="context-header-actions skills-actions">
        <button class="context-button" type="button" onClick={startCreate}>＋ Create skill</button>
        <button class="context-button secondary" type="button" onClick={startImport}>Install from npm</button>
      </div>
    </header>

    <section class="skills-intro context-panel" aria-labelledby="skills-intro-title">
      <div>
        <p class="eyebrow">SHARED LIBRARY</p>
        <h2 id="skills-intro-title">Skills for every Sunday agent</h2>
        <p>Build your own skills or review instructions from an npm package. Only enabled skills are added to agent prompts; skills never execute package code or grant tools.</p>
      </div>
      <div class="skills-flow" aria-label="Skill lifecycle">
        <span><b>1</b> Create or import</span><span aria-hidden="true">→</span>
        <span><b>2</b> Review</span><span aria-hidden="true">→</span>
        <span><b>3</b> Enable</span>
      </div>
    </section>

    {error && !form && <p class="skills-message skills-error" role="alert">{error}</p>}
    {notice && <p class="skills-message" role="status">{notice}</p>}

    <dialog ref={dialog} class={`context-modal skills-dialog${dialogClosing ? ' closing' : ''}`} aria-labelledby="skills-form-title" onClose={() => { clearTimeout(closeTimer.current); closeTimer.current = null; setForm(''); setError(''); setDialogClosing(false); }} onCancel={event => { event.preventDefault(); closeForm(); }} onClick={event => { if (event.target === dialog.current) closeForm(); }}>
      {form === 'npm' && <form class="skills-form" onSubmit={installNpmSkill} aria-labelledby="skills-form-title">
        <div class="skills-form-heading context-modal-header"><div><p class="eyebrow">NPM PACKAGE</p><h2 id="skills-form-title">Install skill instructions</h2></div><button class="context-button secondary" type="button" onClick={closeForm} disabled={busy || dialogClosing}>Cancel</button></div>
        {error && <p class="skills-message skills-error" role="alert">{error}</p>}
        <label>Package name or version<input value={packageName} onInput={event => setPackageName(event.currentTarget.value)} placeholder="@team/code-review-skill" required maxLength={214} autoFocus /></label>
        <p class="skills-safety-note">Sunday downloads the package archive to find <code>SKILL.md</code>. It does not run npm install or package scripts. Imported skills are stored separately from skills you build here and start disabled.</p>
        <button class="context-button" type="submit" disabled={busy || dialogClosing}>{busy ? 'Installing…' : 'Download and review'}</button>
      </form>}

      {(form === 'create' || form === 'edit') && <form class="skills-form" onSubmit={saveSkill} aria-labelledby="skills-form-title">
        <div class="skills-form-heading context-modal-header"><div><p class="eyebrow">{form === 'edit' ? 'EDIT SKILL' : 'SUNDAY SKILL BUILDER'}</p><h2 id="skills-form-title">{form === 'edit' ? 'Update skill' : 'Create a skill'}</h2></div><button class="context-button secondary" type="button" onClick={closeForm} disabled={busy || dialogClosing}>Cancel</button></div>
        {error && <p class="skills-message skills-error" role="alert">{error}</p>}
        <label>Name<input value={draft.name} onInput={event => updateDraft('name', event.currentTarget.value)} required maxLength={80} autoFocus /></label>
        <label>Description<input value={draft.description} onInput={event => updateDraft('description', event.currentTarget.value)} required maxLength={500} /></label>
        <label>Instructions<textarea value={draft.content} onInput={event => updateDraft('content', event.currentTarget.value)} required maxLength={50000} rows={12} placeholder="Write clear, reusable guidance for the agent…" /></label>
        <p class="skills-safety-note">Instructions are shared with all Sunday agents when enabled. They cannot grant tools or permissions. New skills start disabled.</p>
        <button class="context-button" type="submit" disabled={busy || dialogClosing}>{busy ? 'Saving…' : form === 'edit' ? 'Save changes' : 'Create skill'}</button>
      </form>}
    </dialog>

    <div class="skills-library-heading">
      <div><h2>Skill library</h2><p>Manage Sunday-built skills separately from npm skills.</p></div>
      <span class="skills-count">{skills.length} total</span>
    </div>
    <div class="skills-source-tabs" role="group" aria-label="Skill source">
      <button type="button" class={source === 'sunday' ? 'active' : ''} aria-pressed={source === 'sunday'} onClick={() => changeSource('sunday')}>Built in Sunday <span>{sundayCount}</span></button>
      <button type="button" class={source === 'device' ? 'active' : ''} aria-pressed={source === 'device'} onClick={() => changeSource('device')}>On this device <span>{deviceSkills.length}</span></button>
      <button type="button" class={source === 'npm' ? 'active' : ''} aria-pressed={source === 'npm'} onClick={() => changeSource('npm')}>Add from npm <span>{npmCount}</span></button>
    </div>
    <div class={`skills-content${sourceLeaving ? ' leaving' : ''}`} key={displayedSource}>
      {loading ? <section class="skills-empty context-panel" aria-live="polite">Loading skills…</section> : visibleSkills.length === 0 ? <section class="skills-empty context-panel">
        <div class="skills-empty-icon" aria-hidden="true">✦</div>
        <h2>{displayedSource === 'sunday' ? 'Create your first skill' : displayedSource === 'device' ? 'No device skills found' : 'No npm packages added'}</h2>
        <p>{displayedSource === 'sunday' ? 'Capture a repeatable workflow as clear instructions, then enable it for Sunday agents.' : displayedSource === 'device' ? 'Sunday checks ~/.agents/skills, ~/.claude/skills, and the matching workspace skill folders. Device skills stay in place and are read-only here.' : 'Install an npm package containing a SKILL.md file. Imported skills stay separate and disabled until you review them.'}</p>
        {displayedSource !== 'device' && <button class="context-button" type="button" onClick={displayedSource === 'sunday' ? startCreate : startImport}>{displayedSource === 'sunday' ? '＋ Create skill' : 'Install from npm'}</button>}
      </section> : <div class="skills-list">
        {visibleSkills.map((skill, index) => <article class={`skills-card context-panel${removingId === skill.id ? ' leaving' : ''}`} style={{ '--skills-index': Math.min(index, 8) }} key={skill.id}>
          <div class="skills-card-header"><div><span class={`skills-origin ${skill.source.type !== 'sunday' ? 'npm' : ''}`}>{skill.source.type === 'device' ? 'DEVICE SKILL' : skill.source.type === 'npm' ? 'NPM PACKAGE' : 'SUNDAY SKILL'}</span><h3>{skill.name}</h3></div><span class={`skills-status${skill.enabled ? ' enabled' : ''}`}>{skill.enabled ? 'Enabled' : 'Disabled'}</span></div>
          <p class="skills-description">{skill.description}</p>
          {skill.source.type === 'npm' && <p class="skills-package">{skill.source.package} · {skill.source.path}</p>}
          {skill.source.type === 'device' && <p class="skills-package">{skill.source.location} · managed outside Sunday</p>}
          <details class="skills-review"><summary>Review instructions</summary><pre>{skill.content}</pre></details>
          <div class="skills-card-actions">{skill.source.type !== 'device' && <button class="context-button secondary" type="button" onClick={() => startEdit(skill)} disabled={busy}>{busy ? 'Please wait…' : 'Edit'}</button>}<button class="context-button" type="button" aria-pressed={skill.enabled} onClick={() => setEnabled(skill, !skill.enabled)} disabled={busy}>{busy ? 'Please wait…' : skill.enabled ? 'Disable' : 'Enable'}</button>{skill.source.type !== 'device' && <button class="context-button secondary danger" type="button" onClick={() => removeSkill(skill)} disabled={busy}>{removingId === skill.id ? 'Deleting…' : 'Delete'}</button>}</div>
        </article>)}
      </div>}
    </div>
  </section>;
}
