import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const defaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const emptyDraft = () => ({
  name: '', personaId: '', task: '', allowedRepositories: [], model: '', provider: '', mode: '', thinkingLevel: '',
  schedule: { type: 'daily', time: '09:00', timezone: defaultTimezone() },
});
const scheduleTypes = [
  ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'],
  ['every_n_minutes', 'Every N minutes'], ['every_n_hours', 'Every N hours'],
];

function scheduleLabel(schedule) {
  const time = schedule.time ? ` at ${schedule.time}` : '';
  const timezone = schedule.timezone || 'UTC';
  if (schedule.type === 'weekly') return `Every ${weekdays[schedule.weekday]}${time} · ${timezone}`;
  if (schedule.type === 'monthly') return `Day ${schedule.dayOfMonth}${time} · ${timezone}`;
  if (schedule.type === 'daily') return `Daily${time} · ${timezone}`;
  const unit = schedule.type === 'every_n_minutes' ? 'minute' : 'hour';
  return `Every ${schedule.interval} ${unit}${schedule.interval === 1 ? '' : 's'} · ${timezone}`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function modelKey(model) { return `${model.mode}:${model.provider}:${model.id}`; }
function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || (part?.type === 'text' ? part.text : '')).filter(Boolean).join('\n');
  return content == null ? '' : JSON.stringify(content, null, 2);
}

