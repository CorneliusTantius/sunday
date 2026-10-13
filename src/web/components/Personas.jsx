import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';
import Character from './Character.jsx';

const tools = ['read', 'edit', 'bash'];
const emptyProfile = () => ({ name: '', specialty: '', instructions: '', color: 'cyan', allowedTools: [...tools] });

export default function Personas({ hidden, toast, onReload }) {
  const [personas, setPersonas] = useState([]);
  const [id, setId] = useState('');
  const [profile, setProfile] = useState(emptyProfile);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const nameInput = useRef(null);
  const alive = useRef(true);

  function select(items, selected) {
    const persona = items.find(item => item.id === selected);
    setId(persona?.id || '');
    setProfile(persona ? { ...emptyProfile(), ...persona, allowedTools: persona.allowedTools || [...tools] } : emptyProfile());
    setError('');
  }

  useEffect(() => {
    alive.current = true;
    request('/api/personas').then(data => {
      if (!alive.current) return;
      const items = data.personas || [];
      setPersonas(items);
      select(items, items[0]?.id);
    }).catch(error => { if (alive.current) setError(error.message); })
      .finally(() => { if (alive.current) setBusy(false); });
    return () => { alive.current = false; };
  }, []);

  function change(field, value) { setProfile(previous => ({ ...previous, [field]: value })); }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await jsonRequest(id ? `/api/personas/${encodeURIComponent(id)}` : '/api/personas', id ? 'PATCH' : 'POST', {
        name: profile.name.trim(), specialty: profile.specialty.trim(), instructions: profile.instructions,
        color: profile.color, allowedTools: profile.allowedTools,
      });
      const loaded = await request('/api/personas');
      if (!alive.current) return;
      setPersonas(loaded.personas || []);
      select(loaded.personas || [], data.persona.id);
      toast('Persona saved');
      await onReload?.();
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setBusy(false); }
  }

  async function remove() {
    if (!id || busy || !window.confirm('Delete this persona? Existing session profiles will not change.')) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await request('/api/personas');
      if (!alive.current) return;
      const items = data.personas || [];
      setPersonas(items);
      select(items, items[0]?.id);
      await onReload?.();
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section id="settings-personas-page" class={`settings-section${hidden ? ' hidden' : ''}`}>
    <h3>Profiles &amp; personas</h3><p class="field-note">Reusable starting profiles. Changes here do not change existing sessions.</p>
    <select id="persona-select" class="select persona-select" aria-label="Choose saved persona" value={id} disabled={busy} onChange={event => {
      if (event.currentTarget.value === '__new__') { select(personas, ''); nameInput.current?.focus(); }
      else select(personas, event.currentTarget.value);
    }}>
      {!id && <option value="">New persona</option>}
      {personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
      {id && <option value="__new__">＋ New persona</option>}
    </select>
    <form id="persona-form" aria-labelledby="persona-config-heading" onSubmit={save}>
      <h4 id="persona-config-heading">Persona configuration</h4><p class="field-note persona-config-note">Edit this persona’s identity, instructions, and tool permissions below.</p>
      <label class="field-label" for="persona-name">Name</label><input ref={nameInput} id="persona-name" class="text-input" required maxLength="80" value={profile.name} disabled={busy} onInput={event => change('name', event.currentTarget.value)} />
      <div class="persona-appearance">
        <div class="persona-color-field"><label class="field-label" for="persona-color">Character color</label><select class="select" id="persona-color" value={profile.color} disabled={busy} onChange={event => change('color', event.currentTarget.value)}>
          {['cyan', 'violet', 'blue', 'amber', 'lime', 'pink'].map(color => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}
        </select></div>
        <div id="persona-preview" aria-label="Persona character preview"><Character profile={profile} /></div>
      </div>
      <label class="field-label" for="persona-specialty">Specialty or task</label><input id="persona-specialty" class="text-input" maxLength="200" value={profile.specialty} disabled={busy} onInput={event => change('specialty', event.currentTarget.value)} />
      <label class="field-label" for="persona-instructions">Instructions</label><textarea id="persona-instructions" class="text-input" rows="6" maxLength="8000" value={profile.instructions} disabled={busy} onInput={event => change('instructions', event.currentTarget.value)} />
      <fieldset class="repository-options"><legend class="field-label">Repository tools</legend><div id="persona-tools">
        {tools.map(tool => <label key={tool} class="repository-checkbox"><input type="checkbox" value={tool} disabled={busy} checked={profile.allowedTools.includes(tool)} onChange={event => change('allowedTools', event.currentTarget.checked ? [...profile.allowedTools, tool] : profile.allowedTools.filter(item => item !== tool))} /><span>{tool}</span></label>)}
      </div></fieldset>
      <p class="field-note">Shared memory search and update are available to every agent.</p>
      <div class="code-row"><button class="primary-button" id="save-persona" type="submit" disabled={busy}>Save persona</button><button class="secondary-button" id="delete-persona" type="button" disabled={busy || !id} onClick={remove}>Delete persona</button></div>
      <p id="persona-error" class="form-error" role="alert">{error}</p>
    </form>
  </section>;
}
