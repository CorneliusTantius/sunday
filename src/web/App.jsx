import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { request, jsonRequest } from './api.js';
import Character from './components/Character.jsx';
import MenuIcon from './components/MenuIcon.jsx';
import Repositories from './components/Repositories.jsx';
import Socials from './components/Socials.jsx';
import ScheduledJobs from './components/ScheduledJobs.jsx';
import Memory from './components/Memory.jsx';
import Skills from './components/Skills.jsx';
import { lazy, Suspense } from 'preact/compat';
import SessionConfig from './components/SessionConfig.jsx';
import Settings from './components/Settings.jsx';
import MessageBubble from './components/MessageBubble.js';
import SkillCommandMessage from './components/SkillCommandMessage.jsx';
import ToolCalls from './components/ToolCalls.jsx';
import CompactionSummary from './components/CompactionSummary.jsx';
import MessageHistory from './components/MessageHistory.jsx';
import ComposerInput from './components/ComposerInput.jsx';
import { chatCommands, fileReferences } from './composer.js';
import { getContextMetrics, formatTokens } from './context.js';

const CodeEditor = lazy(() => import('./components/CodeEditor.jsx'));
const activityLabels = { compacting: 'Compacting context…', waiting: 'Waiting for response…', thinking: 'Thinking…', preparing_tool: 'Preparing tool…', using_tools: 'Using tools…', retrying: 'Request timed out. Retrying in 5 seconds…' };
const streamIdleTimeout = 150_000;

function progressLabel(status) {
  return Object.hasOwn(activityLabels, status) ? activityLabels[status] : activityLabels.waiting;
}