export default function ScheduledJobs() {
  const [jobs, setJobs] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [repositories, setRepositories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [transcriptError, setTranscriptError] = useState('');
  const transcriptDialog = useRef(null);
  const transcriptRequest = useRef(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState('');
  const [history, setHistory] = useState({});
  const [expandedHistory, setExpandedHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const dialog = transcriptDialog.current;
    if (selectedRun && dialog && !dialog.open) dialog.showModal();
    else if (!selectedRun && dialog?.open) dialog.close();
  }, [selectedRun]);

  useEffect(() => {
    let active = true;
    Promise.all([request('/api/scheduled-jobs'), request('/api/personas'), request('/api/repos'), request('/api/settings')])
      .then(([jobData, personaData, repoData, settingsData]) => {
        if (!active) return;
        setJobs(jobData.jobs || []);
        setPersonas(personaData.personas || []);
        setRepositories(repoData.repos || []);
        setSettings(settingsData);
        setError('');
      })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function change(field, value) { setDraft(previous => ({ ...previous, [field]: value })); }
  function changeSchedule(field, value) {
    setDraft(previous => ({ ...previous, schedule: { ...previous.schedule, [field]: value } }));
  }
  function chooseSchedule(type) {
    const timezone = draft.schedule.timezone || defaultTimezone();
    const schedule = { type, timezone };
    if (['daily', 'weekly', 'monthly'].includes(type)) schedule.time = draft.schedule.time || '09:00';
    if (type === 'weekly') schedule.weekday = 1;
    if (type === 'monthly') schedule.dayOfMonth = 1;
    if (type === 'every_n_minutes') schedule.interval = 15;
    if (type === 'every_n_hours') schedule.interval = 1;
    setDraft(previous => ({ ...previous, schedule }));
  }
  function toggleRepository(name, checked) {
    change('allowedRepositories', checked
      ? [...new Set([...draft.allowedRepositories, name])]
      : draft.allowedRepositories.filter(item => item !== name));
  }

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId('');
    setError('');
    setStatus('');
  }

  function editJob(job) {
    setDraft({
      name: job.name, personaId: job.personaId, task: job.task,
      allowedRepositories: [...job.allowedRepositories], model: job.model || '', provider: job.provider || '', mode: job.mode || '', thinkingLevel: job.thinkingLevel || '',
      schedule: { ...job.schedule },
    });
    setEditingId(job.id);
    setError('');
    setStatus('');
    document.getElementById('scheduled-job-name')?.focus();
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(''); setStatus('');
    try {
      const payload = {
        name: draft.name.trim(), personaId: draft.personaId, task: draft.task.trim(),
        allowedRepositories: draft.allowedRepositories, schedule: draft.schedule,
        model: draft.model || null, provider: draft.provider || null, mode: draft.mode || null,
        thinkingLevel: draft.thinkingLevel || null,
      };
      const data = await jsonRequest(editingId ? `/api/scheduled-jobs/${editingId}` : '/api/scheduled-jobs', editingId ? 'PATCH' : 'POST', payload);
      setJobs(previous => editingId
        ? previous.map(job => job.id === editingId ? data.job : job)
        : [data.job, ...previous]);
      setStatus(editingId ? 'Automation updated.' : 'Automation created.');
      setHistory(previous => { const next = { ...previous }; delete next[data.job.id]; return next; });
      setExpandedHistory(previous => ({ ...previous, [data.job.id]: false }));
      setDraft(emptyDraft());
      setEditingId('');
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  }

  async function setEnabled(job) {
    setPendingId(job.id); setError(''); setStatus('');
    try {
      const data = await jsonRequest(`/api/scheduled-jobs/${job.id}`, 'PATCH', { enabled: !job.enabled });
      setJobs(previous => previous.map(item => item.id === job.id ? data.job : item));
      setStatus(data.job.enabled ? 'Automation enabled.' : 'Automation disabled.');
    } catch (reason) { setError(reason.message); }
    finally { setPendingId(''); }
  }

  async function remove(job) {
    if (!window.confirm(`Delete “${job.name}” and its run history?`)) return;
    setPendingId(job.id); setError(''); setStatus('');
    try {
      await request(`/api/scheduled-jobs/${job.id}`, { method: 'DELETE' });
      setJobs(previous => previous.filter(item => item.id !== job.id));
      setHistory(previous => { const next = { ...previous }; delete next[job.id]; return next; });
      setExpandedHistory(previous => { const next = { ...previous }; delete next[job.id]; return next; });
      if (editingId === job.id) resetForm();
      setStatus('Automation deleted.');
    } catch (reason) { setError(reason.message); }
    finally { setPendingId(''); }
  }

  async function toggleHistory(job) {
    const show = !expandedHistory[job.id];
    setExpandedHistory(previous => ({ ...previous, [job.id]: show }));
    if (!show || Object.hasOwn(history, job.id)) return;
    setPendingId(job.id); setError('');
    try {
      const data = await request(`/api/scheduled-jobs/${job.id}/runs`);
      setHistory(previous => ({ ...previous, [job.id]: data.runs || [] }));
    } catch (reason) {
      setError(reason.message);
      setExpandedHistory(previous => ({ ...previous, [job.id]: false }));
    } finally { setPendingId(''); }
  }

  const canSave = !loading && !saving && personas.length > 0;
  const connectedModels = settings?.connectedModels || [];
  const selectedModelKey = draft.model ? modelKey({ id: draft.model, provider: draft.provider, mode: draft.mode }) : '';
  const defaultModel = connectedModels.find(item => item.id === settings?.model && item.provider === settings?.selectedProvider && item.mode === settings?.selectedMode);
  const effectiveModel = connectedModels.find(item => modelKey(item) === selectedModelKey) || defaultModel;
  const thinkingLevels = effectiveModel?.thinkingLevels || ['off'];

  function closeTranscript() {
    transcriptRequest.current++;
    transcriptDialog.current?.close();
    setSelectedRun(null);
  }

  async function openTranscript(run) {
    if (!run.sessionId) return;
    const requestId = ++transcriptRequest.current;
    setSelectedRun(run); setTranscript(null); setTranscriptError('');
    try {
      const data = await request(`/api/sessions/${encodeURIComponent(run.sessionId)}`);
      if (requestId === transcriptRequest.current) setTranscript(data.session?.messages || []);
    } catch (reason) {
      if (requestId === transcriptRequest.current) setTranscriptError(reason.message);
    }
  }

  return <section class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-6" aria-labelledby="scheduled-job-title">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div>
        <p class="text-xs font-bold tracking-widest text-primary">AUTOMATION</p>
        <h1 id="scheduled-job-title" tabIndex="-1">Automations</h1>
        <p class="mt-2 text-sm leading-relaxed text-base-content/70">Run recurring persona tasks against repositories you choose.</p>
      </div>
      <span class="badge badge-primary badge-outline">{jobs.filter(job => job.enabled).length} active</span>
    </header>

    <div class="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)] xl:gap-6">
      <form class="card card-bordered w-full min-w-0 gap-0 bg-base-200 p-4 sm:p-6" onSubmit={save}>
        <div class="mb-1 border-b border-base-300 pb-4">
          <div><p class="text-xs font-bold tracking-widest text-primary">{editingId ? 'EDIT AUTOMATION' : 'NEW AUTOMATION'}</p><h2 class="mt-1 text-xl font-semibold">{editingId ? 'Edit automation' : 'Create an automation'}</h2></div>
        </div>
        <div class="grid min-w-0 gap-x-4 gap-y-5 pt-5 sm:grid-cols-2">
          <div class="min-w-0 space-y-2 sm:col-span-2">
            <label class="label-text font-medium" for="scheduled-job-name">Job name</label>
            <input class="input input-bordered w-full min-w-0" id="scheduled-job-name" type="text" required minLength="1" maxLength="120" value={draft.name} disabled={loading || saving} onInput={event => change('name', event.currentTarget.value)} />
          </div>
          <div class="min-w-0 space-y-2 sm:col-span-2">
            <label class="label-text font-medium" for="scheduled-job-agent">Run with persona</label>
            <select class="select select-bordered w-full min-w-0" id="scheduled-job-agent" required value={draft.personaId} disabled={loading || saving || !personas.length} onChange={event => change('personaId', event.currentTarget.value)}>
              <option value="" disabled>{personas.length ? 'Choose a persona' : 'Create a persona first'}</option>
              {personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
            </select>
          </div>
          <div class="min-w-0 space-y-2">
            <label class="label-text font-medium" for="scheduled-job-model">Model</label>
            <select class="select select-bordered w-full min-w-0" id="scheduled-job-model" value={selectedModelKey} disabled={loading || saving || !connectedModels.length} onChange={event => {
              const selected = connectedModels.find(item => modelKey(item) === event.currentTarget.value);
              change('model', selected?.id || '');
              change('provider', selected?.provider || '');
              change('mode', selected?.mode || '');
              change('thinkingLevel', '');
            }}>
              <option value="">Use default</option>
              {connectedModels.map(item => <option key={modelKey(item)} value={modelKey(item)}>{item.name || item.id} · {item.providerName}</option>)}
            </select>
          </div>
          <div class="min-w-0 space-y-2">
            <label class="label-text font-medium" for="scheduled-job-thinking">Thinking level</label>
            <select class="select select-bordered w-full min-w-0" id="scheduled-job-thinking" value={draft.thinkingLevel} disabled={loading || saving || !thinkingLevels.length} onChange={event => change('thinkingLevel', event.currentTarget.value)}>
              <option value="">Use default</option>
              {thinkingLevels.map(level => <option key={level} value={level}>{level === 'xhigh' ? 'Extra high' : level[0].toUpperCase() + level.slice(1)}</option>)}
            </select>
          </div>
          <div class="min-w-0 space-y-2 sm:col-span-2">
            <label class="label-text font-medium" for="scheduled-job-task">Task prompt</label>
            <textarea class="textarea textarea-bordered rounded-box w-full min-w-0" id="scheduled-job-task" rows="5" required maxLength="20000" placeholder="Describe the task to run on every occurrence…" value={draft.task} disabled={loading || saving} onInput={event => change('task', event.currentTarget.value)} />
            <p class="mt-2 text-sm leading-relaxed text-base-content/70">A new agent session is created for each run.</p>
          </div>
          <fieldset class="min-w-0 space-y-2 sm:col-span-2 border-0 p-0" disabled={loading || saving}>
            <legend class="label-text font-medium">Allowed repositories</legend>
            {repositories.length ? <div class="grid max-h-36 gap-1 overflow-auto rounded-box border border-base-300 p-2">{repositories.map(repo => <label class="flex items-center gap-3 rounded-box p-2 hover:bg-base-300" key={repo.name}>
              <input class="checkbox checkbox-primary rounded-md" type="checkbox" value={repo.name} checked={draft.allowedRepositories.includes(repo.name)} onChange={event => toggleRepository(repo.name, event.currentTarget.checked)} />
              <span>{repo.name}</span>
            </label>)}</div> : <p class="mt-2 text-sm leading-relaxed text-base-content/70">No repositories available. This job will not have repository access.</p>}
            <p class="mt-2 text-sm leading-relaxed text-base-content/70">Repository tools are restricted to this selection.</p>
          </fieldset>
          <div class="min-w-0 space-y-2">
            <label class="label-text font-medium" for="scheduled-job-frequency">Repeat</label>
            <select class="select select-bordered w-full min-w-0" id="scheduled-job-frequency" value={draft.schedule.type} disabled={loading || saving} onChange={event => chooseSchedule(event.currentTarget.value)}>
              {scheduleTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {['daily', 'weekly', 'monthly'].includes(draft.schedule.type) && <div class="min-w-0 space-y-2">
            <label class="label-text font-medium" for="scheduled-job-time">At</label>
            <input class="input input-bordered w-full min-w-0" id="scheduled-job-time" type="time" required value={draft.schedule.time} disabled={loading || saving} onInput={event => changeSchedule('time', event.currentTarget.value)} />
          </div>}
          {draft.schedule.type === 'weekly' && <div class="min-w-0 space-y-2">
            <label class="label-text font-medium" for="scheduled-job-day">Weekday</label>
            <select class="select select-bordered w-full min-w-0" id="scheduled-job-day" value={draft.schedule.weekday} disabled={loading || saving} onChange={event => changeSchedule('weekday', Number(event.currentTarget.value))}>
              {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
          </div>}
          {draft.schedule.type === 'monthly' && <div class="min-w-0 space-y-2">
            <label class="label-text font-medium" for="scheduled-job-day-of-month">Day of month</label>
            <select class="select select-bordered w-full min-w-0" id="scheduled-job-day-of-month" value={draft.schedule.dayOfMonth} disabled={loading || saving} onChange={event => changeSchedule('dayOfMonth', Number(event.currentTarget.value))}>
              {Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
            </select>
            <p class="mt-2 text-sm leading-relaxed text-base-content/70">Days 29–31 do not run in shorter months.</p>
          </div>}
          {['every_n_minutes', 'every_n_hours'].includes(draft.schedule.type) && <div class="min-w-0 space-y-2">
            <label class="label-text font-medium" for="scheduled-job-interval">Every</label>
            <div class="flex items-center gap-2"><input class="input input-bordered min-w-0 flex-1" id="scheduled-job-interval" type="number" min="1" max={draft.schedule.type === 'every_n_minutes' ? 59 : 24} required value={draft.schedule.interval} disabled={loading || saving} onInput={event => changeSchedule('interval', Number(event.currentTarget.value))} /><span>{draft.schedule.type === 'every_n_minutes' ? 'minutes' : 'hours'}</span></div>
            <p class="mt-2 text-sm leading-relaxed text-base-content/70">Aligned to local clock {draft.schedule.type === 'every_n_minutes' ? 'minute' : 'hour'} boundaries.</p>
          </div>}
          <div class="min-w-0 space-y-2">
            <label class="label-text font-medium" for="scheduled-job-timezone">Timezone</label>
            <input class="input input-bordered w-full min-w-0" id="scheduled-job-timezone" type="text" required maxLength="100" placeholder="America/Los_Angeles" value={draft.schedule.timezone} disabled={loading || saving} onInput={event => changeSchedule('timezone', event.currentTarget.value)} />
            <p class="mt-2 text-sm leading-relaxed text-base-content/70">Use an IANA timezone, such as Europe/London or UTC.</p>
          </div>
        </div>
        {error && <p class="alert alert-error mt-3" role="alert">{error}</p>}
        {status && <p class="alert alert-success mt-3" role="status">{status}</p>}
        {!personas.length && !loading && <p class="mt-2 text-sm leading-relaxed text-base-content/70" role="status">Create a persona before adding an automation.</p>}
        <div class="mt-6 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-4">
          {editingId && <button class="btn btn-ghost" type="button" disabled={saving} onClick={resetForm}>Cancel edit</button>}
          <button class="btn btn-primary" type="submit" disabled={!canSave}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create automation'}</button>
        </div>
      </form>

      <aside class="grid w-full min-w-0 gap-3" aria-label="Automations">
        <section class="card card-bordered bg-base-200 p-4 sm:p-5">
          <div class="mb-3 flex items-center justify-between gap-3"><div><p class="text-xs font-bold tracking-widest text-primary">AUTOMATIONS</p><h2>Your jobs</h2></div><span>{jobs.length}</span></div>
          {loading && <p class="mt-2 text-sm leading-relaxed text-base-content/70" role="status">Loading automations…</p>}
          {!loading && !jobs.length && <div class="flex items-start gap-3 rounded-box border border-dashed border-base-300 p-4"><span class="text-2xl text-primary" aria-hidden="true">◷</span><div><strong>No automations yet</strong><p>Create a job to run a recurring persona task.</p></div></div>}
          <div class="grid gap-3">{jobs.map(job => {
            const persona = personas.find(item => item.id === job.personaId);
            const busy = pendingId === job.id;
            return <article class="min-w-0 card card-bordered bg-base-100 p-4" key={job.id}>
              <div class="flex items-start justify-between gap-3"><div><h3>{job.name}</h3><span class={`badge badge-sm ${job.enabled ? 'badge-success' : 'badge-ghost'}`}>{job.enabled ? 'Enabled' : 'Disabled'}</span></div></div>
              <p class="mt-2 text-sm text-base-content/70">Persona · <strong>{persona?.name || 'Unavailable persona'}</strong></p>
              <p class="mt-2 text-sm text-base-content/70">{scheduleLabel(job.schedule)}</p>
              <p class="mt-2 whitespace-pre-wrap break-words text-sm line-clamp-3">{job.task}</p>
              <p class="mt-2 break-words text-sm text-base-content/70">Repositories · {job.allowedRepositories.length ? job.allowedRepositories.join(', ') : 'None'}</p>
              <div class="mt-3 flex flex-wrap gap-1">
                <button class="btn btn-ghost" type="button" disabled={Boolean(pendingId || saving)} onClick={() => editJob(job)}>Edit</button>
                <button class="btn btn-ghost" type="button" disabled={Boolean(pendingId)} onClick={() => setEnabled(job)}>{busy ? 'Saving…' : job.enabled ? 'Disable' : 'Enable'}</button>
                <button class="btn btn-ghost" type="button" disabled={Boolean(pendingId)} onClick={() => remove(job)}>Delete</button>
                <button class="btn btn-ghost btn-sm" type="button" aria-expanded={Boolean(expandedHistory[job.id])} disabled={Boolean(pendingId)} onClick={() => toggleHistory(job)}>{busy && expandedHistory[job.id] && !Object.hasOwn(history, job.id) ? 'Loading runs…' : `${expandedHistory[job.id] ? 'Hide' : 'Show'} run history`}</button>
              </div>
              {expandedHistory[job.id] && <section class="mt-3 border-t border-base-300 pt-3" aria-label={`Run history for ${job.name}`}>
                <h4>Run history</h4>
                {!Object.hasOwn(history, job.id) && <p class="mt-2 text-sm leading-relaxed text-base-content/70" role="status">Loading run history…</p>}
                {history[job.id]?.length === 0 && <p class="mt-2 text-sm leading-relaxed text-base-content/70">No runs yet.</p>}
                {history[job.id]?.map(run => <article class="border-t border-base-300/70 py-2" key={run.id}>
                  <button class="h-auto w-full flex-col items-stretch text-left btn btn-ghost h-auto w-full flex-col items-stretch text-left" type="button" disabled={!run.sessionId} aria-haspopup="dialog" onClick={() => openTranscript(run)}>
                    <span><strong class={`font-medium capitalize ${run.status === 'completed' ? 'text-success' : run.status === 'failed' ? 'text-error' : run.status === 'skipped' ? 'text-warning' : ''}`} >{run.status}</strong><time>{formatDate(run.scheduledFor)}</time></span>
                    {run.result && <span class="mt-2 whitespace-pre-wrap break-words text-sm">{run.result}</span>}
                    {run.error && <span class="mt-2 whitespace-pre-wrap break-words text-sm text-error">{run.error}</span>}
                  </button>
                </article>)}
              </section>}
            </article>;
          })}</div>
        </section>
      </aside>
    </div>
    <dialog class="modal" ref={transcriptDialog} aria-labelledby="scheduled-job-transcript-title" onClose={() => { transcriptRequest.current++; setSelectedRun(null); }} onCancel={event => { event.preventDefault(); closeTranscript(); }} onClick={event => { if (event.target === transcriptDialog.current) closeTranscript(); }}>
      <div class="modal-box max-h-[80vh] w-full max-w-3xl">
      <header class="mb-4 flex items-start justify-between gap-4"><div><p class="text-xs font-bold tracking-widest text-primary">RUN TRANSCRIPT</p><h2 id="scheduled-job-transcript-title">{selectedRun ? formatDate(selectedRun.scheduledFor) : 'Run transcript'}</h2></div><button class="btn btn-ghost btn-square btn-sm" type="button" aria-label="Close transcript" onClick={closeTranscript}>×</button></header>
      {transcriptError && <p class="alert alert-error" role="alert">{transcriptError}</p>}
      {!transcript && !transcriptError && <p class="mt-2 text-sm leading-relaxed text-base-content/70" role="status">Loading transcript…</p>}
      {transcript && <div class="grid max-h-[60vh] gap-3 overflow-y-auto">{transcript.map((message, index) => <article class="rounded-box border border-base-300 bg-base-100 p-3" key={index}><h3>{message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'You' : message.role}</h3><pre class="whitespace-pre-wrap break-words">{messageText(message.content)}</pre></article>)}</div>}
      </div>
    </dialog>
  </section>;
}
