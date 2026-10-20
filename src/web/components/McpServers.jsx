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
    <div class="settings-page-heading"><h3>MCP servers</h3><button class="secondary-button" disabled={busy} onClick={() => open()}>＋ Add server</button></div>
    <p class="field-note">Only add trusted servers: stdio servers execute code. Secrets in environment variables or headers are stored locally.</p>
    <div class="provider-list">
      {Object.entries(servers).map(([name, server]) => <div class="provider-card mcp-server-entry" key={name}>
        <div class="mcp-server-title"><strong>{name}</strong><span class={`mcp-status-pill${server.enabled === false ? ' disabled' : ' enabled'}`}>{server.enabled === false ? 'Disabled' : 'Enabled'}</span><span class="provider-status">{server.url ? 'HTTP' : 'stdio'}</span>
          {server.url && <span class={`mcp-status-pill${auth[name] ? ' signed-in' : ' signed-out'}`} role="status" title="Stored OAuth credentials; access is checked when connecting.">{auth[name] ? 'Signed in' : 'Not signed in'}</span>}
        </div>
        <div class="mcp-server-actions"><button class="secondary-button" disabled={busy} onClick={() => open(name)}>Edit</button>{server.url && <button class="secondary-button" disabled={busy || loginBusy || server.enabled === false} onClick={() => onLogin(name)}>{auth[name] ? 'Sign in again' : 'Sign in'}</button>}<button class="text-button" disabled={busy} onClick={() => { if (window.confirm(`Remove MCP server ${name}?`)) { const next = { ...servers }; delete next[name]; onSave({ ...config, mcpServers: next }); } }}>Remove</button></div>
      </div>)}
      {!Object.keys(servers).length && <p class="field-note">No MCP servers configured. Add a server to get started.</p>}
    </div>
    <dialog ref={dialog} class="mcp-server-dialog" aria-label="MCP server configuration" onCancel={event => { if (busy) event.preventDefault(); }} onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation(); }}>
      {draft && <form onSubmit={submit}>
        <h3>{draft.original ? 'Edit MCP server' : 'Add MCP server'}</h3>
        <fieldset disabled={busy}>
          <label class="field-label" for="mcp-server-name">Name</label><input autoFocus id="mcp-server-name" class="text-input" required value={draft.name} onInput={event => field('name', event.currentTarget.value)} />
          <label class="field-label" for="mcp-transport">Transport</label><select id="mcp-transport" class="select" value={draft.transport} onChange={event => field('transport', event.currentTarget.value)}><option value="stdio">stdio (local command)</option><option value="http">HTTP</option></select>
          {draft.transport === 'stdio' ? <>
            <label class="field-label" for="mcp-command">Command</label><input id="mcp-command" class="text-input" required value={draft.command} onInput={event => field('command', event.currentTarget.value)} />
            <label class="field-label" for="mcp-args">Arguments (JSON array)</label><textarea id="mcp-args" class="text-input" rows="3" value={draft.args} onInput={event => field('args', event.currentTarget.value)} />
            <label class="field-label" for="mcp-env">Environment variables (JSON object)</label><textarea id="mcp-env" class="text-input" rows="3" spellcheck={false} value={draft.env} onInput={event => field('env', event.currentTarget.value)} />
          </> : <>
            <label class="field-label" for="mcp-url">Server URL</label><input id="mcp-url" class="text-input" type="url" required value={draft.url} onInput={event => field('url', event.currentTarget.value)} />
            <label class="field-label" for="mcp-headers">Headers (JSON object)</label><textarea id="mcp-headers" class="text-input" rows="3" spellcheck={false} value={draft.headers} onInput={event => field('headers', event.currentTarget.value)} />
          </>}
          <label><input type="checkbox" checked={draft.enabled} onChange={event => field('enabled', event.currentTarget.checked)} /> Enabled</label>
        </fieldset>
        <p class="form-error" role="alert">{error}</p>
        <div class="modal-footer"><button type="button" class="secondary-button" disabled={busy} onClick={() => dialog.current.close()}>Cancel</button><button class="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save server'}</button></div>
      </form>}
    </dialog>
  </>;
}
