import { useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from '../api.js';
import Personas from './Personas.jsx';

const providerNames = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };
const connected = provider => provider.hasApiKey || provider.oauthConnected;
const modesFor = provider => [provider?.hasApiKey && ['api_key', 'API key'], provider?.oauthConnected && ['oauth', 'ChatGPT sign-in']].filter(Boolean);

export default function Settings({ settings, onReload, onClose, toast }) {
  const initial = settings || {};
  const [page, setPage] = useState('providers');
  const [providers, setProviders] = useState(initial.providers || []);
  const [provider, setProvider] = useState(initial.provider || 'openai');
  const [mode, setMode] = useState(initial.mode || 'api_key');
  const [models, setModels] = useState(initial.models || []);
  const [model, setModel] = useState(initial.model || initial.models?.[0]?.id || '');
  const [thinking, setThinking] = useState(initial.thinkingLevel || 'off');
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
    const header = modal.querySelector('.modal-header');
    const footer = modal.querySelector('.modal-footer');
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
      const height = `${Math.min(layout.offsetHeight, cap)}px`;
      if (viewport.style.height !== height) viewport.style.height = height;
    };
    // Initial natural flex sizing already uses this cap. Lock that same height
    // without animating from auto, then animate only subsequent changes.
    viewport.style.transition = 'none';
    measure();
    viewport.dataset.sized = '';
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
      delete viewport.dataset.sized;
    };
  }, []);

  useEffect(() => {
    if (settings) { defaults.current = settings; setProviders(settings.providers || []); }
  }, [settings]);

  const available = providers.filter(connected);
  const configModes = modesFor(providers.find(item => item.id === provider));
  const levels = models.find(item => item.id === model)?.thinkingLevels || ['off'];
  const thinkingLevel = levels.includes(thinking) ? thinking : levels[0];
  const oauthConnected = auth?.status === 'done' || (auth?.status !== 'pending' && details.oauthConnected);

  useEffect(() => {
    alive.current = true;
    closeButton.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
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
      if (!alive.current || current !== generation.current) return;
      setProviders(data.providers || []);
      setDetails(data);
      setModels(data.models || []);
      setModel(data.model || data.models?.[0]?.id || '');
      setThinking(data.thinkingLevel || 'off');
    } catch (error) { if (alive.current && current === generation.current) setError(error.message); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
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
    navigate('config');
    const nextProvider = available.find(item => item.id === defaults.current.provider) || available[0];
    if (!nextProvider) {
      generation.current++;
      setModels([]); setModel(''); setThinking('off'); setLoading(false);
      return;
    }
    const modes = modesFor(nextProvider);
    chooseProvider(nextProvider.id, modes.some(([value]) => value === defaults.current.mode) ? defaults.current.mode : modes[0][0]);
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
        const payload = { provider, mode };
        if (model) { payload.model = model; payload.thinkingLevel = thinkingLevel; }
        await jsonRequest('/api/settings', 'PUT', payload);
        await reload();
        if (alive.current) { onClose(); toast('Settings saved'); }
      }
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setSaving(false); }
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

  return <div ref={backdrop} class="modal-backdrop" id="settings-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="modal-header"><div><p class="eyebrow">PREFERENCES</p><h2 id="settings-title">Settings</h2></div><button ref={closeButton} class="icon-button close-modal" id="close-settings" aria-label="Close settings" onClick={onClose}>×</button></header>
      <div ref={contentViewport} class="settings-content">
      <div ref={contentLayout} class="modal-content settings-layout">
        <nav class="settings-providers" aria-label="Settings sections">
          <button class={`settings-nav${page === 'providers' || page === 'connect' ? ' active' : ''}`} id="settings-providers-nav" onClick={() => navigate('providers')}>Providers</button>
          <button class={`settings-nav${page === 'config' ? ' active' : ''}`} id="settings-config-nav" disabled={saving} onClick={openConfig}>Config</button>
          <button class={`settings-nav${page === 'personas' ? ' active' : ''}`} id="settings-personas-nav" onClick={() => navigate('personas')}>Personas</button>
          <button class={`settings-nav${page === 'update' ? ' active' : ''}`} id="settings-update-nav" onClick={() => navigate('update')}>Update</button>
        </nav>
        <div class="settings-detail">
          <section id="settings-provider-page" class={page === 'providers' ? '' : 'hidden'}>
            <div class="settings-page-heading"><h3>Connected providers</h3><button class="secondary-button" id="add-provider" disabled={saving} onClick={() => { setApiKey(''); navigate('connect'); refresh(provider, mode); }}>＋ Add provider</button></div>
            <p class="field-note">Manage the providers you have connected.</p>
            <div id="provider-list" class="provider-list">
              {available.map(item => <button key={item.id} type="button" class="provider-card" data-provider={item.id} aria-pressed={provider === item.id} disabled={saving} onClick={() => { chooseProvider(item.id); navigate('connect'); }}>
                <strong>{item.name || item.id}</strong><span class="provider-status connected">Connected</span><small>{[item.hasApiKey ? 'API key saved' : '', item.oauthConnected ? 'ChatGPT signed in' : ''].filter(Boolean).join(' · ')}</small>
              </button>)}
              {!available.length && <p class="field-note">No providers connected yet. Add a provider to start chatting.</p>}
            </div>
          </section>
          <section id="settings-connect-page" class={`settings-section${page === 'connect' ? '' : ' hidden'}`}>
            <button class="text-button" id="provider-back" onClick={() => navigate('providers')}>← Providers</button><h3>Connect provider</h3>
            <label class="field-label" for="provider">Provider</label>
            <select id="provider" class="select" value={provider} disabled={saving || authBusy} onChange={event => chooseProvider(event.currentTarget.value)}>
              {Object.entries(providerNames).map(([id, name]) => <option key={id} value={id}>{providers.find(item => item.id === id)?.name || name}</option>)}
            </select>
            <label class="field-label" for="mode">Connect with</label>
            <select id="mode" class="select" value={mode} disabled={saving || authBusy} onChange={event => chooseProvider(provider, event.currentTarget.value)}><option value="api_key">API key</option><option value="oauth" disabled={provider !== 'openai'}>Sign in with ChatGPT</option></select>
            <div id="api-panel" class={`mode-panel${mode === 'oauth' ? ' hidden' : ''}`}>
              <label class="field-label" for="api-key">API key</label><input id="api-key" class="text-input" type="password" autoComplete="off" value={apiKey} disabled={saving} placeholder={details.hasApiKey ? 'Key saved — leave blank to keep it' : 'Provider API key'} onInput={event => setApiKey(event.currentTarget.value)} />
              <p class="field-note">Leave blank to keep your saved key. Your key is stored by Sunday and never in your browser.</p>
            </div>
            <div id="oauth-panel" class={`mode-panel${mode === 'oauth' ? '' : ' hidden'}`}>
              <p class="field-note">Start sign-in, then open the sign-in link below in your browser. If needed, paste the final redirect URL to finish.</p>
              <div class="oauth-state" id="oauth-state">{auth?.error || (auth?.status === 'pending' ? 'Waiting for sign-in…' : auth?.status === 'error' ? 'Sign-in failed' : oauthConnected ? 'Connected to OpenAI' : 'Not connected')}</div>
              <button class={`secondary-button${oauthConnected ? ' hidden' : ''}`} id="oauth-connect" disabled={authBusy} onClick={() => authAction('/api/auth/start')}>Sign in with ChatGPT</button>
              <div id="oauth-events" class="oauth-events" aria-live="polite">{(auth?.events || []).map((event, index) => <p key={index}>{event.message || event.instructions || ''}{event.url && <> <a href={event.url} target="_blank" rel="noopener">Open OpenAI sign-in ↗</a></>}</p>)}</div>
              <div id="code-entry" class={`code-entry${auth?.prompt ? '' : ' hidden'}`}><label class="field-label" for="auth-code">Final redirect URL</label><div class="code-row"><input id="auth-code" class="text-input" autoComplete="one-time-code" placeholder={auth?.prompt?.placeholder || 'Paste the final browser redirect URL'} value={code} disabled={authBusy} onInput={event => setCode(event.currentTarget.value)} /><button class="secondary-button" id="submit-code" disabled={authBusy} onClick={() => authAction('/api/auth/code', 'POST', { code })}>Submit</button></div></div>
              <button class={`text-button${oauthConnected ? '' : ' hidden'}`} id="oauth-disconnect" disabled={authBusy} onClick={() => authAction('/api/auth', 'DELETE')}>Disconnect account</button>
              <button class={`text-button${auth?.status === 'pending' ? '' : ' hidden'}`} id="oauth-cancel" disabled={authBusy} onClick={() => authAction('/api/auth/cancel')}>Cancel sign-in</button>
            </div>
          </section>
          <section id="settings-config-page" class={`settings-section${page === 'config' ? '' : ' hidden'}`}><h3>Chat defaults</h3>
            <label class="field-label" for="config-provider">Connected provider</label><select id="config-provider" class="select" value={available.length ? provider : ''} disabled={saving || !available.length} onChange={event => { const id = event.currentTarget.value; const modes = modesFor(providers.find(item => item.id === id)); chooseProvider(id, modes.some(([value]) => value === defaults.current.mode) ? defaults.current.mode : modes[0][0]); }}>{available.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select>
            <label class="field-label" for="config-mode">Authorization</label><select id="config-mode" class="select" value={mode} disabled={saving || !available.length} onChange={event => chooseProvider(provider, event.currentTarget.value)}>{configModes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <label class="field-label model-field" for="model">Default model</label><select id="model" class="select" value={model} disabled={loading || saving || !models.length} onChange={event => setModel(event.currentTarget.value)}>{models.length ? models.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>) : <option value="">Connect a provider to see models</option>}</select>
            <label class="field-label model-field" for="settings-thinking-level">Default thinking level</label><select id="settings-thinking-level" class="select" value={thinkingLevel} disabled={loading || saving || levels.length === 1} title={levels.length === 1 && levels[0] === 'off' ? 'This model does not support thinking' : 'Reasoning effort'} onChange={event => setThinking(event.currentTarget.value)}>{levels.map(level => <option key={level} value={level}>{level === 'xhigh' ? 'Extra high' : level[0].toUpperCase() + level.slice(1)}</option>)}</select>
            <p class="field-note">Only connected providers have available models. Save an API key first, then choose a default model. These defaults apply only to new sessions. Existing sessions keep their own model and thinking level.</p>
          </section>
          <section id="settings-update-page" class={`settings-section${page === 'update' ? '' : ' hidden'}`}>
            <h3>Update Sunday</h3>
            <p class="field-note">Pull the latest changes with git pull. This does not install dependencies, build, or restart Sunday.</p>
            <button class="secondary-button" id="update-app" disabled={updating} onClick={update}>{updating ? 'Updating…' : 'Update'}</button>
            <pre id="update-output" role="status" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{updateOutput}</pre>
          </section>
          <Personas hidden={page !== 'personas'} toast={toast} onReload={onReload} />
          <p class="form-error" id="settings-error" role="alert">{error}</p>
        </div>
      </div>
      </div>
      <footer class="modal-footer"><button class="secondary-button" id="cancel-settings" onClick={onClose}>Close</button><button class={`primary-button${page === 'providers' || page === 'personas' || page === 'update' ? ' hidden' : ''}`} id="save-settings" disabled={saving || loading || authBusy || (page === 'config' && !available.length)} onClick={save}>{page === 'connect' ? 'Save connection' : 'Save defaults'}</button></footer>
    </section>
  </div>;
}
