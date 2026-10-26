import { useEffect, useState } from 'preact/hooks';
import { jsonRequest, request } from '../api.js';

const blankDraft = { name: '', description: '', content: '' };

export default function Skills() {
  const [skills, setSkills] = useState([]);
  const [deviceSkills, setDeviceSkills] = useState([]);
  const [source, setSource] = useState('sunday');
  const [form, setForm] = useState('');
  const [draft, setDraft] = useState(blankDraft);
  const [editingId, setEditingId] = useState('');
  const [packageName, setPackageName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  function startCreate() {
    setDraft(blankDraft); setEditingId(''); setError(''); setNotice(''); setForm('create');
  }
  function startImport() {
    setPackageName(''); setError(''); setNotice(''); setForm('npm');
  }
  function startEdit(skill) {
    setDraft({ name: skill.name, description: skill.description, content: skill.content });
    setEditingId(skill.id); setError(''); setNotice(''); setForm('edit');
  }
  function closeForm() { if (!busy) { setForm(''); setError(''); } }
  function updateDraft(field, value) { setDraft(current => ({ ...current, [field]: value })); }

  async function saveSkill(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (form === 'edit') await jsonRequest(`/api/skills/${encodeURIComponent(editingId)}`, 'PUT', draft);
      else await jsonRequest('/api/skills', 'POST', draft);
      await refresh(); setForm(''); setNotice(form === 'edit' ? 'Skill updated.' : 'Skill created. It is disabled until you enable it.');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function installNpmSkill(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await jsonRequest('/api/skills/npm', 'POST', { package: packageName });
      await refresh(); setForm(''); setSource('npm');
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
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'DELETE' });
      await refresh(); setNotice(`${skill.name} deleted.`);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const visibleSkills = source === 'device' ? deviceSkills : skills.filter(skill => skill.source.type === source);
  const sundayCount = skills.filter(skill => skill.source.type === 'sunday').length;
  const npmCount = skills.filter(skill => skill.source.type === 'npm').length;

  return <section class="context-page skills-page" aria-labelledby="skills-title">
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

    <nav class="context-section-tabs" aria-label="Context sections">
      <a href="#context">Memory</a>
      <a href="#context/skills" aria-current="page">Skills</a>
    </nav>

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

    {error && <p class="skills-message skills-error" role="alert">{error}</p>}
    {notice && <p class="skills-message" role="status">{notice}</p>}

    {form === 'npm' && <form class="skills-form context-panel" onSubmit={installNpmSkill} aria-labelledby="skills-form-title">
      <div class="skills-form-heading"><div><p class="eyebrow">NPM PACKAGE</p><h2 id="skills-form-title">Install skill instructions</h2></div><button class="context-button secondary" type="button" onClick={closeForm} disabled={busy}>Cancel</button></div>
      <label>Package name or version<input value={packageName} onInput={event => setPackageName(event.currentTarget.value)} placeholder="@team/code-review-skill" required maxLength={214} autoFocus /></label>
      <p class="skills-safety-note">Sunday downloads the package archive to find <code>SKILL.md</code>. It does not run npm install or package scripts. Imported skills are stored separately from skills you build here and start disabled.</p>
      <button class="context-button" type="submit" disabled={busy}>{busy ? 'Installing…' : 'Download and review'}</button>
    </form>}

    {(form === 'create' || form === 'edit') && <form class="skills-form context-panel" onSubmit={saveSkill} aria-labelledby="skills-form-title">
      <div class="skills-form-heading"><div><p class="eyebrow">{form === 'edit' ? 'EDIT SKILL' : 'SUNDAY SKILL BUILDER'}</p><h2 id="skills-form-title">{form === 'edit' ? 'Update skill' : 'Create a skill'}</h2></div><button class="context-button secondary" type="button" onClick={closeForm} disabled={busy}>Cancel</button></div>
      <label>Name<input value={draft.name} onInput={event => updateDraft('name', event.currentTarget.value)} required maxLength={80} autoFocus /></label>
      <label>Description<input value={draft.description} onInput={event => updateDraft('description', event.currentTarget.value)} required maxLength={500} /></label>
      <label>Instructions<textarea value={draft.content} onInput={event => updateDraft('content', event.currentTarget.value)} required maxLength={50000} rows={12} placeholder="Write clear, reusable guidance for the agent…" /></label>
      <p class="skills-safety-note">Instructions are shared with all Sunday agents when enabled. They cannot grant tools or permissions. New skills start disabled.</p>
      <button class="context-button" type="submit" disabled={busy}>{busy ? 'Saving…' : form === 'edit' ? 'Save changes' : 'Create skill'}</button>
    </form>}

    <div class="skills-library-heading">
      <div><h2>Skill library</h2><p>Manage Sunday-built skills separately from npm skills.</p></div>
      <span class="skills-count">{skills.length} total</span>
    </div>
    <div class="skills-source-tabs" role="group" aria-label="Skill source">
      <button type="button" class={source === 'sunday' ? 'active' : ''} aria-pressed={source === 'sunday'} onClick={() => setSource('sunday')}>Built in Sunday <span>{sundayCount}</span></button>
      <button type="button" class={source === 'device' ? 'active' : ''} aria-pressed={source === 'device'} onClick={() => setSource('device')}>On this device <span>{deviceSkills.length}</span></button>
      <button type="button" class={source === 'npm' ? 'active' : ''} aria-pressed={source === 'npm'} onClick={() => setSource('npm')}>Add from npm <span>{npmCount}</span></button>
    </div>
    {loading ? <section class="skills-empty context-panel" aria-live="polite">Loading skills…</section> : visibleSkills.length === 0 ? <section class="skills-empty context-panel">
      <div class="skills-empty-icon" aria-hidden="true">✦</div>
      <h2>{source === 'sunday' ? 'Create your first skill' : source === 'device' ? 'No device skills found' : 'No npm packages added'}</h2>
      <p>{source === 'sunday' ? 'Capture a repeatable workflow as clear instructions, then enable it for Sunday agents.' : source === 'device' ? 'Sunday checks ~/.agents/skills, ~/.claude/skills, and the matching workspace skill folders. Device skills stay in place and are read-only here.' : 'Install an npm package containing a SKILL.md file. Imported skills stay separate and disabled until you review them.'}</p>
      {source !== 'device' && <button class="context-button" type="button" onClick={source === 'sunday' ? startCreate : startImport}>{source === 'sunday' ? '＋ Create skill' : 'Install from npm'}</button>}
    </section> : <div class="skills-list">
      {visibleSkills.map(skill => <article class="skills-card context-panel" key={skill.id}>
        <div class="skills-card-header"><div><span class={`skills-origin ${skill.source.type !== 'sunday' ? 'npm' : ''}`}>{skill.source.type === 'device' ? 'DEVICE SKILL' : skill.source.type === 'npm' ? 'NPM PACKAGE' : 'SUNDAY SKILL'}</span><h3>{skill.name}</h3></div><span class={`skills-status${skill.enabled ? ' enabled' : ''}`}>{skill.enabled ? 'Enabled' : 'Disabled'}</span></div>
        <p class="skills-description">{skill.description}</p>
        {skill.source.type === 'npm' && <p class="skills-package">{skill.source.package} · {skill.source.path}</p>}
        {skill.source.type === 'device' && <p class="skills-package">{skill.source.location} · managed outside Sunday</p>}
        <details class="skills-review"><summary>Review instructions</summary><pre>{skill.content}</pre></details>
        <div class="skills-card-actions">{skill.source.type !== 'device' && <button class="context-button secondary" type="button" onClick={() => startEdit(skill)} disabled={busy}>Edit</button>}<button class="context-button" type="button" aria-pressed={skill.enabled} onClick={() => setEnabled(skill, !skill.enabled)} disabled={busy}>{skill.enabled ? 'Disable' : 'Enable'}</button>{skill.source.type !== 'device' && <button class="context-button secondary danger" type="button" onClick={() => removeSkill(skill)} disabled={busy}>Delete</button>}</div>
      </article>)}
    </div>}
  </section>;
}
