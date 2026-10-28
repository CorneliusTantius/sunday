import { useRef, useState } from 'preact/hooks';

export default function McpServers({ config, auth = {}, busy, onSave, onLogin, loginBusy }) {
  const dialog = useRef(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const servers = config.mcpServers;
  function open(name = '') {
    const server = servers[name] || {};
    setDraft({ original: name, name, server, transport: server.url ? 'http' : 'stdio', command: server.command || '', url: server.url || '', args: JSON.stringify(server.args || [], null, 2), env: JSON.stringify(server.env || {}, null, 2), headers: JSON.stringify(server.headers || {}, null, 2), enabled: server.enabled !== false });
    setError('');
    dialog.current.showModal();
  }
  function field(key, value) { setDraft(previous => ({ ...previous, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const name = draft.name.trim();
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Use letters, numbers, underscores, or hyphens for the name.');
      if (name !== draft.original && Object.hasOwn(servers, name)) throw new Error('A server with this name already exists.');
      const server = { ...draft.server, enabled: draft.enabled };
      delete server.command; delete server.args; delete server.env; delete server.url; delete server.headers; delete server.type;
      if (draft.transport === 'stdio') {
        if (!draft.command.trim()) throw new Error('Enter a command.');
        Object.assign(server, { command: draft.command.trim(), args: JSON.parse(draft.args), env: JSON.parse(draft.env) });
        if (!Array.isArray(server.args) || server.args.some(value => typeof value !== 'string')) throw new Error('Arguments must be a JSON array of strings.');
      } else {
        const url = new URL(draft.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS URL.');
        Object.assign(server, { url: draft.url, headers: JSON.parse(draft.headers) });
      }
      for (const key of ['env', 'headers']) {
        if (server[key] !== undefined && (!server[key] || Array.isArray(server[key]) || typeof server[key] !== 'object' || Object.values(server[key]).some(value => typeof value !== 'string'))) throw new Error(`${key} must be a JSON object with string values.`);
      }
      const next = { ...servers };
      delete next[draft.original];
      Object.defineProperty(next, name, { value: server, enumerable: true, configurable: true, writable: true });
      if (await onSave({ ...config, mcpServers: next })) dialog.current.close();
      else setError('Could not save the server. Check the configuration and try again.');
    } catch (error) { setError(error.message); }
  }
  return <>
    <div class="flex flex-wrap items-center justify-between gap-4"><h3>MCP servers</h3><button class="btn btn-outline" disabled={busy} onClick={() => open()}>＋ Add server</button></div>
    <p class="text-sm text-base-content/70">Only add trusted servers: stdio servers execute code. Secrets in environment variables or headers are stored locally.</p>
    <div class="grid gap-3">
      {Object.entries(servers).map(([name, server]) => <div class="card card-border bg-base-100 p-4" key={name}>
        <div class="flex flex-wrap items-center gap-2"><strong>{name}</strong><span class={`badge ${server.enabled === false ? 'badge-ghost' : 'badge-success badge-soft'}`}>{server.enabled === false ? 'Disabled' : 'Enabled'}</span><span class="badge badge-outline">{server.url ? 'HTTP' : 'stdio'}</span>
          {server.url && <span class={`badge ${auth[name] ? 'badge-info badge-soft' : 'badge-ghost'}`} role="status" title="Stored OAuth credentials; access is checked when connecting.">{auth[name] ? 'Signed in' : 'Not signed in'}</span>}
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2"><button class="btn btn-outline" disabled={busy} onClick={() => open(name)}>Edit</button>{server.url && <button class="btn btn-outline" disabled={busy || loginBusy || server.enabled === false} onClick={() => onLogin(name)}>{auth[name] ? 'Sign in again' : 'Sign in'}</button>}<button class="btn btn-ghost" disabled={busy} onClick={() => { if (window.confirm(`Remove MCP server ${name}?`)) { const next = { ...servers }; delete next[name]; onSave({ ...config, mcpServers: next }); } }}>Remove</button></div>
      </div>)}
      {!Object.keys(servers).length && <p class="text-sm text-base-content/70">No MCP servers configured. Add a server to get started.</p>}
    </div>
    <dialog ref={dialog} class="modal" aria-label="MCP server configuration" onCancel={event => { if (busy) event.preventDefault(); }} onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation(); }}>
      {draft && <div class="modal-box max-h-[85vh] w-[min(520px,calc(100vw-32px))] overflow-y-auto bg-base-100 text-base-content"><form onSubmit={submit}>
        <h3 class="mb-4 text-lg font-bold">{draft.original ? 'Edit MCP server' : 'Add MCP server'}</h3>
        <fieldset class="fieldset" disabled={busy}>
          <label class="label font-semibold" for="mcp-server-name">Name</label><input autoFocus id="mcp-server-name" class="input input-bordered w-full" required value={draft.name} onInput={event => field('name', event.currentTarget.value)} />
          <label class="label font-semibold" for="mcp-transport">Transport</label><select id="mcp-transport" class="select select-bordered w-full" value={draft.transport} onChange={event => field('transport', event.currentTarget.value)}><option value="stdio">stdio (local command)</option><option value="http">HTTP</option></select>
          {draft.transport === 'stdio' ? <>
            <label class="label font-semibold" for="mcp-command">Command</label><input id="mcp-command" class="input input-bordered w-full" required value={draft.command} onInput={event => field('command', event.currentTarget.value)} />
            <label class="label font-semibold" for="mcp-args">Arguments (JSON array)</label><textarea id="mcp-args" class="textarea textarea-bordered w-full" rows="3" value={draft.args} onInput={event => field('args', event.currentTarget.value)} />
            <label class="label font-semibold" for="mcp-env">Environment variables (JSON object)</label><textarea id="mcp-env" class="textarea textarea-bordered w-full" rows="3" spellcheck={false} value={draft.env} onInput={event => field('env', event.currentTarget.value)} />
          </> : <>
            <label class="label font-semibold" for="mcp-url">Server URL</label><input id="mcp-url" class="input input-bordered w-full" type="url" required value={draft.url} onInput={event => field('url', event.currentTarget.value)} />
            <label class="label font-semibold" for="mcp-headers">Headers (JSON object)</label><textarea id="mcp-headers" class="textarea textarea-bordered w-full" rows="3" spellcheck={false} value={draft.headers} onInput={event => field('headers', event.currentTarget.value)} />
          </>}
          <label class="label cursor-pointer justify-start gap-3"><input class="checkbox" type="checkbox" checked={draft.enabled} onChange={event => field('enabled', event.currentTarget.checked)} /> Enabled</label>
        </fieldset>
        <p class="alert alert-error empty:hidden py-2" role="alert">{error}</p>
        <div class="modal-action"><button type="button" class="btn btn-outline" disabled={busy} onClick={() => dialog.current.close()}>Cancel</button><button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save server'}</button></div>
      </form></div>}
    </dialog>
  </>;
}
