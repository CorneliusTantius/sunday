import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from './api.js';
import Character from './components/Character.jsx';
import Repositories from './components/Repositories.jsx';
import { lazy, Suspense } from 'preact/compat';
import SessionConfig from './components/SessionConfig.jsx';
import Settings from './components/Settings.jsx';
import MessageBubble from './components/MessageBubble.js';
import ToolCalls from './components/ToolCalls.jsx';

const CodeEditor = lazy(() => import('./components/CodeEditor.jsx'));
function currentPage() {
  return ['#files', '#editor'].includes(location.hash) ? 'editor' : location.hash === '#repositories' ? 'repositories' : 'chat';
}

function formatTokens(value) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value);
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Good night.' : hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : hour < 22 ? 'Good evening.' : 'Good night.';
}
function trapFocus(event, container) {
  if (event.key !== 'Tab') return;
  const controls = [...container.querySelectorAll('a[href], button, input, select, textarea')].filter(element => !element.disabled && element.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [pinnedAgentIds, setPinnedAgentIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sunday-pinned-agent-ids') || '[]');
      return Array.isArray(saved) ? [...new Set(saved.filter(id => typeof id === 'string'))].slice(0, 3) : [];
    } catch { return []; }
  });
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [contextUsage, setContextUsage] = useState(null);
  const [ready, setReady] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeRunning, setActiveRunning] = useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [page, setPage] = useState(currentPage);
  const editorDirty = useRef(false);
  const editorSaving = useRef(false);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches);
  const [sidebarOpen, setSidebarOpen] = useState(() => !matchMedia('(max-width: 700px)').matches);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configuredSession, setConfiguredSession] = useState(null);
  const [greetingText, setGreetingText] = useState(greeting);
  const [toastText, setToastText] = useState('');
  const controller = useRef(null);
  const sessionLock = useRef(false);
  const sessionsGeneration = useRef(0);
  const activeSession = useRef(null);
  const toastTimer = useRef(null);
  const promptInput = useRef(null);
  const sidebar = useRef(null);
  const menu = useRef(null);
  const collapseButton = useRef(null);
  const settingsButton = useRef(null);
  const shell = useRef(null);
  const messageList = useRef(null);
  const configOpener = useRef(null);
  const firstPage = useRef(true);

  const toast = useCallback(text => {
    clearTimeout(toastTimer.current); setToastText(text);
    toastTimer.current = setTimeout(() => setToastText(''), 2800);
  }, []);
  const loadSettings = useCallback(async () => {
    try { const data = await request('/api/settings'); setSettings(data); setSettingsError(false); return data; }
    catch { setSettingsError(true); }
  }, []);
  const loadSessions = useCallback(async () => {
    const generation = ++sessionsGeneration.current;
    try {
      const data = await request('/api/sessions');
      if (generation === sessionsGeneration.current) { setSessions(data.sessions || []); setSessionsLoaded(true); }
      return data.sessions || [];
    } catch (error) { if (generation === sessionsGeneration.current) toast(`Could not load chats: ${error.message}`); return []; }
  }, [toast]);

  function selectSession(session) {
    activeSession.current = session.id; setSessionId(session.id); setActiveRunning(Boolean(session.running));
    localStorage.setItem('sunday-session-id', session.id);
    const nextMessages = (session.messages || []).filter(message => ['user', 'assistant'].includes(message.role));
    if (session.running && nextMessages.at(-1)?.role === 'user') nextMessages.push({ role: 'assistant', content: '', toolCalls: [] });
    setMessages(nextMessages);
    setContextUsage(session.contextUsage || null);
    setPrompt(''); setReady(true);
  }
  function navigateChat(navigate) {
    if (navigate) location.hash = 'chat';
    if (mobile) setSidebarOpen(false);
  }
  function detachResponse() {
    const active = controller.current;
    if (!active) return;
    controller.current = null;
    active.abort();
    setBusy(false);
  }
  async function createSession(navigate = true) {
    if (sessionLock.current) return;
    detachResponse();
    sessionLock.current = true; setLoadingSession(true); setReady(false);
    try {
      const data = await jsonRequest('/api/sessions', 'POST', {});
      if (!data.session?.id) throw new Error('Invalid session response');
      selectSession(data.session); await loadSessions(); navigateChat(navigate);
    } catch (error) { setReady(!!activeSession.current); toast(`Could not start chat: ${error.message}`); }
    finally { sessionLock.current = false; setLoadingSession(false); }
    promptInput.current?.focus();
  }
  async function openSession(id, navigate = true) {
    if (sessionLock.current || id === activeSession.current) return;
    detachResponse();
    sessionLock.current = true; setLoadingSession(true); setReady(false);
    let resumeIndex = null;
    try {
      const data = await request(`/api/sessions/${encodeURIComponent(id)}`);
      if (!data.session) throw new Error('Session not found');
      selectSession(data.session); navigateChat(navigate);
      if (data.session.running) resumeIndex = (data.session.messages || []).filter(message => ['user', 'assistant'].includes(message.role)).length;
    } catch (error) { setReady(!!activeSession.current); toast(`Could not open chat: ${error.message}`); }
    finally { sessionLock.current = false; setLoadingSession(false); }
    if (resumeIndex !== null) void resumeChat(id, resumeIndex);
  }
  async function deleteSession(session) {
    if (controller.current || sessionLock.current || !window.confirm(`Delete “${session.title}”? This cannot be undone.`)) return;
    sessionLock.current = true; setLoadingSession(true);
    let remaining = [];
    try {
      await request(`/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      if (session.id === activeSession.current) {
        activeSession.current = null; setSessionId(null); setReady(false); setMessages([]); localStorage.removeItem('sunday-session-id');
      }
      remaining = await loadSessions();
    } catch (error) { toast(error.message); }
    finally { sessionLock.current = false; setLoadingSession(false); }
    if (!activeSession.current) { if (remaining.length) await openSession(remaining[0].id, false); else await createSession(false); }
  }
  function togglePinnedAgent(session) {
    if (pinnedAgentIds.includes(session.id)) setPinnedAgentIds(pinnedAgentIds.filter(id => id !== session.id));
    else if (pinnedAgentIds.length >= 3) toast('You can pin up to 3 agents. Unpin one first.');
    else setPinnedAgentIds([...pinnedAgentIds, session.id]);
  }

  useEffect(() => { localStorage.setItem('sunday-pinned-agent-ids', JSON.stringify(pinnedAgentIds)); }, [pinnedAgentIds]);
  useEffect(() => {
    if (!sessionsLoaded) return;
    const available = new Set(sessions.map(session => session.id));
    setPinnedAgentIds(previous => {
      const next = previous.filter(id => available.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [sessions, sessionsLoaded]);
  useEffect(() => {
    loadSettings();
    (async () => {
      const items = await loadSessions();
      const saved = localStorage.getItem('sunday-session-id');
      if (saved && items.some(session => session.id === saved)) await openSession(saved, false);
      else await createSession(false);
    })();
    const timer = setInterval(() => setGreetingText(greeting()), 60_000);
    const visibility = () => { if (!document.hidden) setGreetingText(greeting()); };
    const route = () => {
      const next = currentPage();
      if (next !== 'editor' && editorSaving.current) {
        window.alert('Wait for the file to finish saving before leaving.');
        history.replaceState(null, '', '#files');
        return;
      }
      if (next !== 'editor' && editorDirty.current && !window.confirm('Discard unsaved changes?')) {
        history.replaceState(null, '', '#files');
        return;
      }
      if (next !== 'editor') editorDirty.current = false;
      setPage(next);
    };
    const layout = matchMedia('(max-width: 700px)');
    const resize = () => { setMobile(layout.matches); setSidebarOpen(!layout.matches); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('hashchange', route); layout.addEventListener('change', resize);
    return () => { clearInterval(timer); clearTimeout(toastTimer.current); controller.current?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('hashchange', route); layout.removeEventListener('change', resize); };
  }, []);
  useEffect(() => {
    document.title = `Sunday — ${page === 'editor' ? 'Files' : page === 'repositories' ? 'Repositories' : 'Chat'}`;
    if (mobile) setSidebarOpen(false);
    if (firstPage.current) { firstPage.current = false; return; }
    if (page === 'editor') shell.current?.querySelector('#code-editor-title')?.focus();
    else if (page === 'repositories') shell.current?.querySelector('#repositories-title')?.focus();
    else promptInput.current?.focus();
  }, [page]);
  useEffect(() => {
    if (sidebar.current) sidebar.current.inert = !sidebarOpen || settingsOpen;
    if (shell.current) shell.current.inert = settingsOpen;
  }, [sidebarOpen, settingsOpen]);
  useEffect(() => {
    if (!mobile || !sidebarOpen || settingsOpen || configuredSession) return;
    collapseButton.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { setSidebarOpen(false); menu.current?.focus(); }
      else trapFocus(event, sidebar.current);
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [mobile, sidebarOpen, settingsOpen, configuredSession]);
  useEffect(() => {
    const input = promptInput.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
  }, [prompt]);
  useEffect(() => { messageList.current?.lastElementChild?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' }); }, [messages.length]);
  useEffect(() => { if (!busy && ready && !activeRunning) promptInput.current?.focus(); }, [busy, ready, activeRunning]);
  useEffect(() => {
    if (!activeRunning || busy || !sessionId) return;
    const id = sessionId;
    const timer = setInterval(async () => {
      try {
        const data = await request(`/api/sessions/${encodeURIComponent(id)}`);
        if (activeSession.current !== id || !data.session) return;
        if (data.session.running) {
          const index = (data.session.messages || []).filter(message => ['user', 'assistant'].includes(message.role)).length;
          if (!controller.current) void resumeChat(id, index);
          return;
        }
        selectSession(data.session);
        await loadSessions();
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [activeRunning, busy, sessionId, loadSessions]);
  useEffect(() => {
    if (!sessions.some(session => session.running)) return;
    const timer = setInterval(() => loadSessions(), 5000);
    return () => clearInterval(timer);
  }, [sessions.some(session => session.running), loadSessions]);

  async function stopResponse() {
    const active = controller.current;
    if (!active) return;
    try { await jsonRequest('/api/chat/cancel', 'POST', { sessionId: activeSession.current }); } catch {}
    active.abort();
  }

  async function readChatStream(response, sessionId, abort, index) {
    if (!response.body) throw new Error('Streaming is unavailable.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', content = '', serverError = '', finished = false;
    function updateMessages(update) { if (controller.current === abort && activeSession.current === sessionId) setMessages(update); }
    function updateAnswer(error = false) { updateMessages(previous => previous.map((message, position) => position === index ? { ...message, content, error } : message)); }
    function consume(line) {
      if (!line.startsWith('data:')) return;
      const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') return;
      let data;
      try { data = JSON.parse(raw); } catch (error) { if (error instanceof SyntaxError) return; throw error; }
      if (data.type === 'snapshot') {
        content = data.answer || '';
        if (data.error) serverError = data.error;
        updateMessages(previous => previous.map((message, position) => position === index ? { ...message, content, toolCalls: data.toolCalls || [] } : message));
        if (data.contextUsage && activeSession.current === sessionId) setContextUsage(data.contextUsage);
      } else if (data.type === 'delta') { content += data.text; updateAnswer(); }
      else if (data.type === 'context_usage') { if (controller.current === abort && activeSession.current === sessionId) setContextUsage(data); }
      else if (data.type === 'tool_status') updateMessages(previous => previous.map((message, position) => position === index ? { ...message, toolCalls: [...(message.toolCalls || []), { id: data.id, name: data.name, arguments: data.arguments, status: data.status }] } : message));
      else if (data.type === 'tool_complete') updateMessages(previous => previous.map((message, position) => position === index ? { ...message, toolCalls: (message.toolCalls || []).map(call => call.id === data.id ? { ...call, status: data.status } : call) } : message));
      else if (data.type === 'error') serverError = data.error || 'Something went wrong.';
      else if (data.type === 'done') finished = true;
    }
    while (true) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer) consume(buffer); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(consume);
    }
    if (serverError) {
      if (content) toast(serverError);
      else { content = serverError; updateAnswer(true); }
    }
    return finished;
  }
  async function connectChat(sessionId, index, resume = false, text = '') {
    const abort = new AbortController(); controller.current = abort; setBusy(true); setActiveRunning(true);
    let finished = false;
    try {
      const response = resume
        ? await request(`/api/chat/stream?sessionId=${encodeURIComponent(sessionId)}`, { signal: abort.signal, stream: true })
        : await jsonRequest('/api/chat', 'POST', { sessionId, messages: [{ role: 'user', content: text }] }, { signal: abort.signal, stream: true });
      finished = await readChatStream(response, sessionId, abort, index);
    } catch (error) {
      if (error.name !== 'AbortError') {
        if (resume && error.message === 'No active chat') {
          try {
            const data = await request(`/api/sessions/${encodeURIComponent(sessionId)}`);
            if (activeSession.current === sessionId && data.session) selectSession(data.session);
          } catch {}
        } else if (activeSession.current === sessionId && controller.current === abort) {
          setMessages(previous => previous.map((message, position) => position === index ? { ...message, content: error.message, error: true } : message));
          if (!resume) setActiveRunning(false);
        }
      }
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); if (finished) setActiveRunning(false); }
      await loadSessions();
    }
  }
  function resumeChat(sessionId, index) {
    if (controller.current || activeSession.current !== sessionId) return;
    return connectChat(sessionId, index, true);
  }
  async function sendMessage(event) {
    event.preventDefault();
    if (controller.current) { await stopResponse(); return; }
    if (activeRunning) { toast('This agent is still running. Switch sessions or wait for it to finish.'); return; }
    if (!ready || !activeSession.current || sessionLock.current) { toast('Chat is still loading'); return; }
    const text = prompt;
    if (!text.trim()) return;
    const requestSessionId = activeSession.current;
    const index = messages.length + 1;
    setMessages(previous => [...previous, { role: 'user', content: text }, { role: 'assistant', content: '', toolCalls: [] }]);
    setPrompt('');
    return connectChat(requestSessionId, index, false, text);
  }
  async function updateDefaults(change) {
    if (!settings || busy || updatingSettings) return;
    setUpdatingSettings(true);
    try { await jsonRequest('/api/settings', 'PUT', { provider: settings.provider, mode: settings.mode, model: settings.model, ...change }); await loadSettings(); }
    catch (error) { toast(error.message); }
    finally { setUpdatingSettings(false); }
  }
  const closeSettings = useCallback(() => { setSettingsOpen(false); if (shell.current) shell.current.inert = false; if (sidebar.current) sidebar.current.inert = false; settingsButton.current?.focus(); }, []);
  const profile = sessions.find(session => session.id === sessionId)?.profile;
  const models = settings?.models || [];
  const selectedModel = models.find(model => model.id === settings?.model);
  const levels = selectedModel?.thinkingLevels || ['off'];
  const thinking = levels.includes(settings?.thinkingLevel) ? settings.thinkingLevel : levels[0];
  const measuredUsage = Boolean(contextUsage && settings && contextUsage.model === settings.model);
  const contextWindow = selectedModel?.contextWindow || (measuredUsage ? contextUsage.contextWindow : 0);
  const estimatedCharacters = messages.reduce((total, message) => total + (message.content?.length || 0) + (message.toolCalls || []).reduce((size, call) => size + JSON.stringify(call.arguments || {}).length, 0), 0);
  const contextTokens = measuredUsage ? contextUsage.tokens : Math.ceil(estimatedCharacters / 4);
  const contextPercent = contextWindow ? Math.min(100, Math.round(contextTokens / contextWindow * 100)) : 0;
  const connected = settings?.providers?.some(provider => provider.hasApiKey || provider.oauthConnected);
  const closeSidebar = () => { setSidebarOpen(false); menu.current?.focus(); };
  const pinnedSessions = pinnedAgentIds.map(id => sessions.find(session => session.id === id)).filter(Boolean);
  const pinnedIds = new Set(pinnedSessions.map(session => session.id));
  const unpinnedSessions = sessions.filter(session => !pinnedIds.has(session.id));
  const renderSession = session => {
    const pinned = pinnedIds.has(session.id);
    return <div class="session-row" key={session.id} onClick={event => { if (event.target.closest('button, select')) return; if (!loadingSession) openSession(session.id); }}>
      <Character profile={session.profile || {}} /><button class={`session-item${session.id === sessionId ? ' active' : ''}`} title={session.title || 'New agent'} disabled={loadingSession} onClick={() => openSession(session.id)}><span class="session-title">{session.title || 'New agent'}</span>{session.running && <span class="session-running-pill" role="img" aria-label="Running" title="Running" />}</button>
      <button class={`icon-button session-action pin-session${pinned ? ' pinned' : ''}`} data-agent-id={session.id} title={pinned ? 'Unpin agent' : 'Pin agent'} aria-label={`${pinned ? 'Unpin' : 'Pin'} agent: ${session.title || 'New agent'}`} aria-pressed={pinned} disabled={busy || loadingSession} onClick={() => togglePinnedAgent(session)}><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m16 3 5 5-4 1-4 4-1 4-2-2-7 7 7-7-2-2 4-1 4-4 0-5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
      <button class="icon-button session-action configure-session" title="Configure agent" aria-label={`Configure agent: ${session.title}`} disabled={busy || loadingSession} onClick={event => { if (controller.current || sessionLock.current) return; configOpener.current = event.currentTarget; setConfiguredSession(session); }}>⚙</button>
      <button class="icon-button session-action delete-session" title="Delete agent" aria-label={`Delete agent: ${session.title}`} disabled={busy || loadingSession} onClick={() => deleteSession(session)}>×</button>
    </div>;
  };

  return <>
    <div class="app-shell" ref={shell}>
      <aside ref={sidebar} class={`sidebar${mobile && sidebarOpen ? ' open' : ''}${!mobile && !sidebarOpen ? ' collapsed' : ''}`} id="sidebar">
        <div class="sidebar-brand"><a class="brand" href="#" aria-label="Sunday home"><Character brand /><span> sunday</span></a><button ref={collapseButton} class="icon-button" id="collapse-sidebar" aria-label="Collapse sidebar" aria-controls="sidebar" onClick={closeSidebar}>☰</button></div>
        <div class="sessions-heading">FEATURES</div>
        <section class="agents-feature" aria-labelledby="agents-title">
          <div class="feature-heading"><a class="feature-link" id="agents-title" href="#chat" aria-current={page === 'chat' ? 'page' : undefined}>Sunday Agents</a><button class="icon-button agents-toggle" id="agents-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} Sunday Agents sessions`} aria-expanded={expanded} aria-controls="agents-sessions" onClick={() => setExpanded(!expanded)}><svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button></div>
          <div id="agents-sessions" class={`agents-sessions${expanded ? '' : ' hidden'}`}>
            <button class="new-chat" id="new-chat" disabled={loadingSession} onClick={() => createSession()}><span class="plus">＋</span> New agent</button>
            <nav class="sessions-list" id="sessions-list" aria-label="Sunday Agents">
              {pinnedSessions.length > 0 && <div class="agent-list-heading">PINNED</div>}
              {pinnedSessions.map(renderSession)}
              {pinnedSessions.length > 0 && unpinnedSessions.length > 0 && <div class="agent-list-heading">AGENTS</div>}
              {unpinnedSessions.map(renderSession)}
            </nav>
          </div>
        </section>
        <a class="feature-heading repos-feature feature-link" id="repos-link" href="#repositories" aria-current={page === 'repositories' ? 'page' : undefined}>Repositories</a>
        <a class="feature-heading feature-link files-feature" id="editor-link" href="#files" aria-current={page === 'editor' ? 'page' : undefined}>Files</a>
        <div class="sidebar-bottom"><div class={`status-dot${connected ? ' ready' : ''}`} /><span id="connection-label">{settingsError ? 'Could not load settings' : connected ? 'Provider connected' : 'Set up to get started'}</span><button ref={settingsButton} class="icon-button settings-shortcut" id="open-settings" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>⚙</button></div>
      </aside>
      <button ref={menu} class="icon-button sidebar-reopen" id="mobile-menu" aria-label="Open sidebar" aria-controls="sidebar" aria-expanded={sidebarOpen} onClick={() => { setSidebarOpen(true); if (mobile) collapseButton.current?.focus(); }}>☰</button>
      <button class={`sidebar-backdrop${mobile && sidebarOpen ? ' open' : ''}`} id="sidebar-backdrop" aria-hidden={!mobile || !sidebarOpen} aria-label="Close sidebar" tabIndex="-1" onClick={closeSidebar} />
      <main class="main">
        {page === 'repositories' && <Repositories toast={toast} />}
        {page === 'editor' && <Suspense fallback={<section class="repositories-page" role="status">Loading editor…</section>}><CodeEditor toast={toast} onDirtyChange={dirty => { editorDirty.current = dirty; }} onSavingChange={saving => { editorSaving.current = saving; }} /></Suspense>}
        <section class={`conversation${page !== 'chat' ? ' hidden' : ''}`} id="conversation" aria-live="polite">
          <div class={`welcome${messages.length ? ' hidden' : ''}`} id="welcome"><Character welcome /><h1 id="welcome-greeting">{greetingText}</h1></div>
          {activeRunning && !busy && <div class="background-run-status" role="status">This agent is running on the server. You can switch sessions; its response will appear here when it finishes.</div>}
          <div ref={messageList} class="messages" id="messages">{messages.map((message, index) => <div key={index} class={`message ${message.role}`}>
            {message.role === 'assistant' && <div class="avatar"><Character profile={profile || {}} /></div>}
            {message.role === 'assistant' ? <div class="assistant-content"><MessageBubble content={message.content} error={message.error} /><ToolCalls calls={message.toolCalls} /></div> : <MessageBubble content={message.content} error={message.error} />}
          </div>)}</div>
        </section>
        <div class={`composer-wrap${page !== 'chat' ? ' hidden' : ''}`} id="chat-composer">
          <form class="composer" id="chat-form" onSubmit={sendMessage}><textarea ref={promptInput} id="prompt" rows="1" placeholder="Message Sunday..." aria-label="Message Sunday" value={prompt} disabled={busy || activeRunning} onInput={event => setPrompt(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} /><div class="composer-footer">{contextWindow > 0 && <div class="context-meter" aria-label="Model context usage">
            <div class="context-meter-label"><span><i class="context-live-dot" />CONTEXT <small>{measuredUsage ? 'LIVE' : 'EST.'}</small></span><span><b>{contextPercent}%</b> {formatTokens(contextTokens)} / {formatTokens(contextWindow)} TOKENS</span></div>
            <div class="context-meter-track" role="progressbar" aria-label="Context usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow={contextPercent} aria-valuetext={`${contextPercent}% of model context used`}><div class="context-meter-fill" style={{ width: `${contextPercent}%` }} /></div>
          </div>}<button class="send-button" id="send-button" type="submit" aria-label={busy ? 'Stop response' : 'Send message'}>{busy ? '■' : '>'}</button></div></form>
          <div class="composer-controls"><label class="composer-model-label" for="chat-model">MODEL</label><select class="select chat-model" id="chat-model" value={settings?.model || ''} disabled={busy || updatingSettings || !models.length} onChange={event => updateDefaults({ model: event.currentTarget.value })}>{models.length ? models.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>) : <option value="">{settings ? 'Connect a provider to see models' : 'Loading models…'}</option>}</select><label class="thinking-label" for="thinking-level">THINKING</label><select class="select thinking-level" id="thinking-level" value={thinking} disabled={busy || updatingSettings || !settings || levels.length === 1} title={levels.length === 1 && levels[0] === 'off' ? 'This model does not support thinking' : 'Reasoning effort'} onChange={event => updateDefaults({ thinkingLevel: event.currentTarget.value })}>{levels.map(level => <option key={level} value={level}>{level === 'xhigh' ? 'Extra high' : level[0].toUpperCase() + level.slice(1)}</option>)}</select></div>

        </div>
      </main>
    </div>
    {settingsOpen && <Settings settings={settings} onReload={loadSettings} onClose={closeSettings} toast={toast} />}
    {configuredSession && <SessionConfig key={configuredSession.id} session={configuredSession} onSaved={loadSessions} toast={toast} onClose={() => { setConfiguredSession(null); requestAnimationFrame(() => configOpener.current?.focus()); }} />}
    <div class={`toast${toastText ? ' show' : ''}`} id="toast" role="status" aria-live="polite">{toastText}</div>
  </>;
}
