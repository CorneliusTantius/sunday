import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';
import Character from './Character.jsx';

const emptyProfile = () => ({ name: '', specialty: '', instructions: '', color: 'cyan', allowedTools: [] });
const toolGroups = [
  { name: 'Repository files', tools: ['read', 'find', 'edit'] },
  { name: 'Context', tools: ['context_search', 'context_index', 'context_links', 'context_link', 'context_unlink'] },
];

function shortToolDescription(description = '') {
  const firstSentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || description.trim();
  return firstSentence.length > 120 ? `${firstSentence.slice(0, 117).trimEnd()}…` : firstSentence;
}

export default function Personas({ hidden, toast, onReload }) {
  const [personas, setPersonas] = useState([]);
  const [tools, setTools] = useState([]);
  const [id, setId] = useState('');
  const [profile, setProfile] = useState(emptyProfile);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const nameInput = useRef(null);
  const alive = useRef(true);

  function select(items, selected, availableTools = tools) {
    const persona = items.find(item => item.id === selected);
    setId(persona?.id || '');
    setProfile(persona ? { ...emptyProfile(), ...persona, allowedTools: persona.allowedTools ?? availableTools.map(tool => tool.name) } : { ...emptyProfile(), allowedTools: availableTools.map(tool => tool.name) });
    setError('');
  }

  useEffect(() => {
    alive.current = true;
    request('/api/personas').then(data => {
      if (!alive.current) return;
      setTools(data.tools || []);
      const items = data.personas || [];
      setPersonas(items);
      select(items, items[0]?.id, data.tools || []);
    }).catch(error => { if (alive.current) setError(error.message); })
      .finally(() => { if (alive.current) setBusy(false); });
    return () => { alive.current = false; };
  }, []);

  function change(field, value) { setProfile(previous => ({ ...previous, [field]: value })); }
  function setToolAllowed(name, allowed) {
    change('allowedTools', allowed ? [...new Set([...profile.allowedTools, name])] : profile.allowedTools.filter(item => item !== name));
  }

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
      setTools(loaded.tools || []);
      setPersonas(loaded.personas || []);
      select(loaded.personas || [], data.persona.id, loaded.tools || []);
      toast('Persona saved');
      await onReload?.();
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setBusy(false); }
  }

  const toolPermissionItems = [
    ...toolGroups.map(group => ({ name: group.name, group, tools: tools.filter(tool => group.tools.includes(tool.name)) })),
    ...tools.filter(tool => !toolGroups.some(group => group.tools.includes(tool.name))).map(tool => ({ name: tool.name, tool })),
  ].filter(item => item.group ? item.tools.length > 0 : true).sort((a, b) => a.name.localeCompare(b.name));

  async function remove() {
    if (!id || busy || !window.confirm('Delete this persona? Existing session profiles will not change.')) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await request('/api/personas');
      if (!alive.current) return;
      setTools(data.tools || []);
      const items = data.personas || [];
      setPersonas(items);
      select(items, items[0]?.id, data.tools || []);
      await onReload?.();
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section inert={hidden} id="settings-personas-page" class={`space-y-4${hidden ? ' hidden' : ''}`}>
    <h3>Profiles &amp; personas</h3><p class="mt-2 text-sm leading-relaxed text-base-content/70">Reusable starting profiles. Changes here do not change existing sessions.</p>
    <select id="persona-select" class="select select-bordered mt-4 w-full max-w-md" aria-label="Choose saved persona" value={id} disabled={busy} onChange={event => {
      if (event.currentTarget.value === '__new__') { select(personas, ''); nameInput.current?.focus(); }
      else select(personas, event.currentTarget.value);
    }}>
      {!id && <option value="">New persona</option>}
      {personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
      {id && <option value="__new__">＋ New persona</option>}
    </select>
    <form id="persona-form" aria-labelledby="persona-config-heading" onSubmit={save}>
      <h4 id="persona-config-heading">Persona configuration</h4><p class="mt-2 text-sm leading-relaxed text-base-content/70 mb-4">Edit this persona’s identity, instructions, and tool permissions below.</p>
      <div class="grid gap-2"><label class="label-text font-medium" for="persona-name">Name</label><input ref={nameInput} id="persona-name" class="input input-bordered" required maxLength="80" value={profile.name} disabled={busy} onInput={event => change('name', event.currentTarget.value)} /></div>
      <div class="grid gap-3">
        <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div class="flex items-center justify-between gap-2"><label class="label-text font-medium" for="persona-color">Character color</label><div id="persona-preview" aria-label="Persona character preview"><Character profile={profile} /></div></div><select class="select select-bordered border-base-300" id="persona-color" value={profile.color} disabled={busy} onChange={event => change('color', event.currentTarget.value)}>
          {['cyan', 'violet', 'blue', 'amber', 'lime', 'pink'].map(color => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}
        </select></div>
      </div>
      <div class="grid gap-2"><label class="label-text font-medium" for="persona-specialty">Specialty or task</label><input id="persona-specialty" class="input input-bordered" maxLength="200" value={profile.specialty} disabled={busy} onInput={event => change('specialty', event.currentTarget.value)} /></div>
      <label class="label-text font-medium" for="persona-instructions">Custom instructions</label><textarea class="textarea textarea-bordered rounded-box w-full" id="persona-instructions" rows="6" maxLength="8000" aria-describedby="persona-instructions-note" value={profile.instructions} disabled={busy} onInput={event => change('instructions', event.currentTarget.value)} />
      <p id="persona-instructions-note" class="mt-2 text-sm leading-relaxed text-base-content/70">Edit the persona’s responsibilities and workflow here. Sunday and Coding Agent start with editable defaults; shared system rules and tool guidance are added separately.</p>
      <details class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200" open><summary>Tool permissions</summary><fieldset class="grid gap-2"><legend class="sr-only">Tool permissions</legend><div id="persona-tools">
        {toolPermissionItems.map(item => {
          if (!item.group) {
            const { tool } = item;
            return <label key={tool.name} class="flex items-center gap-3 rounded-box p-2 hover:bg-base-300"><input class="checkbox checkbox-primary rounded-md" type="checkbox" value={tool.name} disabled={busy} checked={profile.allowedTools.includes(tool.name)} onChange={event => setToolAllowed(tool.name, event.currentTarget.checked)} /><span class="grid min-w-0 flex-1 gap-1 break-words"><strong>{tool.name === 'bash' ? 'Bash' : tool.name}</strong><ul class="m-0 w-full list-disc pl-5 [&_li]:my-1 [&_li]:break-words"><li><code>{tool.name}</code>: {shortToolDescription(tool.description)}</li></ul></span></label>;
          }
          const { group, tools: groupedTools } = item;
          const enabled = groupedTools.filter(tool => profile.allowedTools.includes(tool.name)).length;
          const checked = enabled === groupedTools.length;
          return <label class="flex items-start gap-3 rounded-box border border-base-300 p-2" key={group.name}><input class="checkbox checkbox-primary rounded-md" type="checkbox" value={group.name} disabled={busy} checked={checked} onChange={event => {
            const names = groupedTools.map(tool => tool.name);
            change('allowedTools', event.currentTarget.checked
              ? [...new Set([...profile.allowedTools, ...names])]
              : profile.allowedTools.filter(name => !names.includes(name)));
          }} /><span class="grid min-w-0 flex-1 gap-1 break-words"><strong>{group.name}</strong><ul class="m-0 w-full list-disc pl-5 [&_li]:my-1 [&_li]:break-words">{groupedTools.map(tool => <li key={tool.name}><code>{tool.name}</code>: {shortToolDescription(tool.description)}</li>)}</ul></span></label>;
        })}
      </div></fieldset></details>
      <div class="flex flex-wrap gap-2"><button class="btn btn-primary" id="save-persona" type="submit" disabled={busy}>Save persona</button><button class="btn btn-ghost" id="delete-persona" type="button" disabled={busy || !id} onClick={remove}>Delete persona</button></div>
      <p id="persona-error" class="alert alert-error" role="alert">{error}</p>
    </form>
  </section>;
}
