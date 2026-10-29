import { useEffect, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';
import McpServers from './McpServers.jsx';

export default function McpPage({ toast }) {
  const [config, setConfig] = useState({ mcpServers: {} });
  const [auth, setAuth] = useState({});
  const [login, setLogin] = useState(null);
  const [redirectUrl, setRedirectUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    request('/api/mcp').then(data => { if (active) setConfig(data); })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading) return;
    let active = true;
    setAuth({});
    request('/api/mcp/auth').then(data => { if (active) setAuth(data); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [loading, config, login?.status]);

  useEffect(() => {
    if (login?.status !== 'pending' || !login.id) return;
    let active = true;
    let timer;
    async function poll() {
      try {
        const data = await request(`/api/mcp/login/${encodeURIComponent(login.id)}`);
        if (!active) return;
        setLogin(data);
        if (data.status === 'pending') timer = setTimeout(poll, 1200);
      } catch (error) {
        if (active) { setError(error.message); timer = setTimeout(poll, 1200); }
      }
    }
    timer = setTimeout(poll, 1200);
    return () => { active = false; clearTimeout(timer); };
  }, [login?.id, login?.status]);

  async function loginAction(url, method, body) {
    if (loginBusy) return;
    setLoginBusy(true); setError('');
    try {
      const data = method === 'DELETE' ? await request(url, { method }) : await jsonRequest(url, method, body);
      setLogin(data?.id ? data : null); setRedirectUrl('');
    } catch (error) { setError(error.message); }
    finally { setLoginBusy(false); }
  }

  async function save(config) {
    if (saving || loading) return false;
    setError(''); setSaving(true);
    try {
      await jsonRequest('/api/mcp', 'PUT', config);
      setConfig(config);
      toast('MCP settings saved');
      return true;
    } catch (error) { setError(error.message); return false; }
    finally { setSaving(false); }
  }

  return <section class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-6 sm:py-12" aria-labelledby="mcp-title">
    <header class="mb-6 flex-none"><p class="text-xs font-bold tracking-widest text-primary">INTEGRATIONS</p><h1 id="mcp-title" tabIndex="-1">MCP servers</h1><p class="text-sm text-base-content/70">Connect external tools and services to your agents.</p></header>
    {error && <p class="alert alert-error mb-4" role="alert">{error}</p>}
    {loading ? <p role="status">Loading MCP settings…</p> : <McpServers config={config} auth={auth} busy={saving} onSave={save} loginBusy={loginBusy || login?.status === 'pending'} onLogin={name => loginAction('/api/mcp/login', 'POST', { server: name })} />}
    {login && <div class="alert alert-info mt-4 flex-col items-start" aria-live="polite"><p>{login.error || `Sign-in ${login.status}`}</p>{login.url && <p><a href={login.url} target="_blank" rel="noopener">Open sign-in ↗</a></p>}{login.status === 'pending' && <><label class="label font-semibold" for="mcp-redirect-url">Redirect URL</label><input id="mcp-redirect-url" class="input input-bordered w-full" value={redirectUrl} onInput={event => setRedirectUrl(event.currentTarget.value)} /><button class="btn btn-outline" disabled={loginBusy || !redirectUrl} onClick={() => loginAction(`/api/mcp/login/${encodeURIComponent(login.id)}`, 'POST', { redirectUrl })}>Finish sign-in</button><button class="btn btn-ghost" disabled={loginBusy} onClick={() => loginAction(`/api/mcp/login/${encodeURIComponent(login.id)}`, 'DELETE')}>Cancel sign-in</button></>}</div>}
  </section>;
}