function cancelChat(sessionId) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  void jsonRequest('/api/chat/cancel', 'POST', { sessionId }, { signal: abort.signal })
    .catch(() => {}).finally(() => clearTimeout(timer));
}
function currentPage() {
  return ['#files', '#editor'].includes(location.hash) ? 'editor' : location.hash === '#repositories' ? 'repositories' : location.hash === '#socials' ? 'socials' : location.hash === '#scheduled-job' ? 'scheduled-job' : location.hash === '#context/skills' ? 'skills' : ['#context', '#memory'].includes(location.hash) ? 'context' : 'chat';
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
  const [sessionConfig, setSessionConfig] = useState(null);
  const sessionConfigRef = useRef(null);
  const [sessionModels, setSessionModels] = useState([]);
  const configPending = useRef(false);
  const [messages, setMessages] = useState([]);
  const [compaction, setCompaction] = useState(null);
  const [memoryActivity, setMemoryActivity] = useState('');
  useEffect(() => { setMemoryActivity(''); }, [sessionId]);
  const [showLatest, setShowLatest] = useState(false);
  const followLatest = useRef(true);
  const transcript = useRef(null);
  const [contextUsage, setContextUsage] = useState(null);
  const [ready, setReady] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  const [activeRunning, setActiveRunning] = useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [page, setPage] = useState(currentPage);
  const pageRef = useRef(page);
  pageRef.current = page;
  const [skillsExiting, setSkillsExiting] = useState(false);
  const skillsExitTimer = useRef(null);
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
    try {
      const data = await request('/api/settings');
      setSettings(data);
      setSettingsError(false);
      const config = sessionConfigRef.current;
      if (config) {
        const models = (data.connectedModels || [])
          .filter(item => item.provider === config.provider && item.mode === config.mode)
          .map(({ id, name, contextWindow, thinkingLevels }) => ({ id, name, contextWindow, thinkingLevels }));
        setSessionModels(models);
      }
      return data;
    } catch { setSettingsError(true); }
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
    if (activeSession.current !== session.id) { followLatest.current = true; setShowLatest(false); }
    activeSession.current = session.id; setSessionId(session.id); setActiveRunning(Boolean(session.running));
    localStorage.setItem('sunday-session-id', session.id);
    const nextMessages = (session.messages || []).filter(message => ['user', 'assistant'].includes(message.role));
    if (session.running && nextMessages.at(-1)?.role === 'user') nextMessages.push({ role: 'assistant', content: '', toolCalls: [] });
    setMessages(nextMessages);
    setCompaction(session.latestCompaction || (session.compaction?.summary ? session.compaction : null));
    setContextUsage(session.contextUsage || null);
    sessionConfigRef.current = session.config || null;
    setSessionConfig(session.config || null);
    setSessionModels(session.models || []);
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
    setBusy(false); setActivity('');
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
    if (!mobile) promptInput.current?.focus();
  }
  async function openSession(id, navigate = true) {
    if (id === activeSession.current) { navigateChat(navigate); return; }
    if (sessionLock.current) return;
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
    if (controller.current || sessionLock.current) throw new Error('Wait for the current operation to finish before deleting this agent');
    sessionLock.current = true; setLoadingSession(true);
    let remaining = [];
    try {
      await request(`/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      setConfiguredSession(null);
      if (session.id === activeSession.current) {
        activeSession.current = null; setSessionId(null); setReady(false); setMessages([]); setCompaction(null); localStorage.removeItem('sunday-session-id');
      }
      remaining = await loadSessions();
    } finally { sessionLock.current = false; setLoadingSession(false); }
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
      const listing = loadSessions();
      const saved = localStorage.getItem('sunday-session-id');
      // Restore the conversation without waiting for every sidebar summary.
      if (saved) await openSession(saved, false);
      const existing = await listing;
      if (!activeSession.current && existing.length) await openSession(existing[0].id, false);
      if (!activeSession.current && !existing.length) await createSession(false);
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
      clearTimeout(skillsExitTimer.current);
      if (pageRef.current === 'skills' && next !== 'skills') {
        setSkillsExiting(true);
        const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260;
        skillsExitTimer.current = setTimeout(() => { setSkillsExiting(false); skillsExitTimer.current = null; }, delay);
      } else {
        setSkillsExiting(false);
      }
      pageRef.current = next;
      setPage(next);
    };
    const layout = matchMedia('(max-width: 700px)');
    const resize = () => { setMobile(layout.matches); setSidebarOpen(!layout.matches); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('hashchange', route); layout.addEventListener('change', resize);
    return () => { clearInterval(timer); clearTimeout(toastTimer.current); clearTimeout(skillsExitTimer.current); controller.current?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('hashchange', route); layout.removeEventListener('change', resize); };
  }, []);
  useEffect(() => {
    document.title = `Sunday — ${page === 'editor' ? 'Files' : page === 'repositories' ? 'Repositories' : page === 'socials' ? 'Socials' : page === 'scheduled-job' ? 'Automations' : page === 'context' ? 'Context' : 'Chat'}`;
    if (mobile) setSidebarOpen(false);
    if (firstPage.current) { firstPage.current = false; return; }
    if (page === 'editor') shell.current?.querySelector('#code-editor-title')?.focus();
    else if (page === 'repositories') shell.current?.querySelector('#repositories-title')?.focus();
    else if (page === 'socials') shell.current?.querySelector('#socials-title')?.focus();
    else if (page === 'scheduled-job') shell.current?.querySelector('#scheduled-job-title')?.focus();
    else if (page === 'context' || page === 'skills') shell.current?.querySelector(page === 'skills' ? '#skills-title' : '#context-title')?.focus();
    else if (!mobile) promptInput.current?.focus();
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
  const updateScrollPosition = useCallback(() => {
    const element = transcript.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
    followLatest.current = nearBottom;
    setShowLatest(!nearBottom);
  }, []);
  const scrollToLatest = useCallback(() => {
    followLatest.current = true;
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
    setShowLatest(false);
  }, []);
  useLayoutEffect(() => {
    if (page !== 'chat') return;
    if (followLatest.current) scrollToLatest();
    else updateScrollPosition();
  }, [messages, sessionId, page, scrollToLatest, updateScrollPosition]);
  useEffect(() => {
    if (page !== 'chat' || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current) scrollToLatest();
      else updateScrollPosition();
    });
    if (transcript.current) observer.observe(transcript.current);
    if (messageList.current) observer.observe(messageList.current);
    return () => observer.disconnect();
  }, [page, scrollToLatest, updateScrollPosition]);
  useEffect(() => { if (!mobile && !busy && ready && !activeRunning) promptInput.current?.focus(); }, [mobile, busy, ready, activeRunning]);
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
    const refresh = () => {
      if (document.hidden) return;
      void loadSessions();
      if (controller.current) detachResponse();
      const id = activeSession.current;
      if (id) void request(`/api/sessions/${encodeURIComponent(id)}`).then(data => {
        if (activeSession.current === id && !controller.current && data.session) {
          selectSession(data.session);
          if (data.session.running) {
            const index = (data.session.messages || []).filter(message => ['user', 'assistant'].includes(message.role)).length;
            void resumeChat(id, index);
          }
        }
      }).catch(() => {});
    };
    const poll = () => { if (!document.hidden) void loadSessions(); };
    const timer = setInterval(poll, 3000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadSessions]);

  function stopResponse() {
    if (!controller.current) return;
    const id = activeSession.current;
    detachResponse(); setActiveRunning(false);
    cancelChat(id);
  }

  async function readChatStream(response, sessionId, abort, index, resetIdle) {
    if (!response.body) throw new Error('Streaming is unavailable.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', content = '', serverError = '', finished = false;
    function updateMessages(update) { if (controller.current === abort && activeSession.current === sessionId) setMessages(update); }
    function updateAnswer(error = false) { updateMessages(previous => previous.map((message, position) => position === index ? { ...message, content, error } : message)); }
    function updateActivity(label) { if (controller.current === abort && activeSession.current === sessionId) setActivity(label); }
    function updateTool(data) {
      const update = Object.fromEntries(['id', 'name', 'arguments', 'status', 'result'].filter(key => data[key] !== undefined).map(key => [key, data[key]]));
      updateMessages(previous => previous.map((message, position) => {
        if (position !== index) return message;
        const calls = message.toolCalls || [];
        return { ...message, toolCalls: calls.some(call => call.id === data.id)
          ? calls.map(call => call.id === data.id ? { ...call, ...update } : call)
          : [...calls, update] };
      }));
    }
    function consume(line) {
      if (finished || serverError) return;
      if (!line.startsWith('data:')) return;
      const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') return;
      let data;
      try { data = JSON.parse(raw); } catch (error) { if (error instanceof SyntaxError) return; throw error; }
      if (data.type === 'snapshot') {
        content = data.answer || '';
        if (data.error) serverError = data.error;
        updateMessages(previous => previous.map((message, position) => position === index ? { ...message, content, toolCalls: data.toolCalls || [] } : message));
        if (controller.current === abort && activeSession.current === sessionId) {
          if (data.contextUsage) setContextUsage(data.contextUsage);
          setCompaction(data.compaction?.summary ? data.compaction : null);
        }
        updateActivity(serverError ? '' : progressLabel(data.progress));
      } else if (data.type === 'progress') updateActivity(progressLabel(data.status));
      else if (data.type === 'delta') { content += data.text; updateAnswer(); updateActivity('Responding…'); }
      else if (data.type === 'memory' && controller.current === abort && activeSession.current === sessionId) {
        setMemoryActivity(data.operation === 'retrieval'
          ? `Memory: retrieved ${data.count} excerpts`
          : `Memory review: ${data.status}${data.pruned ? `; retired ${data.pruned} old snapshots` : ''}`);
      }
      else if (data.type === 'context_usage') { if (controller.current === abort && activeSession.current === sessionId) setContextUsage(data); }
      else if (data.type === 'compaction') { if (controller.current === abort && activeSession.current === sessionId) setCompaction(data.compaction?.summary ? data.compaction : null); }
      else if (data.type === 'tool_status') { updateTool(data); updateActivity('Using tools…'); }
      else if (data.type === 'tool_complete') updateTool(data);
      else if (data.type === 'error') { serverError = data.error || 'Something went wrong.'; updateActivity(''); }
      else if (data.type === 'done') { finished = true; updateActivity(''); }
    }
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) { buffer += decoder.decode(); if (buffer) consume(buffer); break; }
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(consume);
        if (finished || serverError) break;
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    if (serverError) {
      if (content || index < 0) toast(serverError);
      else { content = serverError; updateAnswer(true); }
    }
    if (!finished && !serverError) throw new Error('Response stream ended unexpectedly. Check your connection and retry your message.');
    return true;
  }
  async function connectChat(sessionId, index, resume = false, text = '', references = [], compactOnly = false) {
    const abort = new AbortController(); controller.current = abort; setBusy(true); setActiveRunning(true); setActivity(activityLabels.waiting);
    let finished = false, accepted = false, idleTimer;
    function resetIdle() {
      clearTimeout(idleTimer);
      if (abort.signal.aborted) return;
      idleTimer = setTimeout(() => {
        if (controller.current !== abort || activeSession.current !== sessionId) return;
        detachResponse();
        setActiveRunning(true);
      }, streamIdleTimeout);
    }
    abort.signal.addEventListener('abort', () => clearTimeout(idleTimer), { once: true });
    resetIdle();
    try {
      const response = resume
        ? await request(`/api/chat/stream?sessionId=${encodeURIComponent(sessionId)}`, { signal: abort.signal, stream: true })
        : await jsonRequest('/api/chat', 'POST', { sessionId, ...(compactOnly ? { compact: true } : { messages: [{ role: 'user', content: text }], ...(references.length ? { fileReferences: references } : {}) }) }, { signal: abort.signal, stream: true });
      accepted = true;
      if (abort.signal.aborted) return;
      finished = await readChatStream(response, sessionId, abort, index, resetIdle);
    } catch (error) {
      if (error.name !== 'AbortError') {
        if (compactOnly && activeSession.current === sessionId) toast(error.message);
        else if (resume && error.message === 'No active chat') {
          try {
            const data = await request(`/api/sessions/${encodeURIComponent(sessionId)}`);
            if (activeSession.current === sessionId && data.session) selectSession(data.session);
          } catch {}
        } else if (activeSession.current === sessionId && controller.current === abort) {
          if (!resume && !accepted) setPrompt(previous => previous || text);
          setMessages(previous => previous.map((message, position) => position === index
            ? { ...message, content: `${message.content ? `${message.content}\n\n` : ''}${error.message}`, error: true } : message));
          setActiveRunning(resume || accepted);
        }
      }
    } finally {
      clearTimeout(idleTimer);
      if (controller.current === abort) { controller.current = null; setBusy(false); setActivity(''); if (finished) setActiveRunning(false); }
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
    if (configPending.current) { toast('Model settings are still saving'); return; }
    if (!ready || !activeSession.current || sessionLock.current) { toast('Chat is still loading'); return; }
    const text = prompt;
    if (!text.trim()) return;
    const slashMatch = text.trim().match(/^\/(\S*)(?:\s|$)/);
    if (slashMatch) {
      const command = slashMatch[1].toLowerCase();
      const skillCommand = /^skill:[a-z0-9-]+$/.test(command);
      if (skillCommand) {
        // Skill commands are sent as user messages so the matching enabled skill can guide the task.
      } else {
        if (!chatCommands.some(item => item.name === command)) { toast('Unknown command.'); return; }
        setPrompt('');
        if (command === 'new') return createSession();
        if (command === 'settings') { setSettingsOpen(true); return; }
        if (command === 'compact') {
          const requestSessionId = activeSession.current;
          return connectChat(requestSessionId, -1, false, '', [], true);
        }
      }
    }
    let references;
    try { references = fileReferences(text); } catch { toast('Invalid file reference. Choose a file from the @ suggestions.'); return; }
    if (references.length > 5) { toast('Reference at most 5 files per message.'); return; }
    const requestSessionId = activeSession.current;
    const index = messages.length + 1;
    followLatest.current = true;
    setMessages(previous => [...previous, { role: 'user', content: text }, { role: 'assistant', content: '', toolCalls: [] }]);
    setPrompt('');
    return connectChat(requestSessionId, index, false, text, references);
  }
  async function updateSessionConfig(change) {
    const id = activeSession.current;
    if (!id || !ready || loadingSession || busy || activeRunning || configPending.current) return;
    configPending.current = true; setUpdatingSettings(true);
    try {
      const data = await jsonRequest(`/api/sessions/${encodeURIComponent(id)}`, 'PATCH', { config: change });
      if (activeSession.current === id) { sessionConfigRef.current = data.session.config; setSessionConfig(data.session.config); setSessionModels(data.session.models || []); }
    } catch (error) { toast(error.message); }
    finally { configPending.current = false; setUpdatingSettings(false); }
  }
  const closeSettings = useCallback(() => { setSettingsOpen(false); if (shell.current) shell.current.inert = false; if (sidebar.current) sidebar.current.inert = false; settingsButton.current?.focus(); }, []);
  const profile = sessions.find(session => session.id === sessionId)?.profile;
  const models = sessionModels;
  const selectedModel = models.find(model => model.id === sessionConfig?.model);
  const levels = selectedModel?.thinkingLevels || ['off'];
  const thinking = levels.includes(sessionConfig?.thinkingLevel) ? sessionConfig.thinkingLevel : levels[0];
  const { measuredUsage, contextWindow, contextTokens, contextPercent } = getContextMetrics(contextUsage, sessionConfig, messages, prompt, selectedModel?.contextWindow);
  const closeSidebar = () => { setSidebarOpen(false); menu.current?.focus(); };
  const sidebarSessions = sessions.filter(session => !session.scheduledJobId);
  const pinnedSessions = pinnedAgentIds.map(id => sidebarSessions.find(session => session.id === id)).filter(Boolean);
  const pinnedIds = new Set(pinnedSessions.map(session => session.id));
  const unpinnedSessions = sidebarSessions.filter(session => !pinnedIds.has(session.id));
  const sessionIsRunning = session => session.id === activeSession.current
    ? busy || activeRunning || Boolean(controller.current)
    : session.running;
  const renderSession = session => {
    const pinned = pinnedIds.has(session.id);
    return <div class="card card-border flex-row items-center gap-1 bg-base-200 p-2" key={session.id} onClick={event => { if (event.target.closest('button, select')) return; if (!loadingSession) openSession(session.id); }}>
      <button class={`btn btn-ghost btn-sm min-w-0 flex-1 justify-start truncate ${session.id === sessionId ? 'btn-active' : ''}`}  title={session.title || 'New agent'} disabled={loadingSession} onClick={() => openSession(session.id)}><span class="truncate">{session.title || 'New agent'}</span></button>
      {(session.id === sessionId ? activeRunning : session.running) && <span class="badge badge-success badge-xs" role="img" aria-label="Running" title="Running" />}
      <button class={`btn btn-ghost btn-square btn-xs ${pinned ? 'text-primary' : ''}`}  data-agent-id={session.id} title={pinned ? 'Unpin agent' : 'Pin agent'} aria-label={`${pinned ? 'Unpin' : 'Pin'} agent: ${session.title || 'New agent'}`} aria-pressed={pinned} onClick={() => togglePinnedAgent(session)}><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m16 3 5 5-4 1-4 4-1 4-2-2-7 7 7-7-2-2 4-1 4-4 0-5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
      <button class="btn btn-ghost btn-square btn-xs" title="Configure agent" aria-label={`Configure agent: ${session.title}`} disabled={sessionIsRunning(session) || loadingSession} onClick={event => { if (sessionIsRunning(session) || sessionLock.current) return; configOpener.current = event.currentTarget; setConfiguredSession(session); }}>⚙</button>
    </div>;
  };

  return <>
    <div class="flex h-dvh min-h-0 overflow-hidden bg-base-100 text-base-content" ref={shell}>
      <aside ref={sidebar} class={`z-20 flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden border-r border-base-300 bg-base-200 p-4 transition-transform max-[700px]:fixed max-[700px]:inset-y-0 max-[700px]:left-0 max-[700px]:w-[min(20rem,85vw)] ${mobile ? sidebarOpen ? 'translate-x-0' : '-translate-x-full' : sidebarOpen ? '' : 'hidden'}`} id="sidebar">
        <div class="navbar min-h-0 border-b border-base-300 px-0 pb-4"><a class="navbar-start flex min-w-0 items-center gap-3 text-lg font-bold text-base-content no-underline" href="#" aria-label="Sunday home"><Character brand /><span>Sunday</span></a><button ref={collapseButton} class="btn btn-ghost btn-square btn-sm" id="collapse-sidebar" aria-label="Collapse sidebar" aria-controls="sidebar" onClick={closeSidebar}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="m15 6-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button></div>
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain py-4">
        <section class="rounded-box border border-base-300 bg-base-100 p-2" aria-labelledby="agents-title">
          <div class="flex items-center justify-between gap-2"><a class="flex min-w-0 flex-1 items-center gap-3 rounded-field px-3 py-2 font-semibold text-base-content hover:bg-base-200 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary" id="agents-title" href="#chat" aria-current={page === 'chat' ? 'page' : undefined}><MenuIcon name="agents" /><span>Sunday Agents</span></a><button class="btn btn-ghost btn-square btn-sm" id="agents-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} Sunday Agents sessions`} aria-expanded={expanded} aria-controls="agents-sessions" onClick={() => setExpanded(!expanded)}><svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button></div>
        </section>
        <ul class="menu menu-sm w-full gap-1 p-0">
          <li><a class={page === 'context' ? 'active' : ''} id="context-link" href="#context" aria-current={page === 'context' ? 'page' : undefined}><MenuIcon name="memory" />Context</a></li>
          <li><a class={page === 'skills' ? 'active' : ''} id="skills-link" href="#context/skills" aria-current={page === 'skills' ? 'page' : undefined}><MenuIcon name="skills" />Skills</a></li>
          <li><a class={page === 'scheduled-job' ? 'active' : ''} id="scheduled-job-link" href="#scheduled-job" aria-current={page === 'scheduled-job' ? 'page' : undefined}><MenuIcon name="schedule" />Automations</a></li>
          <li><a class={page === 'repositories' ? 'active' : ''} id="repos-link" href="#repositories" aria-current={page === 'repositories' ? 'page' : undefined}><MenuIcon name="repositories" />Repositories</a></li>
          <li><a class={page === 'editor' ? 'active' : ''} id="editor-link" href="#files" aria-current={page === 'editor' ? 'page' : undefined}><MenuIcon name="files" />Files</a></li>
          <li><a class={page === 'socials' ? 'active' : ''} id="socials-link" href="#socials" aria-current={page === 'socials' ? 'page' : undefined}><MenuIcon name="socials" />Socials</a></li>
        </ul>
        <hr class="divider my-1" aria-hidden="true" />
        <section aria-label="Sunday Agents sessions" class="min-h-0">
          <div id="agents-sessions" class={expanded ? '' : 'hidden'} inert={!expanded} aria-hidden={!expanded}>
            <div class="flex flex-col gap-2"><button class="btn btn-outline btn-sm justify-start" id="new-chat" disabled={loadingSession} onClick={() => createSession()}><span aria-hidden="true">＋</span> New agent</button>
            <nav class="flex max-h-[40dvh] min-h-0 w-full flex-col gap-1 overflow-y-auto overscroll-y-contain" id="sessions-list" aria-label="Sunday Agents">
              {pinnedSessions.map(renderSession)}
              {unpinnedSessions.map(renderSession)}
            </nav>
            </div>
          </div>
        </section>
        <div class="mt-auto flex justify-end border-t border-base-300 pt-3"><button ref={settingsButton} class="btn btn-ghost btn-square" id="open-settings" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>⚙</button></div>
        </div>
      </aside>
      <button ref={menu} class={`btn btn-ghost btn-square fixed left-3 top-3 z-10 ${!mobile && sidebarOpen ? 'hidden' : ''}`}  id="mobile-menu" aria-label="Open sidebar" aria-controls="sidebar" aria-expanded={sidebarOpen} onClick={() => { setSidebarOpen(true); if (mobile) collapseButton.current?.focus(); }}>☰</button>
      <button class={`fixed inset-0 z-10 bg-neutral/60 ${mobile && sidebarOpen ? '' : 'hidden'}`} id="sidebar-backdrop" aria-hidden={!mobile || !sidebarOpen} aria-label="Close sidebar" tabIndex="-1" onClick={closeSidebar} />
      <main class="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {page === 'repositories' && <Repositories toast={toast} />}
        {page === 'socials' && <Socials />}
        {page === 'scheduled-job' && <ScheduledJobs />}
        {page === 'context' && <Memory toast={toast} />}
        {(page === 'skills' || skillsExiting) && <Skills exiting={skillsExiting} />}
        {page === 'editor' && <Suspense fallback={<section class="mx-auto flex min-h-0 w-[min(960px,calc(100%-48px))] flex-1 flex-col overflow-hidden py-12 max-[700px]:w-[calc(100%-30px)] max-[700px]:pt-16" role="status">Loading editor…</section>}><CodeEditor toast={toast} onDirtyChange={dirty => { editorDirty.current = dirty; }} onSavingChange={saving => { editorSaving.current = saving; }} /></Suspense>}
        <section ref={transcript} class={`mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col overflow-y-auto px-4 sm:px-6 ${page !== 'chat' ? 'hidden' : ''}`}  id="conversation" aria-live="polite" onScroll={updateScrollPosition}>
          <div class={`m-auto max-w-xl px-4 py-16 text-center ${messages.length ? 'hidden' : ''}`}  id="welcome"><Character welcome /><h1 id="welcome-greeting">{greetingText}</h1></div>
          {activeRunning && !busy && <div class="alert alert-info my-3" role="status">This agent is running on the server. You can switch sessions; its response will appear here when it finishes.</div>}
          <div ref={messageList} class="flex flex-col gap-6 py-6" id="messages">{memoryActivity && <p role="status" class="badge badge-info badge-outline self-start">{memoryActivity} · Review notes in Memory</p>}<CompactionSummary compaction={compaction} /><MessageHistory key={sessionId} messages={messages} transcript={transcript}>{(message, index) => <div key={index} class={`flex items-start gap-3 ${message.role === 'user' ? 'user justify-end' : 'assistant'}`} >
            {message.role === 'assistant' && <div class="avatar"><Character profile={profile || {}} /></div>}
            {message.role === 'assistant' ? <div class="min-w-0 flex-1"><MessageBubble content={message.content} error={message.error} /><ToolCalls calls={message.toolCalls} /></div> : <SkillCommandMessage content={message.content} error={message.error} />}
          </div>}</MessageHistory></div>
        </section>
        <div class={`mx-auto w-full max-w-5xl flex-none px-4 pb-4 sm:px-6 ${page !== 'chat' ? 'hidden' : ''}`}  id="chat-composer">
          {showLatest && <button class="btn btn-sm btn-outline mb-2" id="scroll-to-latest" type="button" aria-controls="conversation" onClick={scrollToLatest}>↓ Scroll to latest</button>}
          {busy && activity && <div class="badge badge-ghost mb-2" id="response-activity" role="status">{activity}</div>}
          <form class="card card-border bg-base-200 p-4" id="chat-form" onSubmit={sendMessage}><ComposerInput inputRef={promptInput} value={prompt} onChange={setPrompt} sessionId={sessionId} disabled={busy || activeRunning} /><div class="flex items-center justify-between gap-3 pt-2">{contextWindow > 0 && <div class="min-w-0 flex-1" aria-label="Model context usage" title="LIVE: last measured request plus draft estimate. EST.: approximate tokens. Automatic compaction reserves space for the model response.">
            <div class="mb-1 flex justify-between gap-3 text-xs text-base-content/70"><span><i class="mr-1 inline-block size-2 rounded-full bg-success" />CONTEXT <small>{measuredUsage && contextUsage.measured ? 'LIVE' : 'EST.'}</small></span><span><b>{contextPercent}%</b> {formatTokens(contextTokens)} / {formatTokens(contextWindow)} TOKENS</span></div>
            <div class="h-1.5 overflow-hidden rounded-full bg-base-300" role="progressbar" aria-label="Context usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow={contextPercent} aria-valuetext={`${contextPercent}% of model context used`}><div class="h-full rounded-full bg-primary transition-[width]" style={{ width: `${contextPercent}%` }} /></div>
          </div>}<button class="btn btn-primary btn-circle" id="send-button" type="submit" aria-label={busy ? 'Stop response' : 'Send message'}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">{busy ? <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" /> : <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />}</svg></button></div></form>
          <div class="flex flex-wrap items-center gap-2 pt-3"><label class="text-xs font-semibold text-base-content/70" for="chat-model">MODEL</label><select class="select select-sm w-full max-w-xs" id="chat-model" value={sessionConfig?.model || ''} disabled={!ready || loadingSession || busy || activeRunning || updatingSettings || !models.length} onChange={event => updateSessionConfig({ model: event.currentTarget.value })}>{models.length ? models.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>) : <option value="">{settings ? 'Connect a provider to see models' : 'Loading models…'}</option>}</select><label class="text-xs font-semibold text-base-content/70" for="thinking-level">THINKING</label><select class="select select-sm w-full max-w-xs" id="thinking-level" value={thinking} disabled={!ready || loadingSession || busy || activeRunning || updatingSettings || !sessionConfig || levels.length === 1} title={levels.length === 1 && levels[0] === 'off' ? 'This model does not support thinking' : 'Reasoning effort'} onChange={event => updateSessionConfig({ thinkingLevel: event.currentTarget.value })}>{levels.map(level => <option key={level} value={level}>{level === 'xhigh' ? 'Extra high' : level[0].toUpperCase() + level.slice(1)}</option>)}</select></div>

        </div>
      </main>
    </div>
    {settingsOpen && <Settings settings={settings} onReload={loadSettings} onClose={closeSettings} toast={toast} />}
    {configuredSession && <SessionConfig key={configuredSession.id} session={configuredSession} onSaved={loadSessions} onDelete={deleteSession} toast={toast} onClose={() => { setConfiguredSession(null); requestAnimationFrame(() => configOpener.current?.focus()); }} />}
    <div class={`toast toast-end toast-bottom z-50 ${toastText ? '' : 'hidden'}`} id="toast" role="status" aria-live="polite"><div class="alert alert-info">{toastText}</div></div>
  </>;
}
