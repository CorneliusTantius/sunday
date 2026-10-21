import { useEffect, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const defaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const emptyDraft = () => ({
  name: '', personaId: '', task: '', allowedRepositories: [],
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

export default function ScheduledJobs() {
  const [jobs, setJobs] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [repositories, setRepositories] = useState([]);
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
    let active = true;
    Promise.all([request('/api/scheduled-jobs'), request('/api/personas'), request('/api/repos')])
      .then(([jobData, personaData, repoData]) => {
        if (!active) return;
        setJobs(jobData.jobs || []);
        setPersonas(personaData.personas || []);
        setRepositories(repoData.repos || []);
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
      allowedRepositories: [...job.allowedRepositories],
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
      };
      const data = await jsonRequest(editingId ? `/api/scheduled-jobs/${editingId}` : '/api/scheduled-jobs', editingId ? 'PATCH' : 'POST', payload);
      setJobs(previous => editingId
        ? previous.map(job => job.id === editingId ? data.job : job)
        : [data.job, ...previous]);
      setStatus(editingId ? 'Scheduled job updated.' : 'Scheduled job created.');
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
      setStatus(data.job.enabled ? 'Scheduled job enabled.' : 'Scheduled job disabled.');
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
      setStatus('Scheduled job deleted.');
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

  return <section class="scheduled-jobs-page" aria-labelledby="scheduled-job-title">
    <header class="scheduled-job-header">
      <div>
        <p class="eyebrow">AUTOMATION</p>
        <h1 id="scheduled-job-title" tabIndex="-1">Scheduled jobs</h1>
        <p class="field-note">Run recurring persona tasks against repositories you choose.</p>
      </div>
      <span class="scheduled-job-count">{jobs.filter(job => job.enabled).length} active</span>
    </header>

    <div class="scheduled-job-layout">
      <form class="scheduled-job-builder" onSubmit={save}>
        <div class="scheduled-job-section-heading">
          <div><p class="eyebrow">{editingId ? 'EDIT AUTOMATION' : 'NEW AUTOMATION'}</p><h2>{editingId ? 'Edit scheduled job' : 'Build a scheduled job'}</h2></div>
        </div>
        <div class="scheduled-job-fields">
          <div class="scheduled-job-field scheduled-job-field-wide">
            <label class="field-label" for="scheduled-job-name">Job name</label>
            <input class="text-input" id="scheduled-job-name" type="text" required minLength="1" maxLength="120" value={draft.name} disabled={loading || saving} onInput={event => change('name', event.currentTarget.value)} />
          </div>
          <div class="scheduled-job-field scheduled-job-field-wide">
            <label class="field-label" for="scheduled-job-agent">Run with persona</label>
            <select class="select" id="scheduled-job-agent" required value={draft.personaId} disabled={loading || saving || !personas.length} onChange={event => change('personaId', event.currentTarget.value)}>
              <option value="" disabled>{personas.length ? 'Choose a persona' : 'Create a persona first'}</option>
              {personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
            </select>
          </div>
          <div class="scheduled-job-field scheduled-job-field-wide">
            <label class="field-label" for="scheduled-job-task">Task prompt</label>
            <textarea class="text-input scheduled-job-task" id="scheduled-job-task" rows="5" required maxLength="20000" placeholder="Describe the task to run on every occurrence…" value={draft.task} disabled={loading || saving} onInput={event => change('task', event.currentTarget.value)} />
            <p class="field-note">A new agent session is created for each run.</p>
          </div>
          <fieldset class="scheduled-job-field scheduled-job-field-wide scheduled-job-repositories" disabled={loading || saving}>
            <legend class="field-label">Allowed repositories</legend>
            {repositories.length ? <div class="scheduled-job-repo-list">{repositories.map(repo => <label class="repository-checkbox" key={repo.name}>
              <input type="checkbox" value={repo.name} checked={draft.allowedRepositories.includes(repo.name)} onChange={event => toggleRepository(repo.name, event.currentTarget.checked)} />
              <span>{repo.name}</span>
            </label>)}</div> : <p class="field-note">No repositories available. This job will not have repository access.</p>}
            <p class="field-note">Repository tools are restricted to this selection.</p>
          </fieldset>
          <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-frequency">Repeat</label>
            <select class="select" id="scheduled-job-frequency" value={draft.schedule.type} disabled={loading || saving} onChange={event => chooseSchedule(event.currentTarget.value)}>
              {scheduleTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {['daily', 'weekly', 'monthly'].includes(draft.schedule.type) && <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-time">At</label>
            <input class="text-input" id="scheduled-job-time" type="time" required value={draft.schedule.time} disabled={loading || saving} onInput={event => changeSchedule('time', event.currentTarget.value)} />
          </div>}
          {draft.schedule.type === 'weekly' && <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-day">Weekday</label>
            <select class="select" id="scheduled-job-day" value={draft.schedule.weekday} disabled={loading || saving} onChange={event => changeSchedule('weekday', Number(event.currentTarget.value))}>
              {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
          </div>}
          {draft.schedule.type === 'monthly' && <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-day-of-month">Day of month</label>
            <select class="select" id="scheduled-job-day-of-month" value={draft.schedule.dayOfMonth} disabled={loading || saving} onChange={event => changeSchedule('dayOfMonth', Number(event.currentTarget.value))}>
              {Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
            </select>
            <p class="field-note">Days 29–31 do not run in shorter months.</p>
          </div>}
          {['every_n_minutes', 'every_n_hours'].includes(draft.schedule.type) && <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-interval">Every</label>
            <div class="scheduled-job-interval"><input class="text-input" id="scheduled-job-interval" type="number" min="1" max={draft.schedule.type === 'every_n_minutes' ? 59 : 24} required value={draft.schedule.interval} disabled={loading || saving} onInput={event => changeSchedule('interval', Number(event.currentTarget.value))} /><span>{draft.schedule.type === 'every_n_minutes' ? 'minutes' : 'hours'}</span></div>
            <p class="field-note">Aligned to local clock {draft.schedule.type === 'every_n_minutes' ? 'minute' : 'hour'} boundaries.</p>
          </div>}
          <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-timezone">Timezone</label>
            <input class="text-input" id="scheduled-job-timezone" type="text" required maxLength="100" placeholder="America/Los_Angeles" value={draft.schedule.timezone} disabled={loading || saving} onInput={event => changeSchedule('timezone', event.currentTarget.value)} />
            <p class="field-note">Use an IANA timezone, such as Europe/London or UTC.</p>
          </div>
        </div>
        {error && <p class="form-error scheduled-job-error" role="alert">{error}</p>}
        {status && <p class="scheduled-job-status" role="status">{status}</p>}
        {!personas.length && !loading && <p class="field-note" role="status">Create a persona before adding a scheduled job.</p>}
        <div class="scheduled-job-actions">
          {editingId && <button class="secondary-button" type="button" disabled={saving} onClick={resetForm}>Cancel edit</button>}
          <button class="primary-button" type="submit" disabled={!canSave}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create scheduled job'}</button>
        </div>
      </form>

      <aside class="scheduled-job-aside" aria-label="Saved scheduled jobs">
        <section class="scheduled-job-summary">
          <div class="scheduled-job-list-heading"><div><p class="eyebrow">AUTOMATIONS</p><h2>Your jobs</h2></div><span>{jobs.length}</span></div>
          {loading && <p class="field-note" role="status">Loading scheduled jobs…</p>}
          {!loading && !jobs.length && <div class="scheduled-job-empty-state"><span class="scheduled-job-clock-icon" aria-hidden="true">◷</span><div><strong>No scheduled jobs yet</strong><p>Create a job to run a recurring persona task.</p></div></div>}
          <div class="scheduled-job-list">{jobs.map(job => {
            const persona = personas.find(item => item.id === job.personaId);
            const busy = pendingId === job.id;
            return <article class="scheduled-job-card" key={job.id}>
              <div class="scheduled-job-card-heading"><div><h3>{job.name}</h3><span class={`scheduled-job-state${job.enabled ? ' enabled' : ''}`}>{job.enabled ? 'Enabled' : 'Disabled'}</span></div></div>
              <p class="scheduled-job-card-persona">Persona · <strong>{persona?.name || 'Unavailable persona'}</strong></p>
              <p class="scheduled-job-card-schedule">{scheduleLabel(job.schedule)}</p>
              <p class="scheduled-job-card-task">{job.task}</p>
              <p class="scheduled-job-card-repos">Repositories · {job.allowedRepositories.length ? job.allowedRepositories.join(', ') : 'None'}</p>
              <div class="scheduled-job-card-actions">
                <button class="secondary-button" type="button" disabled={Boolean(pendingId || saving)} onClick={() => editJob(job)}>Edit</button>
                <button class="secondary-button" type="button" disabled={Boolean(pendingId)} onClick={() => setEnabled(job)}>{busy ? 'Saving…' : job.enabled ? 'Disable' : 'Enable'}</button>
                <button class="secondary-button" type="button" disabled={Boolean(pendingId)} onClick={() => remove(job)}>Delete</button>
                <button class="scheduled-job-history-toggle" type="button" aria-expanded={Boolean(expandedHistory[job.id])} disabled={Boolean(pendingId)} onClick={() => toggleHistory(job)}>{busy && expandedHistory[job.id] && !Object.hasOwn(history, job.id) ? 'Loading runs…' : `${expandedHistory[job.id] ? 'Hide' : 'Show'} run history`}</button>
              </div>
              {expandedHistory[job.id] && <section class="scheduled-job-history" aria-label={`Run history for ${job.name}`}>
                <h4>Run history</h4>
                {!Object.hasOwn(history, job.id) && <p class="field-note" role="status">Loading run history…</p>}
                {history[job.id]?.length === 0 && <p class="field-note">No runs yet.</p>}
                {history[job.id]?.map(run => <article class="scheduled-job-run" key={run.id}>
                  <div><strong class={`scheduled-job-run-status ${run.status}`}>{run.status}</strong><time>{formatDate(run.scheduledFor)}</time></div>
                  {run.result && <p class="scheduled-job-run-result">{run.result}</p>}
                  {run.error && <p class="scheduled-job-run-error">{run.error}</p>}
                </article>)}
              </section>}
            </article>;
          })}</div>
        </section>
      </aside>
    </div>
  </section>;
}
