import { useEffect, useRef, useState } from 'preact/hooks';
import { jsonRequest, request } from '../api.js';
import { sortSkillsAlphabetically } from '../skill-sorting.js';

const blankDraft = { name: '', description: '', content: '' };

export default function Skills({ exiting = false } = {}) {
  const [skills, setSkills] = useState([]);
  const [deviceSkills, setDeviceSkills] = useState([]);
  const dialog = useRef(null);
  const [displayedSource, setDisplayedSource] = useState('sunday');
  const [removingId, setRemovingId] = useState('');
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
  useEffect(() => {
    const element = dialog.current;
    if (form && element && !element.open) element.showModal();
    else if (!form && element?.open) element.close();
  }, [form]);
  useEffect(() => {
    if (!exiting) return;
    if (dialog.current?.open) dialog.current.close();
    setForm(''); setError('');
  }, [exiting]);

  function changeSource(next) {
    if (next === displayedSource) return;
    setDisplayedSource(next);
  }

  function startCreate() {
    setDraft(blankDraft); setEditingId(''); setError(''); setNotice(''); changeSource('sunday'); setForm('create');
  }
  function startImport() {
    setPackageName(''); setError(''); setNotice(''); changeSource('npm'); setForm('npm');
  }
  function startEdit(skill) {
    setDraft({ name: skill.name, description: skill.description, content: skill.content });
    setEditingId(skill.id); setError(''); setNotice(''); setForm('edit');
  }
  function closeForm(force = false) {
    if (busy && !force) return;
    dialog.current?.close();
    setForm(''); setError('');
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
      await request(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'DELETE' });
      await refresh(); setNotice(`${skill.name} deleted.`);
    } catch (reason) { setError(reason.message); }
    finally { setRemovingId(''); setBusy(false); }
  }

  const visibleSkills = sortSkillsAlphabetically(displayedSource === 'device' ? deviceSkills : skills.filter(skill => skill.source.type === displayedSource));
  const sundayCount = skills.filter(skill => skill.source.type === 'sunday').length;
  const npmCount = skills.filter(skill => skill.source.type === 'npm').length;

  return <section class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-y-auto overscroll-y-contain px-4 py-8 sm:px-6" aria-labelledby="skills-title" aria-hidden={exiting ? 'true' : undefined} inert={exiting}>
    <header class="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="text-xs font-bold tracking-widest text-primary">CONTEXT MODE</p>
        <h1 id="skills-title" class="text-3xl font-bold tracking-tight" tabIndex="-1">Skills</h1>
        <p class="mt-1 text-base-content/70">Reusable instructions that help Sunday agents handle a kind of task consistently.</p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <button class="btn btn-primary" type="button" onClick={startCreate}>＋ Create skill</button>
        <button class="btn btn-ghost" type="button" onClick={startImport}>Install from npm</button>
      </div>
    </header>

    <section class="mb-5 flex flex-col justify-between gap-4 rounded-box border border-base-300 bg-base-200 p-5 sm:flex-row sm:items-center" aria-labelledby="skills-intro-title">
      <div>
        <p class="text-xs font-bold tracking-widest text-primary">SHARED LIBRARY</p>
        <h2 id="skills-intro-title" class="text-lg font-semibold">Skills for every Sunday agent</h2>
        <p class="mt-1 text-sm leading-relaxed text-base-content/70">Build your own skills or review instructions from an npm package. Only enabled skills are added to agent prompts; skills never execute package code or grant tools.</p>
      </div>
      <div class="flex flex-wrap items-center gap-3 text-sm text-base-content/70" aria-label="Skill lifecycle">
        <span><b>1</b> Create or import</span><span aria-hidden="true">→</span>
        <span><b>2</b> Review</span><span aria-hidden="true">→</span>
        <span><b>3</b> Enable</span>
      </div>
    </section>

    {error && !form && <p class="alert alert-error" role="alert">{error}</p>}
    {notice && <p class="alert alert-info" role="status">{notice}</p>}

    <dialog ref={dialog} class="modal" aria-labelledby="skills-form-title" onClose={() => { setForm(''); setError(''); }} onCancel={event => { event.preventDefault(); closeForm(); }} onClick={event => { if (event.target === dialog.current) closeForm(); }}>
      <div class="modal-box max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] overflow-y-auto bg-base-100 p-4 text-base-content sm:p-6">
      {form === 'npm' && <form class="grid gap-3" onSubmit={installNpmSkill} aria-labelledby="skills-form-title">
        <div class="mb-4 flex items-start justify-between gap-4 border-b border-base-300 pb-3"><div><p class="text-xs font-bold tracking-widest text-primary">NPM PACKAGE</p><h2 id="skills-form-title" class="text-xl font-semibold">Install skill instructions</h2></div><button class="btn btn-ghost" type="button" onClick={closeForm} disabled={busy}>Cancel</button></div>
        {error && <p class="alert alert-error" role="alert">{error}</p>}
        <label class="grid gap-1.5 text-sm font-medium">Package name or version<input class="input input-bordered w-full" value={packageName} onInput={event => setPackageName(event.currentTarget.value)} placeholder="@team/code-review-skill" required maxLength={214} autoFocus /></label>
        <p class="text-sm leading-relaxed text-base-content/70">Sunday downloads the package archive to find <code>SKILL.md</code>. It does not run npm install or package scripts. Imported skills are stored separately from skills you build here and start disabled.</p>
        <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Installing…' : 'Download and review'}</button>
      </form>}

      {(form === 'create' || form === 'edit') && <form class="grid gap-3" onSubmit={saveSkill} aria-labelledby="skills-form-title">
        <div class="mb-4 flex items-start justify-between gap-4 border-b border-base-300 pb-3"><div><p class="text-xs font-bold tracking-widest text-primary">{form === 'edit' ? 'EDIT SKILL' : 'SUNDAY SKILL BUILDER'}</p><h2 id="skills-form-title" class="text-xl font-semibold">{form === 'edit' ? 'Update skill' : 'Create a skill'}</h2></div><button class="btn btn-ghost" type="button" onClick={closeForm} disabled={busy}>Cancel</button></div>
        {error && <p class="alert alert-error" role="alert">{error}</p>}
        <label class="grid gap-1.5 text-sm font-medium">Name<input class="input input-bordered w-full" value={draft.name} onInput={event => updateDraft('name', event.currentTarget.value)} required maxLength={80} autoFocus /></label>
        <label class="grid gap-1.5 text-sm font-medium">Description<input class="input input-bordered w-full" value={draft.description} onInput={event => updateDraft('description', event.currentTarget.value)} required maxLength={500} /></label>
        <label class="grid gap-1.5 text-sm font-medium">Instructions<textarea class="textarea textarea-bordered rounded-box w-full" value={draft.content} onInput={event => updateDraft('content', event.currentTarget.value)} required maxLength={50000} rows={12} placeholder="Write clear, reusable guidance for the agent…" /></label>
        <p class="text-sm leading-relaxed text-base-content/70">Instructions are shared with all Sunday agents when enabled. They cannot grant tools or permissions. New skills start disabled.</p>
        <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : form === 'edit' ? 'Save changes' : 'Create skill'}</button>
      </form>}
      </div>
    </dialog>

    <div class="mb-3 flex items-center justify-between gap-3">
      <div><h2 class="text-xl font-semibold">Skill library</h2><p class="mt-1 text-sm text-base-content/70">Manage Sunday-built skills separately from npm skills.</p></div>
      <span class="badge badge-outline">{skills.length} total</span>
    </div>
    <div class="join mb-4 max-w-full flex-wrap" role="group" aria-label="Skill source">
      <button type="button" class={`btn join-item ${displayedSource === 'sunday' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}  aria-pressed={displayedSource === 'sunday'} onClick={() => changeSource('sunday')}>Built in Sunday <span>{sundayCount}</span></button>
      <button type="button" class={`btn join-item ${displayedSource === 'device' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}  aria-pressed={displayedSource === 'device'} onClick={() => changeSource('device')}>On this device <span>{deviceSkills.length}</span></button>
      <button type="button" class={`btn join-item ${displayedSource === 'npm' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}  aria-pressed={displayedSource === 'npm'} onClick={() => changeSource('npm')}>Add from npm <span>{npmCount}</span></button>
    </div>
    <div key={displayedSource}>
      {loading ? <section class="rounded-box border border-base-300 bg-base-200 p-6" aria-live="polite">Loading skills…</section> : visibleSkills.length === 0 ? <section class="rounded-box border border-base-300 bg-base-200 p-6">
        <div class="text-3xl text-primary" aria-hidden="true">✦</div>
        <h2 class="mt-2 text-lg font-semibold">{displayedSource === 'sunday' ? 'Create your first skill' : displayedSource === 'device' ? 'No device skills found' : 'No npm packages added'}</h2>
        <p class="my-2 text-sm leading-relaxed text-base-content/70">{displayedSource === 'sunday' ? 'Capture a repeatable workflow as clear instructions, then enable it for Sunday agents.' : displayedSource === 'device' ? 'Sunday checks ~/.agents/skills, ~/.claude/skills, and the matching workspace skill folders. Device skills stay in place and are read-only here.' : 'Install an npm package containing a SKILL.md file. Imported skills stay separate and disabled until you review them.'}</p>
        {displayedSource !== 'device' && <button class="btn btn-primary" type="button" onClick={displayedSource === 'sunday' ? startCreate : startImport}>{displayedSource === 'sunday' ? '＋ Create skill' : 'Install from npm'}</button>}
      </section> : <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleSkills.map(skill => <article class="card card-bordered bg-base-200 p-4" key={skill.id}>
          <div class="flex items-start justify-between gap-3"><div><span class={`badge badge-sm ${skill.source.type === 'sunday' ? 'badge-primary' : 'badge-ghost'}`}>{skill.source.type === 'device' ? 'DEVICE SKILL' : skill.source.type === 'npm' ? 'NPM PACKAGE' : 'SUNDAY SKILL'}</span><h3 class="mt-1 text-lg font-semibold">{skill.name}</h3></div><span class={`badge badge-sm ${skill.enabled ? 'badge-success' : 'badge-ghost'}`}>{skill.enabled ? 'Enabled' : 'Disabled'}</span></div>
          <p class="my-3 break-words text-sm text-base-content/70">{skill.description}</p>
          {skill.source.type === 'npm' && <p class="mb-2 break-words text-xs text-base-content/70">{skill.source.package} · {skill.source.path}</p>}
          {skill.source.type === 'device' && <p class="mb-2 break-words text-xs text-base-content/70">{skill.source.location} · managed outside Sunday</p>}
          <details class="my-3 text-sm"><summary class="cursor-pointer font-medium">Review instructions</summary><pre class="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-box bg-base-100 p-3 text-xs leading-relaxed">{skill.content}</pre></details>
          <div class="mt-3 flex flex-wrap gap-2">{skill.source.type !== 'device' && <button class="btn btn-ghost" type="button" onClick={() => startEdit(skill)} disabled={busy}>{busy ? 'Please wait…' : 'Edit'}</button>}<button class="btn btn-primary" type="button" aria-pressed={skill.enabled} onClick={() => setEnabled(skill, !skill.enabled)} disabled={busy}>{busy ? 'Please wait…' : skill.enabled ? 'Disable' : 'Enable'}</button>{skill.source.type !== 'device' && <button class="btn btn-ghost text-error" type="button" onClick={() => removeSkill(skill)} disabled={busy}>{removingId === skill.id ? 'Deleting…' : 'Delete'}</button>}</div>
        </article>)}
      </div>}
    </div>
  </section>;
}
