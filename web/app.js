const $ = (id) => document.getElementById(id);
const basicTools = ['read_file', 'list_files', 'search_files', 'write_file'];
const state = { settings: null, controller: null, busy: false, pollTimer: null, authEvents: 0, sessions: [], sessionId: null, ready: false, loadingSession: false };
const messages = $('messages');

function updateGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night.' : hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : hour < 22 ? 'Good evening.' : 'Good night.';
  $('welcome-greeting').textContent = greeting;
}
updateGreeting();
setInterval(updateGreeting, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateGreeting(); });

const faces = ['normal', 'sweat', 'sideeye'];
document.addEventListener('animationiteration', event => {
  if (!event.target.classList.contains('character-awake')) return;
  const character = event.target.parentElement;
  const choices = faces.filter(face => face !== (character.dataset.face || 'normal'));
  character.dataset.face = choices[Math.floor(Math.random() * choices.length)];
  if (character.dataset.color) event.target.style.backgroundImage = personaFaceImage(character.dataset.color, character.dataset.face);
});

async function loadRepos() {
  $('repo-status').textContent = 'Loading repositories…';
  try {
    const data = await (await request('/api/repos')).json();
    $('repos-list').replaceChildren(...data.repos.map(repo => {
      const item = document.createElement('li'); item.textContent = repo.name; return item;
    }));
    $('repo-status').textContent = data.repos.length ? '' : 'No repositories yet.';
  } catch (error) { $('repo-status').textContent = error.message; }
}
function showPage(focus = true) {
  const repositories = location.hash === '#repositories';
  $('repositories-page').classList.toggle('hidden', !repositories);
  $('conversation').classList.toggle('hidden', repositories);
  $('chat-composer').classList.toggle('hidden', repositories);
  if (repositories) $('repos-link').setAttribute('aria-current', 'page'); else $('repos-link').removeAttribute('aria-current');
  if (!repositories) $('agents-title').setAttribute('aria-current', 'page'); else $('agents-title').removeAttribute('aria-current');
  document.title = `Sunday — ${repositories ? 'Repositories' : 'Chat'}`;
  closeMobileSidebar();
  if (repositories) { loadRepos(); if (focus) $('repositories-title').focus(); }
  else if (focus) $('prompt').focus();
}
window.addEventListener('hashchange', () => showPage());
$('refresh-repos').addEventListener('click', loadRepos);
$('clone-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('clone-repo').disabled = true; $('repo-url').disabled = true;
  $('repo-status').textContent = 'Cloning repository…';
  try {
    const data = await (await request('/api/repos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: $('repo-url').value.trim() }) })).json();
    $('repo-url').value = ''; await loadRepos(); toast(`Cloned ${data.repo.name}`);
  } catch (error) { $('repo-status').textContent = error.message; }
  finally { $('clone-repo').disabled = false; $('repo-url').disabled = false; }
});

function toast(text) { const el = $('toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) { let message = `Request failed (${response.status})`; try { message = (await response.json()).error || message; } catch {} throw new Error(message); }
  return response;
}
async function loadSettings() {
  try {
    const response = await request('/api/settings'); state.settings = await response.json();
    renderProviders(state.settings.providers || []);
    populateModels(state.settings.models || [], state.settings.model, $('chat-model'));
    $('chat-model').disabled = state.busy || !state.settings.models.length;
    updateThinkingLevels();
    const ready = state.settings.providers?.some(provider => provider.hasApiKey || provider.oauthConnected);
    $('connection-label').textContent = ready ? 'Provider connected' : 'Set up to get started'; $('connection-label').previousElementSibling.classList.toggle('ready', !!ready);
  } catch (error) { $('connection-label').textContent = 'Could not load settings'; }
}
function setBusy(busy) { state.busy = busy; $('send-button').textContent = busy ? '■' : '↑'; $('send-button').setAttribute('aria-label', busy ? 'Stop response' : 'Send message'); $('prompt').disabled = busy; $('chat-model').disabled = busy || !state.settings?.models.length; updateThinkingLevels(); }
function addMessage(role, content = '') {
  const row = document.createElement('div'); row.className = `message ${role}`;
  if (role === 'assistant') { const avatar = document.createElement('div'); avatar.className = 'avatar'; const character = createPersonaCharacter(state.sessions.find(session => session.id === state.sessionId)?.profile); avatar.append(character); row.append(avatar); }
  const bubble = document.createElement('div'); bubble.className = 'message-bubble'; bubble.textContent = content; row.append(bubble); messages.append(row); $('welcome').classList.add('hidden'); row.scrollIntoView({ behavior: 'smooth', block: 'end' }); return bubble;
}
async function sendMessage(text) {
  if (state.busy) { state.controller?.abort(); return; }
  if (!state.ready || !state.sessionId) { toast('Chat is still loading'); return; }
  if (!text.trim()) return;
  addMessage('user', text); $('prompt').value = ''; $('prompt').style.height = 'auto';
  const history = [{ role: 'user', content: text }];
  const answer = addMessage('assistant'); state.controller = new AbortController(); setBusy(true);
  try {
    const response = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: state.sessionId, messages: history }), signal: state.controller.signal });
    if (!response.body) throw new Error('Streaming is unavailable.');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) if (line.startsWith('data:')) {
        const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
        try { const event = JSON.parse(raw); if (event.type === 'delta') answer.textContent += event.text; else if (event.type === 'error') throw new Error(event.error || 'Something went wrong.'); } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
      }
    }
  } catch (error) { if (error.name !== 'AbortError') { if (answer.textContent) toast(error.message); else { answer.textContent = error.message; answer.classList.add('error-text'); } } }
  finally { state.controller = null; setBusy(false); $('prompt').focus(); await loadSessions(); }
}
$('chat-form').addEventListener('submit', e => { e.preventDefault(); if (state.busy) sendMessage(''); else sendMessage($('prompt').value); });
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chat-form').requestSubmit(); } });
$('prompt').addEventListener('input', () => { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min($('prompt').scrollHeight, 180)}px`; });
$('agents-toggle').addEventListener('click', () => {
  const expanded = $('agents-toggle').getAttribute('aria-expanded') !== 'true';
  $('agents-toggle').setAttribute('aria-expanded', String(expanded));
  $('agents-toggle').setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} Sunday Agents sessions`);
  $('agents-sessions').classList.toggle('hidden', !expanded);
});
$('new-chat').addEventListener('click', () => { if (state.busy) { toast('Stop the response before starting a new chat'); return; } createSession(); });
async function loadSessions() {
  try { const data = await (await request('/api/sessions')).json(); state.sessions = data.sessions || []; renderSessions(); }
  catch (error) { toast(`Could not load chats: ${error.message}`); }
}
function renderSessions() {
  const list = $('sessions-list'); list.replaceChildren();
  for (const session of state.sessions) {
    const row = document.createElement('div'); row.className = 'session-row';
    const button = document.createElement('button'); button.className = `session-item${session.id === state.sessionId ? ' active' : ''}`;
    button.textContent = session.title || 'New chat'; button.title = button.textContent; button.disabled = state.busy || state.loadingSession;
    button.addEventListener('click', () => openSession(session.id));
    row.append(createPersonaCharacter(session.profile), button);
    for (const [label, icon, action] of [['Configure', '⚙', configureSession], ['Delete', '×', deleteSession]]) {
      const control = document.createElement('button'); control.className = `icon-button session-action ${label.toLowerCase()}-session`;
      control.textContent = icon; control.title = `${label} chat`; control.setAttribute('aria-label', `${label} chat: ${session.title}`);
      control.disabled = state.busy || state.loadingSession; control.addEventListener('click', () => action(session)); row.append(control);
    }
    list.append(row);
  }
}
let configuredSession = null;
async function configureSession(session) {
  if (state.busy || state.loadingSession) return;
  configuredSession = session.id;
  $('session-config-title').value = session.title;
  $('session-config-error').textContent = '';
  $('save-session-config').disabled = true;
  $('session-config-dialog').showModal();
  try {
    await loadPersonas();
    const data = await (await request('/api/repos')).json();
    if (configuredSession !== session.id || !$('session-config-dialog').open) return;
    const current = state.sessions.find(item => item.id === session.id) || session;
    $('session-config-persona').replaceChildren(...personas.map(persona => { const option = document.createElement('option'); option.value = persona.id; option.textContent = persona.name; return option; }));
    $('session-config-persona').value = current.profile?.personaId || 'sunday';
    $('session-config-repos').replaceChildren(...data.repos.map(repo => {
      const label = document.createElement('label'); label.className = 'repository-checkbox';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = repo.name; input.checked = (current.allowedRepositories || []).includes(repo.name);
      const name = document.createElement('span'); name.textContent = repo.name;
      label.append(input, name); return label;
    }));
    if (!data.repos.length) { const empty = document.createElement('p'); empty.className = 'field-note'; empty.textContent = 'No repositories yet. Clone one on the Repositories page.'; $('session-config-repos').append(empty); }
    $('save-session-config').disabled = false;
    $('session-config-title').focus();
  } catch (error) { $('session-config-error').textContent = error.message; }
}
$('close-session-config').addEventListener('click', () => $('session-config-dialog').close());
$('cancel-session-config').addEventListener('click', () => $('session-config-dialog').close());
$('session-config-dialog').addEventListener('close', () => { configuredSession = null; });
$('session-config-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = configuredSession;
  if (!id || state.busy) return;
  const payload = { title: $('session-config-title').value.trim(), personaId: $('session-config-persona').value, allowedRepositories: [...$('session-config-repos').querySelectorAll('input:checked')].map(input => input.value) };
  $('save-session-config').disabled = true;
  try {
    await request(`/api/sessions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    await loadSessions(); $('session-config-dialog').close(); toast('Session settings saved');
  } catch (error) { $('session-config-error').textContent = error.message; }
  finally { $('save-session-config').disabled = false; }
});
async function deleteSession(session) {
  if (state.busy || state.loadingSession || !window.confirm(`Delete “${session.title}”? This cannot be undone.`)) return;
  state.loadingSession = true; renderSessions();
  try {
    await request(`/api/sessions/${session.id}`, { method: 'DELETE' });
    if (session.id === state.sessionId) {
      state.sessionId = null; state.ready = false; localStorage.removeItem('sunday-session-id'); clearChat();
    }
    await loadSessions();
  } catch (error) { toast(error.message); }
  finally { state.loadingSession = false; renderSessions(); }
  if (!state.sessionId) {
    if (state.sessions.length) await openSession(state.sessions[0].id, false);
    else await createSession(false);
  }
}
function clearChat() { messages.replaceChildren(); $('welcome').classList.remove('hidden'); }
async function createSession(navigate = true) {
  if (state.loadingSession || state.busy) return;
  state.loadingSession = true;
  state.ready = false;
  try { const data = await (await request('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    if (!data.session?.id) throw new Error('Invalid session response');
    state.sessionId = data.session.id; localStorage.setItem('sunday-session-id', state.sessionId); clearChat(); state.ready = true; await loadSessions(); if (navigate) location.hash = 'chat'; closeMobileSidebar(); $('prompt').value = ''; $('prompt').focus();
  } catch (error) { state.ready = !!state.sessionId; toast(`Could not start chat: ${error.message}`); }
  finally { state.loadingSession = false; renderSessions(); }
}
async function openSession(id, navigate = true) {
  if (state.busy || state.loadingSession || id === state.sessionId) return; state.loadingSession = true; state.ready = false;
  try { const data = await (await request(`/api/sessions/${encodeURIComponent(id)}`)).json(); const session = data.session; if (!session) throw new Error('Session not found');
    state.sessionId = session.id; localStorage.setItem('sunday-session-id', session.id); clearChat();
    for (const message of session.messages || []) if (['user','assistant'].includes(message.role)) addMessage(message.role, message.content);
    state.ready = true; renderSessions(); if (navigate) location.hash = 'chat'; closeMobileSidebar();
  } catch (error) { state.ready = !!state.sessionId; toast(`Could not open chat: ${error.message}`); }
  finally { state.loadingSession = false; renderSessions(); }
}
async function initSessions() {
  await loadSessions(); const saved = localStorage.getItem('sunday-session-id');
  if (saved && state.sessions.some(session => session.id === saved)) await openSession(saved, false);
  else await createSession(false);
}
const mobileLayout = window.matchMedia('(max-width: 700px)');
function setSidebar(open) {
  $('sidebar').classList.toggle('open', mobileLayout.matches && open);
  $('sidebar').classList.toggle('collapsed', !mobileLayout.matches && !open);
  $('sidebar').inert = !open;
  $('mobile-menu').setAttribute('aria-expanded', String(open));
  $('sidebar-backdrop').classList.toggle('hidden', !mobileLayout.matches || !open);
}
function closeMobileSidebar() { if (mobileLayout.matches) setSidebar(false); }
$('mobile-menu').addEventListener('click', () => {
  const open = $('mobile-menu').getAttribute('aria-expanded') !== 'true';
  setSidebar(open);
  if (open && mobileLayout.matches) $('collapse-sidebar').focus();
});
$('collapse-sidebar').addEventListener('click', () => { setSidebar(false); $('mobile-menu').focus(); });
$('sidebar-backdrop').addEventListener('click', () => { setSidebar(false); $('mobile-menu').focus(); });
mobileLayout.addEventListener('change', () => setSidebar(!mobileLayout.matches));
setSidebar(!mobileLayout.matches);
document.addEventListener('keydown', e => {
  if (!mobileLayout.matches || !$('sidebar').classList.contains('open') || !$('settings-backdrop').classList.contains('hidden')) return;
  if (e.key === 'Escape') { setSidebar(false); $('mobile-menu').focus(); }
  if (e.key === 'Tab') {
    const controls = [...$('sidebar').querySelectorAll('a, button, input')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

function renderProviders(providers) {
  $('provider-list').replaceChildren();
  for (const provider of providers) {
    const connected = provider.hasApiKey || provider.oauthConnected;
    const option = [...$('provider').options].find(option => option.value === provider.id);
    if (option) option.textContent = provider.name || provider.id;
    if (!connected) continue;
    const card = document.createElement('button'); card.type = 'button'; card.className = 'provider-card'; card.dataset.provider = provider.id;
    card.setAttribute('aria-pressed', String($('provider').value === provider.id));
    const name = document.createElement('strong'); name.textContent = provider.name || provider.id;
    const status = document.createElement('span'); status.className = connected ? 'provider-status connected' : 'provider-status'; status.textContent = connected ? 'Connected' : 'Not connected';
    const methods = document.createElement('small'); methods.textContent = [provider.hasApiKey ? 'API key saved' : '', provider.oauthConnected ? 'ChatGPT signed in' : ''].filter(Boolean).join(' · ') || 'Select to connect';
    card.append(name, status, methods);
    card.addEventListener('click', () => { $('provider').value = provider.id; $('provider').dispatchEvent(new Event('change')); setSettingsPage('connect'); });
    $('provider-list').append(card);
  }
  if (!$('provider-list').children.length) { const empty = document.createElement('p'); empty.className = 'field-note'; empty.textContent = 'No providers connected yet. Add a provider to start chatting.'; $('provider-list').append(empty); }
}
let settingsPage = 'providers';
function setSettingsPage(page) {
  settingsPage = page;
  for (const [name, id] of [['providers', 'settings-provider-page'], ['connect', 'settings-connect-page'], ['config', 'settings-config-page'], ['personas', 'settings-personas-page']]) $(id).classList.toggle('hidden', page !== name);
  $('settings-providers-nav').classList.toggle('active', page === 'providers' || page === 'connect');
  $('settings-config-nav').classList.toggle('active', page === 'config');
  $('settings-personas-nav').classList.toggle('active', page === 'personas');
  $('save-settings').classList.toggle('hidden', page === 'providers' || page === 'personas');
  $('save-settings').textContent = page === 'connect' ? 'Save connection' : 'Save defaults';
  $('settings-error').textContent = '';
}
function populateConfigModes() {
  const provider = state.settings.providers.find(item => item.id === $('config-provider').value);
  const modes = [];
  if (provider?.hasApiKey) modes.push(['api_key', 'API key']);
  if (provider?.oauthConnected) modes.push(['oauth', 'ChatGPT sign-in']);
  $('config-mode').replaceChildren(...modes.map(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }));
  if (modes.some(([value]) => value === state.settings.mode)) $('config-mode').value = state.settings.mode;
}
function syncConfigSelection() {
  $('provider').value = $('config-provider').value;
  $('mode').value = $('config-mode').value;
  refreshProviderSettings(false);
}
$('settings-providers-nav').addEventListener('click', () => setSettingsPage('providers'));
$('provider-back').addEventListener('click', () => setSettingsPage('providers'));
$('add-provider').addEventListener('click', () => { $('api-key').value = ''; setSettingsPage('connect'); refreshProviderSettings(); });
$('settings-config-nav').addEventListener('click', () => {
  const providers = state.settings.providers.filter(item => item.hasApiKey || item.oauthConnected);
  $('config-provider').replaceChildren(...providers.map(provider => { const option = document.createElement('option'); option.value = provider.id; option.textContent = provider.name; return option; }));
  if (providers.some(provider => provider.id === state.settings.provider)) $('config-provider').value = state.settings.provider;
  populateConfigModes(); setSettingsPage('config');
  if (providers.length) syncConfigSelection();
  else { settingsModels = []; populateModels([], null); updateSettingsThinking(); $('save-settings').disabled = true; }
});
$('config-provider').addEventListener('change', () => { populateConfigModes(); syncConfigSelection(); });
$('config-mode').addEventListener('change', syncConfigSelection);

function updateProviderSelection() {
  for (const card of $('provider-list').children) card.setAttribute('aria-pressed', String(card.dataset.provider === $('provider').value));
}
let settingsModels = [];
function updateSettingsThinking(selected = $('settings-thinking-level').value) {
  populateThinkingLevels($('settings-thinking-level'), settingsModels.find(model => model.id === $('model').value), selected);
}
$('model').addEventListener('change', () => updateSettingsThinking());
function showSettings() {
  settingsRequest++; setSettingsPage('providers'); $('save-settings').disabled = false;
  $('settings-backdrop').classList.remove('hidden'); $('settings-error').textContent = ''; $('api-key').value = '';
  const s = state.settings || {}; settingsModels = s.models || []; $('provider').value = s.provider || 'openai'; $('mode').value = s.mode || 'api_key'; populateModels(settingsModels, s.model); updateSettingsThinking(s.thinkingLevel); updateMode(); updateOauthDisplay(s); $('close-settings').focus(); if ($('provider').value === 'openai') resumeAuth();
}
function populateModels(models, selected, select = $('model')) { select.replaceChildren(); if (!models.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'Connect a provider to see models'; select.append(option); } else for (const model of models) { const option = document.createElement('option'); option.value = model.id; option.textContent = model.name || model.id; select.append(option); } select.value = selected || models[0]?.id || ''; }
function updateMode() { updateProviderSelection(); const openai = $('provider').value === 'openai'; $('mode').querySelector('[value="oauth"]').disabled = !openai; if (!openai) $('mode').value = 'api_key'; $('api-key').placeholder = openai ? 'sk-...' : 'Provider API key'; const oauth = $('mode').value === 'oauth'; $('api-panel').classList.toggle('hidden', oauth); $('oauth-panel').classList.toggle('hidden', !oauth); $('model').disabled = !settingsModels.length; }
function updateOauthDisplay(settings = state.settings || {}) { const connected = !!settings.oauthConnected;
  $('api-key').placeholder = settings.hasApiKey ? 'Key saved — leave blank to keep it' : 'Provider API key'; $('oauth-state').textContent = connected ? 'Connected to OpenAI' : 'Not connected'; $('oauth-connect').classList.toggle('hidden', connected); $('oauth-disconnect').classList.toggle('hidden', !connected); }
let settingsRequest = 0, authGeneration = 0;
async function refreshProviderSettings(resume = true) {
  updateMode();
  const generation = ++settingsRequest;
  settingsModels = []; populateModels([], null); updateSettingsThinking(); updateMode();
  $('save-settings').disabled = true; $('settings-error').textContent = '';
  try {
    const response = await request(`/api/settings?provider=${encodeURIComponent($('provider').value)}&mode=${$('mode').value}`);
    const data = await response.json();
    if (generation !== settingsRequest) return;
    renderProviders(data.providers || []); settingsModels = data.models; populateModels(settingsModels, data.model); updateSettingsThinking(data.thinkingLevel); updateMode(); updateOauthDisplay(data);
    if (resume && $('provider').value === 'openai' && $('mode').value === 'oauth') await resumeAuth();
  } catch (error) { $('settings-error').textContent = error.message; }
  finally { if (generation === settingsRequest) $('save-settings').disabled = false; }
}
$('mode').addEventListener('change', refreshProviderSettings);
$('provider').addEventListener('change', () => { $('api-key').value = ''; authGeneration++; clearInterval(state.pollTimer); state.pollTimer = null; refreshProviderSettings(); });
$('open-settings').addEventListener('click', showSettings);
function populateThinkingLevels(select, model, selected, disabled = false) {
  const levels = model?.thinkingLevels || ['off'];
  select.replaceChildren(...levels.map(level => {
    const option = document.createElement('option'); option.value = level;
    option.textContent = level === 'xhigh' ? 'Extra high' : level[0].toUpperCase() + level.slice(1);
    return option;
  }));
  select.value = levels.includes(selected) ? selected : levels[0];
  select.disabled = disabled || levels.length === 1;
  select.title = levels.length === 1 && levels[0] === 'off' ? 'This model does not support thinking' : 'Reasoning effort';
}
function updateThinkingLevels() {
  populateThinkingLevels($('thinking-level'), state.settings?.models.find(model => model.id === state.settings.model), state.settings?.thinkingLevel, state.busy || !state.settings);
}
$('thinking-level').addEventListener('change', async () => {
  if (!state.settings || state.busy) return;
  $('thinking-level').disabled = true;
  $('chat-model').disabled = true;
  try {
    await request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: state.settings.provider, mode: state.settings.mode, model: state.settings.model, thinkingLevel: $('thinking-level').value }) });
    await loadSettings();
  } catch (error) { toast(error.message); }
  finally { updateThinkingLevels(); $('chat-model').disabled = state.busy || !state.settings.models.length; }
});
$('chat-model').addEventListener('change', async () => {
  if (!state.settings || state.busy) return;
  $('chat-model').disabled = true;
  $('thinking-level').disabled = true;
  try {
    await request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: state.settings.provider, mode: state.settings.mode, model: $('chat-model').value }) });
    await loadSettings();
  } catch (error) { $('chat-model').value = state.settings.model; toast(error.message); }
  finally { $('chat-model').disabled = state.busy || !state.settings.models.length; updateThinkingLevels(); }
});
function closeSettings() { settingsRequest++; authGeneration++; $('settings-backdrop').classList.add('hidden'); clearInterval(state.pollTimer); state.pollTimer = null; $('open-settings').focus(); }
document.addEventListener('keydown', e => {
  if ($('settings-backdrop').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeSettings();
  if (e.key !== 'Tab') return;
  const controls = [...$('settings-backdrop').querySelectorAll('button, input, select, a[href]')].filter(el => !el.disabled && el.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$('close-settings').addEventListener('click', closeSettings); $('cancel-settings').addEventListener('click', closeSettings);
$('settings-backdrop').addEventListener('click', e => { if (e.target === $('settings-backdrop')) closeSettings(); });
$('save-settings').addEventListener('click', async () => {
  if (settingsPage === 'connect') {
    $('save-settings').disabled = true;
    try {
      if ($('mode').value === 'api_key') {
        if ($('api-key').value.trim()) {
          await request('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: $('provider').value, apiKey: $('api-key').value.trim() }) });
        } else {
          const data = await (await request(`/api/settings?provider=${$('provider').value}&mode=api_key`)).json();
          if (!data.hasApiKey) throw new Error('Enter an API key to save this connection');
        }
      } else {
        const data = await (await request('/api/settings?provider=openai&mode=oauth')).json();
        if (!data.oauthConnected) throw new Error('Complete sign-in before saving');
      }
      $('api-key').value = ''; await loadSettings(); setSettingsPage('providers'); toast('Provider connected');
    } catch (error) { $('settings-error').textContent = error.message; }
    finally { $('save-settings').disabled = false; }
    return;
  }

  const payload = { provider: $('provider').value, mode: $('mode').value }; if ($('model').value) { payload.model = $('model').value; payload.thinkingLevel = $('settings-thinking-level').value; } if (payload.mode === 'api_key' && $('api-key').value) payload.apiKey = $('api-key').value;
  $('settings-error').textContent = ''; $('save-settings').disabled = true;
  try { const response = await request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const updated = await response.json().catch(() => null); await loadSettings(); if (updated?.models) { state.settings = updated; updateThinkingLevels(); } closeSettings(); toast('Settings saved'); }
  catch (error) { $('settings-error').textContent = error.message; }
  finally { $('save-settings').disabled = false; }
});
async function resumeAuth() {
  authGeneration++;
  $('oauth-events').replaceChildren(); state.authEvents = 0;
  clearInterval(state.pollTimer); state.pollTimer = null;
  await pollAuth();
}
async function pollAuth() {
  const generation = authGeneration;
  try {
    const response = await request('/api/auth/status'), data = await response.json();
    if (generation !== authGeneration || $('provider').value !== 'openai' || $('settings-backdrop').classList.contains('hidden')) return;
    $('oauth-cancel').classList.toggle('hidden', data.status !== 'pending');
    if (data.status === 'pending' && !state.pollTimer) state.pollTimer = setInterval(pollAuth, 1200);
    $('oauth-state').textContent = data.status === 'pending' ? 'Waiting for sign-in…' : data.status === 'done' ? 'Connected to OpenAI' : data.status === 'error' ? (data.error || 'Sign-in failed') : 'Not connected';
    const events = data.events || []; for (const event of events.slice(state.authEvents)) { const item = document.createElement('p'); item.textContent = event.message || event.instructions || ''; if (event.url) { const link = document.createElement('a'); link.href = event.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open OpenAI sign-in ↗'; item.append(document.createTextNode(' '), link); } $('oauth-events').append(item); } state.authEvents = events.length;
    $('code-entry').classList.toggle('hidden', !data.prompt); if (data.prompt) $('auth-code').placeholder = data.prompt.placeholder || 'Paste the final browser redirect URL';
    if (data.status === 'done') { authGeneration++; clearInterval(state.pollTimer); state.pollTimer = null; $('oauth-connect').classList.add('hidden'); $('oauth-disconnect').classList.remove('hidden'); await loadSettings(); await refreshProviderSettings(false); }
    if (data.status !== 'pending') { clearInterval(state.pollTimer); state.pollTimer = null; }
  } catch (error) { $('oauth-state').textContent = error.message; }
}
$('oauth-connect').addEventListener('click', async () => {
  $('settings-error').textContent = ''; $('oauth-connect').disabled = true;
  try {
    await request('/api/auth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await resumeAuth();
  } catch (error) { $('settings-error').textContent = error.message; }
  finally { $('oauth-connect').disabled = false; }
});
$('oauth-cancel').addEventListener('click', async () => {
  authGeneration++; clearInterval(state.pollTimer); state.pollTimer = null;
  try {
    await request('/api/auth/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    clearInterval(state.pollTimer); state.pollTimer = null; await resumeAuth();
  } catch (error) { $('settings-error').textContent = error.message; }
});
$('submit-code').addEventListener('click', async () => { try { await request('/api/auth/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('auth-code').value }) }); $('auth-code').value = ''; await pollAuth(); } catch (error) { $('settings-error').textContent = error.message; } });
$('oauth-disconnect').addEventListener('click', async () => { authGeneration++; clearInterval(state.pollTimer); state.pollTimer = null; try { await request('/api/auth', { method: 'DELETE' }); clearInterval(state.pollTimer); state.settings.oauthConnected = false; updateOauthDisplay(); await loadSettings(); await refreshProviderSettings(); toast('Account disconnected'); } catch (error) { $('settings-error').textContent = error.message; } });
loadSettings();
initSessions().then(() => showPage(false));

let personas = [];
async function loadPersonas() {
  try {
    personas = (await (await request('/api/personas')).json()).personas;
    const select = $('persona-select'), previous = select.value;
    select.replaceChildren(...personas.map(persona => { const option = document.createElement('option'); option.value = persona.id; option.textContent = persona.name; return option; }));
    if (personas.some(persona => persona.id === previous)) select.value = previous;
    renderSessions();
  } catch (error) { toast(error.message); }
}
function fillPersonaEditor() {
  const persona = personas.find(item => item.id === $('persona-select').value);
  $('persona-name').value = persona?.name || ''; $('persona-specialty').value = persona?.specialty || ''; $('persona-instructions').value = persona?.instructions || '';
  $('persona-color').value = persona?.color || 'cyan';
  $('persona-tools').replaceChildren(...basicTools.map(name => { const label = document.createElement('label'); label.className = 'repository-checkbox'; const input = document.createElement('input'); input.type = 'checkbox'; input.value = name; input.checked = (persona?.allowedTools || basicTools).includes(name); const text = document.createElement('span'); text.textContent = name; label.append(input, text); return label; })); updatePersonaPreview();
  $('delete-persona').disabled = !persona; $('persona-error').textContent = '';
}
$('settings-personas-nav').addEventListener('click', async () => { setSettingsPage('personas'); await loadPersonas(); fillPersonaEditor(); });
$('persona-select').addEventListener('change', fillPersonaEditor);
$('new-persona').addEventListener('click', () => { $('persona-select').value = ''; fillPersonaEditor(); $('persona-name').focus(); });
$('persona-form').addEventListener('submit', async event => {
  event.preventDefault(); const id = $('persona-select').value;
  const profile = { name: $('persona-name').value.trim(), specialty: $('persona-specialty').value.trim(), instructions: $('persona-instructions').value, color: $('persona-color').value, allowedTools: [...$('persona-tools').querySelectorAll('input:checked')].map(input => input.value) };
  $('save-persona').disabled = true;
  try {
    const data = await (await request(id ? `/api/personas/${id}` : '/api/personas', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })).json();
    await loadPersonas(); $('persona-select').value = data.persona.id; fillPersonaEditor(); toast('Persona saved');
  } catch (error) { $('persona-error').textContent = error.message; }
  finally { $('save-persona').disabled = false; }
});
$('delete-persona').addEventListener('click', async () => {
  const id = $('persona-select').value;
  if (!id || !confirm('Delete this persona? Existing session profiles will not change.')) return;
  try { await request(`/api/personas/${id}`, { method: 'DELETE' }); await loadPersonas(); fillPersonaEditor(); }
  catch (error) { $('persona-error').textContent = error.message; }
});

function personaColor(profile = {}) {
  const color = { cyan: '#00E5FF', violet: '#9D5CFF', blue: '#3874FF', amber: '#FFB020', lime: '#B7F52A', pink: '#FF3D9A' }[profile?.color] || '#00E5FF';
  return color;
}
function personaFaceImage(color, expression) {
  const paths = { normal: 'M23 23h-8v14h8M49 23h-8v14h8M28 41h8', sweat: 'M23 23h-8v14h8M47 23h-8v14h8M28 41h8M53 17v6', sideeye: 'M15 25h10v8M39 25h10v8M28 41h8', blink: 'M15 30h8M41 30h8M28 41h8' };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="20" fill="#090B10" stroke="${color}" stroke-width="3"/><path d="${paths[expression] || paths.normal}" fill="none" stroke="${color}" stroke-width="3"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function createPersonaCharacter(profile = {}) {
  const color = personaColor(profile);
  const character = document.createElement('span'); character.className = 'square-character avatar-character'; character.setAttribute('aria-hidden', 'true');
  character.dataset.color = color;
  for (const [expression, className] of [['normal', 'character-awake'], ['blink', 'character-blink']]) {
    const face = document.createElement('span'); face.className = `character-face ${className}`;
    face.style.backgroundImage = personaFaceImage(color, expression); character.append(face);
  }
  return character;
}
function updatePersonaPreview() { $('persona-preview').replaceChildren(createPersonaCharacter({ color: $('persona-color').value })); }
$('persona-color').addEventListener('change', updatePersonaPreview);
loadPersonas();
