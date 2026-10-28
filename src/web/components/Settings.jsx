import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';
import Personas from './Personas.jsx';
import McpServers from './McpServers.jsx';

const providerNames = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };
const connected = provider => provider.hasApiKey || provider.oauthConnected;
const modesFor = provider => [provider?.hasApiKey && ['api_key', 'API key'], provider?.oauthConnected && ['oauth', 'ChatGPT sign-in']].filter(Boolean);

export default function Settings({ settings, onReload, onClose, toast }) {
  const closeTimer = useRef(null);
  const [closing, setClosing] = useState(false);
  function requestClose() {
    if (closeTimer.current !== null) return;
    setClosing(true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    closeTimer.current = setTimeout(onClose, reduced ? 0 : 240);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const initial = settings || {};
  const [page, setPage] = useState('providers');
  const [providers, setProviders] = useState(initial.providers || []);
  const [provider, setProvider] = useState(initial.provider || 'openai');
  const [mode, setMode] = useState(initial.mode || 'api_key');
  const [models, setModels] = useState(initial.models || []);
  const [connectedModels, setConnectedModels] = useState(initial.connectedModels || []);
  const [model, setModel] = useState(initial.model || initial.models?.[0]?.id || '');
  const [thinking, setThinking] = useState(initial.thinkingLevel || 'off');
  const [defaultPersonaId, setDefaultPersonaId] = useState(initial.defaultPersonaId || 'sunday');
  const personas = initial.personas || [];
  const [details, setDetails] = useState(initial);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateOutput, setUpdateOutput] = useState('');
  const updatePending = useRef(false);
  const [auth, setAuth] = useState(null);
  const [authTick, setAuthTick] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [code, setCode] = useState('');
  const [mcpConfig, setMcpConfig] = useState({ mcpServers: {} });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpLogin, setMcpLogin] = useState(null);
  const [mcpAuth, setMcpAuth] = useState({});
  useEffect(() => {
    if (page !== 'mcp') return;
    let active = true;
    setMcpAuth({});
    request('/api/mcp/auth').then(data => { if (active) setMcpAuth(data); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [page, mcpConfig, mcpLogin?.status]);
  const [mcpRedirect, setMcpRedirect] = useState('');
  const [mcpLoginBusy, setMcpLoginBusy] = useState(false);
  const backdrop = useRef(null);
  const closeButton = useRef(null);
  const contentViewport = useRef(null);
  const contentLayout = useRef(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const authGeneration = useRef(0);
  const authPending = useRef(false);
  const defaults = useRef(initial);

  useEffect(() => {
    const viewport = contentViewport.current;
    const layout = contentLayout.current;
    const modal = viewport?.parentElement;
    const container = backdrop.current;
    // Without observation, retain natural flex sizing for navigation/async updates.
    if (typeof ResizeObserver !== 'function' || !viewport || !layout || !modal || !container) return;
    const header = modal.querySelector('[data-settings-header]');
    const footer = modal.querySelector('[data-settings-footer]');
    const pixels = value => parseFloat(value) || 0;
    const measure = () => {
      const outer = getComputedStyle(container);
      const frame = getComputedStyle(modal);
      const viewportHeight = Math.min(container.clientHeight, window.visualViewport?.height ?? container.clientHeight);
      const available = viewportHeight - pixels(outer.paddingTop) - pixels(outer.paddingBottom);
      const limit = frame.maxHeight.endsWith('px') ? pixels(frame.maxHeight) : available;
      const chrome = header.offsetHeight + footer.offsetHeight
        + pixels(frame.paddingTop) + pixels(frame.paddingBottom)
        + pixels(frame.borderTopWidth) + pixels(frame.borderBottomWidth);
      // The viewport fills the modal's fixed 80vh height, but remains capped
      // by the visible viewport and the modal's max-height.
      const cap = Math.max(0, Math.min(available, limit, modal.clientHeight) - chrome);
      // A smaller viewport/chrome budget must clamp immediately, including
      // during a height transition, so the footer never slides out of view.
      viewport.style.maxHeight = `${cap}px`;
      viewport.style.flexShrink = '0';
      const height = `${Math.min(layout.offsetHeight, cap)}px`;
      if (viewport.style.height !== height) viewport.style.height = height;
    };
    // Initial natural flex sizing already uses this cap. Lock that same height
    // without animating from auto, then animate only subsequent changes.
    viewport.style.transition = 'none';
    measure();
    void viewport.offsetHeight;
    viewport.style.removeProperty('transition');
    const observer = new ResizeObserver(measure);
    for (const element of [layout, header, footer, container]) observer.observe(element);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      viewport.style.removeProperty('height');
      viewport.style.removeProperty('max-height');
      viewport.style.removeProperty('flex-shrink');
    };
  }, []);

  useEffect(() => {
    if (settings) { defaults.current = settings; setProviders(settings.providers || []); setConnectedModels(settings.connectedModels || []); setDefaultPersonaId(settings.defaultPersonaId || 'sunday'); }
  }, [settings]);

  const available = providers.filter(connected);
  const levels = models.find(item => item.id === model)?.thinkingLevels || ['off'];
  const thinkingLevel = levels.includes(thinking) ? thinking : levels[0];
  const oauthConnected = auth?.status === 'done' || (auth?.status !== 'pending' && details.oauthConnected);

  useEffect(() => {
    alive.current = true;
    closeButton.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...backdrop.current.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
        .filter(element => !element.disabled && element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !backdrop.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !backdrop.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      alive.current = false;
      generation.current++;
      authGeneration.current++;
      document.removeEventListener('keydown', keydown);
    };
  }, [onClose]);

  async function reload() {
    const data = await request('/api/settings');
    if (!alive.current) return data;
    defaults.current = data;
    setProviders(data.providers || []);
    setConnectedModels(data.connectedModels || []);
    await onReload?.();
    return data;
  }

  async function refresh(nextProvider, nextMode) {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    setModels([]);
    setModel('');
    setThinking('off');
    setDetails({});
    try {
      const data = await request(`/api/settings?provider=${encodeURIComponent(nextProvider)}&mode=${encodeURIComponent(nextMode)}`);
      if (!alive.current || current !== generation.current) return null;
      setProviders(data.providers || []);
      setConnectedModels(data.connectedModels || []);
      setDetails(data);
      setModels(data.models || []);
      setModel(data.model || data.models?.[0]?.id || '');
      setThinking(data.thinkingLevel || 'off');
      return data;
    } catch (error) {
      if (alive.current && current === generation.current) setError(error.message);
      return null;
    } finally { if (alive.current && current === generation.current) setLoading(false); }
  }

  async function refreshModels() {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const data = await jsonRequest('/api/settings/models/refresh', 'POST', { provider, mode });
      if (!alive.current || current !== generation.current) return;
      setProviders(data.providers || []);
      setConnectedModels(data.connectedModels || []);
      setDetails(data);
      setModels(data.models || []);
      setModel(data.model || data.models?.[0]?.id || '');
      setThinking(data.thinkingLevel || 'off');
      await onReload?.();
      toast('Model list refreshed.');
    } catch (error) {
      if (alive.current && current === generation.current) setError(error.message);
    } finally {
      if (alive.current && current === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    const current = ++authGeneration.current;
    let timer;
    let active = true;
    setAuth(null);
    if (page !== 'connect' || provider !== 'openai' || mode !== 'oauth') return;
    async function poll() {
      try {
        const data = await request('/api/auth/status');
        if (!active || !alive.current || current !== authGeneration.current) return;
        setAuth(data);
        if (data.status === 'pending') {
          authPending.current = true;
          timer = setTimeout(poll, 1200);
        } else {
          const completed = data.status === 'done' && authPending.current;
          authPending.current = false;
          if (completed) {
            await reload();
            if (active && alive.current && current === authGeneration.current) await refresh(provider, mode);
          }
        }
      } catch (error) {
        if (active && alive.current && current === authGeneration.current) {
          setAuth(previous => ({ ...previous, error: error.message }));
          timer = setTimeout(poll, 1200);
        }
      }
    }
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [page, provider, mode, authTick]);

  function navigate(nextPage) { setPage(nextPage); setError(''); }

  useEffect(() => {
    if (page !== 'mcp') return;
    let active = true;
    setMcpLoading(true); setError('');
    request('/api/mcp').then(data => {
      if (active) setMcpConfig(data);
    }).catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setMcpLoading(false); });
    return () => { active = false; };
  }, [page]);

  useEffect(() => {
    if (page !== 'mcp' || mcpLogin?.status !== 'pending' || !mcpLogin.id) return;
    let active = true;
    let timer;
    async function poll() {
      try {
        const data = await request(`/api/mcp/login/${encodeURIComponent(mcpLogin.id)}`);
        if (!active || !alive.current) return;
        setMcpLogin(data);
        if (data.status === 'pending') timer = setTimeout(poll, 1200);
      } catch (error) {
        if (active && alive.current) { setError(error.message); timer = setTimeout(poll, 1200); }
      }
    }
    timer = setTimeout(poll, 1200);
    return () => { active = false; clearTimeout(timer); };
  }, [page, mcpLogin?.id, mcpLogin?.status]);

  async function mcpLoginAction(url, method, body) {
    if (mcpLoginBusy) return;
    setMcpLoginBusy(true); setError('');
    try {
      const data = method === 'DELETE' ? await request(url, { method }) : await jsonRequest(url, method, body);
      if (alive.current) { setMcpLogin(data?.id ? data : null); setMcpRedirect(''); }
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setMcpLoginBusy(false); }
  }

  async function saveMcp(config) {
    if (mcpSaving || mcpLoading) return false;
    setError('');
    setMcpSaving(true);
    try {
      await jsonRequest('/api/mcp', 'PUT', config);
      setMcpConfig(config);
      toast('MCP settings saved');
      return true;
    } catch (error) { setError(error.message); return false; }
    finally { setMcpSaving(false); }
  }

  function chooseDefaultModel(value) {
    const selected = connectedModels.find(item => `${item.provider}:${item.mode}:${item.id}` === value);
    if (!selected) return;
    const nextModels = connectedModels.filter(item => item.provider === selected.provider && item.mode === selected.mode);
    setProvider(selected.provider);
    setMode(selected.mode);
    setModels(nextModels);
    setModel(selected.id);
    setThinking(selected.thinkingLevels.includes(thinking) ? thinking : selected.thinkingLevels[0]);
  }

  function chooseProvider(nextProvider, nextMode = mode) {
    authGeneration.current++;
    setAuth(null);
    setCode('');
    setApiKey('');
    const authorization = nextProvider === 'openai' ? nextMode : 'api_key';
    setProvider(nextProvider);
    setMode(authorization);
    setAuthTick(value => value + 1);
    refresh(nextProvider, authorization);
  }

  function openConfig() {
    generation.current++;
    setLoading(false);
    navigate('config');
    const selected = connectedModels.find(item => item.provider === defaults.current.provider && item.mode === defaults.current.mode && item.id === defaults.current.model) || connectedModels[0];
    if (!selected) {
      setModels([]); setModel(''); setThinking('off'); setLoading(false);
      return;
    }
    setProvider(selected.provider);
    setMode(selected.mode);
    setModels(connectedModels.filter(item => item.provider === selected.provider && item.mode === selected.mode));
    setModel(selected.id);
    setThinking(selected.thinkingLevels.includes(defaults.current.thinkingLevel) ? defaults.current.thinkingLevel : selected.thinkingLevels[0]);
  }

  async function authAction(url, method = 'POST', body = {}) {
    if (authBusy) return;
    authGeneration.current++;
    setAuthBusy(true);
    setError('');
    try {
      if (method === 'DELETE') await request(url, { method });
      else await jsonRequest(url, method, body);
      if (!alive.current) return;
      if (url === '/api/auth/start') authPending.current = true;
      else if (method === 'DELETE' || url === '/api/auth/cancel') authPending.current = false;
      setCode('');
      if (method === 'DELETE') {
        setDetails(previous => ({ ...previous, oauthConnected: false }));
        setAuth(null);
        await reload();
        if (alive.current) await refresh(provider, mode);
        toast('Account disconnected');
      }
    } catch (error) { if (alive.current) setError(error.message); }
    finally {
      if (alive.current) { setAuthBusy(false); setAuthTick(value => value + 1); }
    }
  }

  async function save() {
    if (saving || loading) return;
    setSaving(true);
    setError('');
    try {
      if (page === 'connect') {
        if (mode === 'api_key') {
          if (apiKey.trim()) await jsonRequest('/api/providers', 'POST', { provider, apiKey: apiKey.trim() });
          else {
            const data = await request(`/api/settings?provider=${encodeURIComponent(provider)}&mode=api_key`);
            if (!data.hasApiKey) throw new Error('Enter an API key to save this connection');
          }
        } else {
          const data = await request('/api/settings?provider=openai&mode=oauth');
          if (!data.oauthConnected) throw new Error('Complete sign-in before saving');
        }
        await reload();
        if (!alive.current) return;
        setApiKey(''); navigate('providers'); toast('Provider connected');
      } else {
        const payload = { provider, mode, defaultPersonaId };
        if (model) { payload.model = model; payload.thinkingLevel = thinkingLevel; }
        await jsonRequest('/api/settings', 'PUT', payload);
        await reload();
        if (alive.current) toast('Settings saved');
      }
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setSaving(false); }
  }

  async function restart() {
    if (updatePending.current || !window.confirm('Install dependencies, build, and restart Sunday? Running agent tasks will be interrupted.')) return;
    updatePending.current = true;
    setUpdating(true); setError(''); setUpdateOutput('Installing dependencies…');
    try {
      const data = await jsonRequest('/api/restart', 'POST', {});
      if (alive.current) setUpdateOutput(data.output);
      await new Promise(resolve => setTimeout(resolve, 4000));
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          const response = await fetch('/api/settings', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
          if (response.ok) { window.location.reload(); return; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('Server did not return. Check the server logs and reload manually.');
    } catch (error) { if (alive.current) setError(error.message); }
    finally { updatePending.current = false; if (alive.current) setUpdating(false); }
  }

  async function update() {
    if (updatePending.current) return;
    updatePending.current = true;
    setUpdating(true); setError(''); setUpdateOutput('');
    try {
      const data = await jsonRequest('/api/update', 'POST', {});
      if (alive.current) { setUpdateOutput(data.output); toast('Update complete'); }
    } catch (error) { if (alive.current) setError(error.message); }
    finally { updatePending.current = false; if (alive.current) setUpdating(false); }
  }

  return <div ref={backdrop} class={`fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 transition-opacity duration-200 ${closing ? 'pointer-events-none opacity-0' : ''}`} id="settings-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <section class="card flex h-[min(80dvh,calc(100dvh-2.5rem))] w-full max-w-6xl flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 text-base-content shadow-xl" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header data-settings-header class="flex shrink-0 items-center justify-between border-b border-base-300 px-5 py-4 sm:px-7"><div><p class="mb-1 text-xs font-bold tracking-widest text-primary">PREFERENCES</p><h2 id="settings-title">Settings</h2></div><button ref={closeButton} class="btn btn-ghost btn-square" id="close-settings" aria-label="Close settings" onClick={requestClose}>×</button></header>
      <div ref={contentViewport} class="min-h-0 flex-1 overflow-hidden transition-[height] duration-200">
      <div ref={contentLayout} class="grid h-full min-h-0 grid-cols-1 gap-5 p-5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-7 sm:p-7">
        <nav class="flex min-h-0 gap-1 overflow-x-auto border-b border-base-300 pb-3 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6" aria-label="Settings sections">
          <button class={`btn btn-ghost w-max sm:w-full shrink-0 justify-start text-left hover:border-transparent${page === 'providers' || page === 'connect' ? ' btn-active' : ''}`} id="settings-providers-nav" onClick={() => navigate('providers')}>Providers</button>
          <button class={`btn btn-ghost w-max sm:w-full shrink-0 justify-start text-left hover:border-transparent${page === 'config' ? ' btn-active' : ''}`} id="settings-config-nav" disabled={saving} onClick={openConfig}>Config</button>
          <button class={`btn btn-ghost w-max sm:w-full shrink-0 justify-start text-left hover:border-transparent${page === 'mcp' ? ' btn-active' : ''}`} id="settings-mcp-nav" onClick={() => navigate('mcp')}>MCP</button>
          <button class={`btn btn-ghost w-max sm:w-full shrink-0 justify-start text-left hover:border-transparent${page === 'personas' ? ' btn-active' : ''}`} id="settings-personas-nav" onClick={() => navigate('personas')}>Personas</button>
          <button class={`btn btn-ghost w-max sm:w-full shrink-0 justify-start text-left hover:border-transparent${page === 'update' ? ' btn-active' : ''}`} id="settings-update-nav" onClick={() => navigate('update')}>Update</button>
        </nav>
        <div class="min-h-0 min-w-0 overflow-y-auto">
          <section inert={page !== 'providers'} id="settings-provider-page" class={page === 'providers' ? '' : 'hidden'}>
            <div class="mb-4 flex flex-wrap items-center justify-between gap-4"><h3>Connected providers</h3><div class="flex flex-wrap items-center justify-end gap-2"><button class="btn btn-ghost border-0 bg-black/20 hover:bg-black/30" id="refresh-models" type="button" disabled={saving || loading} onClick={refreshModels} aria-label="Refresh available models" title="Fetch models from Sunday’s current provider catalog. Update Sunday if a newly released model is missing.">{loading ? 'Refreshing…' : '↻ Refresh models'}</button><button class="btn btn-ghost border-0 bg-black/20 hover:bg-black/30" id="add-provider" disabled={saving} onClick={() => { setApiKey(''); navigate('connect'); refresh(provider, mode); }}>＋ Add provider</button></div></div>
            <p class="text-sm text-base-content/70">Manage the providers you have connected.</p>
            <div id="provider-list" class="my-5 grid gap-3">
              {available.map(item => <button key={item.id} type="button" class="card card-border w-full gap-2 border-base-300 bg-black/10 p-4 text-left transition-colors hover:bg-black/20 aria-pressed:border-primary" data-provider={item.id} aria-pressed={provider === item.id} disabled={saving} onClick={() => { chooseProvider(item.id); navigate('connect'); }}>
                <strong>{item.name || item.id}</strong><span class="badge badge-success badge-soft">Connected</span><small>{[item.hasApiKey ? 'API key saved' : '', item.oauthConnected ? 'ChatGPT signed in' : ''].filter(Boolean).join(' · ')}</small>
              </button>)}
              {!available.length && <p class="text-sm text-base-content/70">No providers connected yet. Add a provider to start chatting.</p>}
            </div>
          </section>
          <section inert={page !== 'connect'} id="settings-connect-page" class={page === 'connect' ? '' : 'hidden'}>
            <button class="btn btn-ghost" id="provider-back" onClick={() => navigate('providers')}>← Providers</button><h3>Connect provider</h3>
            <div class="my-4 grid gap-2"><label class="label font-semibold" for="provider">Provider</label>
            <select id="provider" class="select select-bordered w-full" value={provider} disabled={saving || authBusy} onChange={event => chooseProvider(event.currentTarget.value)}>
              {Object.entries(providerNames).map(([id, name]) => <option key={id} value={id}>{providers.find(item => item.id === id)?.name || name}</option>)}
            </select></div>
            <div class="my-4 grid gap-2"><label class="label font-semibold" for="mode">Connect with</label>
            <select id="mode" class="select select-bordered w-full" value={mode} disabled={saving || authBusy} onChange={event => chooseProvider(provider, event.currentTarget.value)}><option value="api_key">API key</option><option value="oauth" disabled={provider !== 'openai'}>Sign in with ChatGPT</option></select></div>
            <div id="api-panel" class={`mt-4 space-y-3${mode === 'oauth' ? ' hidden' : ''}`}>
              <label class="label font-semibold" for="api-key">API key</label><input id="api-key" class="input input-bordered w-full" type="password" autoComplete="off" value={apiKey} disabled={saving} placeholder={details.hasApiKey ? 'Key saved — leave blank to keep it' : 'Provider API key'} onInput={event => setApiKey(event.currentTarget.value)} />
              <p class="text-sm text-base-content/70">Leave blank to keep your saved key. Your key is stored by Sunday and never in your browser.</p>
            </div>
            <div id="oauth-panel" class={`mt-4 space-y-3${mode === 'oauth' ? '' : ' hidden'}`}>
              <p class="text-sm text-base-content/70">Start sign-in, then open the sign-in link below in your browser. If needed, paste the final redirect URL to finish.</p>
              <div class="text-sm text-base-content/70" id="oauth-state">{auth?.error || (auth?.status === 'pending' ? 'Waiting for sign-in…' : auth?.status === 'error' ? 'Sign-in failed' : oauthConnected ? 'Connected to OpenAI' : 'Not connected')}</div>
              <button class={`btn btn-outline${oauthConnected ? ' hidden' : ''}`} id="oauth-connect" disabled={authBusy} onClick={() => authAction('/api/auth/start')}>Sign in with ChatGPT</button>
              <div id="oauth-events" class="mt-3 space-y-2 break-words text-sm" aria-live="polite">{(auth?.events || []).map((event, index) => <p key={index}>{event.message || event.instructions || ''}{event.url && <> <a href={event.url} target="_blank" rel="noopener">Open OpenAI sign-in ↗</a></>}</p>)}</div>
              <div id="code-entry" class={`mt-4${auth?.prompt ? '' : ' hidden'}`}><label class="label font-semibold" for="auth-code">Final redirect URL</label><div class="flex flex-wrap gap-2 [&>input]:min-w-0 [&>input]:flex-1"><input id="auth-code" class="input input-bordered w-full" autoComplete="one-time-code" placeholder={auth?.prompt?.placeholder || 'Paste the final browser redirect URL'} value={code} disabled={authBusy} onInput={event => setCode(event.currentTarget.value)} /><button class="btn btn-outline" id="submit-code" disabled={authBusy} onClick={() => authAction('/api/auth/code', 'POST', { code })}>Submit</button></div></div>
              <button class={`btn btn-ghost${oauthConnected ? '' : ' hidden'}`} id="oauth-disconnect" disabled={authBusy} onClick={() => authAction('/api/auth', 'DELETE')}>Disconnect account</button>
              <button class={`btn btn-ghost${auth?.status === 'pending' ? '' : ' hidden'}`} id="oauth-cancel" disabled={authBusy} onClick={() => authAction('/api/auth/cancel')}>Cancel sign-in</button>
            </div>
          </section>
          <section inert={page !== 'config'} id="settings-config-page" class={page === 'config' ? '' : 'hidden'}><h3>Chat defaults</h3>
            <p class="text-sm text-base-content/70">These defaults apply only to new sessions. Existing sessions keep their own model, thinking level, and persona.</p>
            <div class="my-4 grid gap-2"><label class="label font-semibold" for="model">Default model</label><select id="model" class="select select-bordered w-full bg-black/10 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" value={`${provider}:${mode}:${model}`} disabled={loading || saving || !connectedModels.length} onChange={event => chooseDefaultModel(event.currentTarget.value)}>{connectedModels.length ? connectedModels.map(item => <option key={`${item.provider}:${item.mode}:${item.id}`} value={`${item.provider}:${item.mode}:${item.id}`}>{item.name || item.id} · {item.providerName}{item.mode === 'oauth' ? ' (ChatGPT)' : ''}</option>) : <option value="">Connect a provider to see models</option>}</select></div>
            <div class="my-4 grid gap-2"><label class="label font-semibold" for="settings-thinking-level">Default thinking level</label><select id="settings-thinking-level" class="select select-bordered w-full bg-black/10 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" value={thinkingLevel} disabled={loading || saving || levels.length === 1} title={levels.length === 1 && levels[0] === 'off' ? 'This model does not support thinking' : 'Reasoning effort'} onChange={event => setThinking(event.currentTarget.value)}>{levels.map(level => <option key={level} value={level}>{level === 'xhigh' ? 'Extra high' : level[0].toUpperCase() + level.slice(1)}</option>)}</select></div>
            <div class="my-4 grid gap-2"><label class="label font-semibold" for="default-persona">Default persona</label><select id="default-persona" class="select select-bordered w-full bg-black/10 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" value={defaultPersonaId} disabled={saving} onChange={event => setDefaultPersonaId(event.currentTarget.value)}>{personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></div>
            <button class="btn btn-primary mt-2" id="save-chat-defaults" disabled={saving || loading} onClick={save}>{saving ? 'Saving…' : 'Save chat defaults'}</button>
          </section>
          <section inert={page !== 'mcp'} id="settings-mcp-page" class={page === 'mcp' ? '' : 'hidden'}>
            {mcpLoading ? <p role="status">Loading MCP settings…</p> : <McpServers config={mcpConfig} auth={mcpAuth} busy={mcpSaving} onSave={saveMcp} loginBusy={mcpLoginBusy || mcpLogin?.status === 'pending'} onLogin={name => mcpLoginAction('/api/mcp/login', 'POST', { server: name })} />}
            {mcpLogin && <div class="alert alert-info mt-4 flex-col items-start" aria-live="polite"><p>{mcpLogin.error || `Sign-in ${mcpLogin.status}`}</p>{mcpLogin.url && <p><a href={mcpLogin.url} target="_blank" rel="noopener">Open sign-in ↗</a></p>}{mcpLogin.status === 'pending' && <><label class="label font-semibold" for="mcp-redirect-url">Redirect URL</label><input id="mcp-redirect-url" class="input input-bordered w-full" value={mcpRedirect} onInput={event => setMcpRedirect(event.currentTarget.value)} /><button class="btn btn-outline" disabled={mcpLoginBusy || !mcpRedirect} onClick={() => mcpLoginAction(`/api/mcp/login/${encodeURIComponent(mcpLogin.id)}`, 'POST', { redirectUrl: mcpRedirect })}>Finish sign-in</button><button class="btn btn-ghost" disabled={mcpLoginBusy} onClick={() => mcpLoginAction(`/api/mcp/login/${encodeURIComponent(mcpLogin.id)}`, 'DELETE')}>Cancel sign-in</button></>}</div>}
          </section>
          <section inert={page !== 'update'} id="settings-update-page" class={page === 'update' ? '' : 'hidden'}>
            <h3>Update Sunday</h3>
            <p class="text-sm text-base-content/70">Pull the latest changes with git pull. This does not install dependencies, build, or restart Sunday.</p>
            <div class="flex flex-wrap gap-2"><button class="btn btn-ghost border-0" id="update-app" disabled={updating} onClick={update}>{updating ? 'Updating…' : 'Update'}</button>
            <button class="btn btn-ghost border-0" id="restart-app" disabled={updating} onClick={restart}>Restart app</button></div>
            <p class="text-sm text-base-content/70">Runs npm install, builds, and restarts the server, interrupting running tasks. The page reloads when ready.</p>
            <pre id="update-output" class="whitespace-pre-wrap break-words" role="status">{updateOutput}</pre>
          </section>
          <Personas hidden={page !== 'personas'} toast={toast} onReload={onReload} />
          <p class="alert alert-error empty:hidden py-2" id="settings-error" role="alert">{error}</p>
        </div>
      </div>
      </div>
      <footer data-settings-footer class="flex shrink-0 justify-end gap-2 border-t border-base-300 px-5 py-4 sm:px-7"><button class="btn btn-outline" id="cancel-settings" onClick={requestClose}>Close</button><button class={`btn btn-primary${page === 'providers' || page === 'config' || page === 'personas' || page === 'update' || page === 'mcp' ? ' hidden' : ''}`} id="save-settings" disabled={saving || loading || authBusy || (page === 'config' && !connectedModels.length)} onClick={save}>{page === 'connect' ? 'Save connection' : 'Save defaults'}</button></footer>
    </section>
  </div>;
}
