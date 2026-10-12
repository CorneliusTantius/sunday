import http from 'node:http';
import { readFile, mkdir, writeFile, rename, chmod, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createModels, getSupportedThinkingLevels, clampThinkingLevel } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { BASIC_TOOL_NAMES, validateTools, executeTool, makeTools } from './tools.js';

const homeDir = join(homedir(), 'sunday');
const dataDir = join(homeDir, 'data');
const sessionsDir = join(dataDir, 'sessions');
const workspaceDir = join(homeDir, 'workspace');
const reposDir = join(workspaceDir, 'repos');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await mkdir(sessionsDir, { recursive: true, mode: 0o700 });
await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
await mkdir(reposDir, { recursive: true, mode: 0o700 });
process.chdir(workspaceDir);
async function load(name, fallback) {
  try { return JSON.parse(await readFile(join(dataDir, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function save(name, value) {
  const path = join(dataDir, name), temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}
let settings = await load('settings.json', { mode: 'api_key', model: 'gpt-4o-mini' });
let auth = await load('auth.json', {});
settings.deviceId ||= randomUUID();
for (const name of ['settings.json', 'auth.json']) {
  await save(name, name === 'settings.json' ? settings : auth);
  await chmod(join(dataDir, name), 0o600);
}
let queue = Promise.resolve();
function serialize(fn) { const next = queue.then(fn); queue = next.catch(() => {}); return next; }
const seededPersonas = [
  { id: 'sunday', name: 'Sunday', specialty: 'General assistance', instructions: 'Be helpful, clear, and thoughtful. Ask clarifying questions when needed.', color: 'cyan', emoji: 'normal' },
  { id: 'sales-outbound', name: 'Sales Outbound', specialty: 'Sales outreach', instructions: 'Draft concise, relevant outreach tailored to the recipient. Avoid unsupported claims and pressure tactics.', color: 'violet', emoji: 'normal' },
  { id: 'inbox-manager', name: 'Inbox Manager', specialty: 'Email organization', instructions: 'Help summarize messages and draft clear replies. Respect the user’s priorities and never imply messages were sent.', color: 'blue', emoji: 'normal' },
  { id: 'talent-scout', name: 'Talent Scout', specialty: 'Talent research', instructions: 'Help assess role-relevant qualifications fairly. Avoid assumptions and focus on evidence provided.', color: 'amber', emoji: 'normal' },
  { id: 'expense-manager', name: 'Expense Manager', specialty: 'Expense organization', instructions: 'Help categorize and summarize expense information accurately. Flag uncertainty rather than inventing details.', color: 'lime', emoji: 'normal' },
  { id: 'coding-agent', name: 'Coding Agent', specialty: 'Software development', instructions: 'Help explain, design, and write code carefully. State assumptions and note risks or uncertainty.', color: 'pink', emoji: 'normal' },
];
let personas = await load('personas.json', null);
if (personas === null) personas = seededPersonas;
const colors = ['cyan', 'violet', 'blue', 'amber', 'lime', 'pink'], emojis = ['normal', 'sweat', 'sideeye', 'blink'];
personas = personas.map((persona, index) => ({ ...persona, allowedTools: validateTools(persona.allowedTools), color: colors.includes(persona.color) ? persona.color : seededPersonas.find(item => item.id === persona.id)?.color || colors[index % colors.length], emoji: emojis.includes(persona.emoji) ? persona.emoji : 'normal' }));
await serialize(async () => { await save('personas.json', personas); await chmod(join(dataDir, 'personas.json'), 0o600); });
const credentials = {
  async read(id) { await queue; return structuredClone(auth[id]); },
  async list() { await queue; return Object.entries(auth).map(([providerId, value]) => ({ providerId, type: value.type })); },
  modify(id, fn) { return serialize(async () => { const value = await fn(structuredClone(auth[id])); if (value) { const next = { ...auth, [id]: value }; await save('auth.json', next); auth = next; } return structuredClone(auth[id]); }); },
  delete(id) { return serialize(async () => { const next = { ...auth }; delete next[id]; await save('auth.json', next); auth = next; }); },
};
// Pi stores one credential per provider. Mode-scoped stores preserve existing
// OpenAI entries while keeping API keys and subscription tokens independent.
const providers = [
  { ...openaiProvider(), modes: ['api_key', 'oauth'] },
  { ...anthropicProvider(), modes: ['api_key'] },
  { ...googleProvider(), modes: ['api_key'] },
];
const credentialId = (provider, mode) => mode === 'oauth' ? 'openai-chatgpt' : provider;
const modelsByMode = Object.fromEntries(['api_key', 'oauth'].map(mode => {
  const store = {
    async read(id, options) { const value = await credentials.read(credentialId(id, mode)); options?.signal?.throwIfAborted(); return value?.type === mode ? value : undefined; },
    async list() { const entries = await Promise.all(providers.filter(p => p.modes.includes(mode)).map(async p => ({ providerId: p.id, value: await this.read(p.id) }))); return entries.filter(entry => entry.value).map(entry => ({ providerId: entry.providerId, type: mode })); },
    modify: (id, fn, options) => credentials.modify(credentialId(id, mode), async current => { options?.signal?.throwIfAborted(); const value = await fn(current?.type === mode ? current : undefined); options?.signal?.throwIfAborted(); return value; }),
    delete: (id, options) => { options?.signal?.throwIfAborted(); return credentials.delete(credentialId(id, mode)); },
  };
  const models = createModels({ credentials: store, ...(mode === 'oauth' ? { authContext: { env: async () => undefined, fileExists: async () => false } } : {}) });
  for (const provider of providers.filter(p => p.modes.includes(mode))) {
    models.setProvider({ ...provider, auth: mode === 'oauth' ? { oauth: provider.auth.oauth } : { apiKey: provider.auth.apiKey } });
  }
  return [mode, models];
}));
function selection(provider = settings.provider, mode) {
  const entry = providers.find(p => p.id === provider);
  if (!entry) throw new Error('Invalid provider');
  mode ??= entry.modes.includes(settings.mode) ? settings.mode : 'api_key';
  if (!entry.modes.includes(mode)) throw new Error('Unsupported authorization mode for this provider');
  return { provider, mode };
}
function defaultModel(provider, mode, list = modelsByMode[mode].getModels(provider)) {
  const preferred = provider === 'openai' ? (mode === 'oauth' ? 'gpt-5.4' : 'gpt-4o-mini') : undefined;
  return list.find(model => model.id === preferred)?.id || list[0]?.id;
}
settings.provider ||= 'openai';
if (!providers.some(p => p.id === settings.provider)) settings.provider = 'openai';
if (!providers.find(p => p.id === settings.provider).modes.includes(settings.mode)) settings.mode = 'api_key';
if (!modelsByMode[settings.mode].getModel(settings.provider, settings.model)) settings.model = defaultModel(settings.provider, settings.mode);
settings.thinkingLevel = clampThinkingLevel(modelsByMode[settings.mode].getModel(settings.provider, settings.model), settings.thinkingLevel || 'off');
await save('settings.json', settings);
async function publicSettings(provider = settings.provider, mode) {
  ({ provider, mode } = selection(provider, mode));
  const statuses = await Promise.all(providers.map(async p => {
    const hasApiKey = !!await modelsByMode.api_key.checkAuth(p.id);
    const oauthConnected = p.modes.includes('oauth') && !!await modelsByMode.oauth.checkAuth(p.id);
    return { id: p.id, name: p.name, modes: p.modes, connected: mode === 'oauth' ? oauthConnected : hasApiKey, hasApiKey, oauthConnected };
  }));
  const available = await modelsByMode[mode].getAvailable(provider);
  const modelId = provider === settings.provider && mode === settings.mode ? settings.model : defaultModel(provider, mode, available);
  const model = available.find(m => m.id === modelId) || available.find(m => m.id === defaultModel(provider, mode, available));
  const status = statuses.find(p => p.id === provider);
  return { provider, mode, selectedProvider: settings.provider, selectedMode: settings.mode, model: model?.id || null, thinkingLevel: model ? clampThinkingLevel(model, settings.thinkingLevel) : 'off', connected: status.connected, hasApiKey: status.hasApiKey, oauthConnected: status.oauthConnected, providers: statuses, models: available.map(m => ({ id: m.id, name: m.name, thinkingLevels: getSupportedThinkingLevels(m) })), dataDir, workspaceDir };
}
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
let login = { status: 'idle', events: [] }, loginAttempt;
let loginQueue = Promise.resolve();
function withLoginLock(fn) { const next = loginQueue.then(fn); loginQueue = next.catch(() => {}); return next; }
async function cancelLogin(message = 'Sign-in cancelled') {
  const attempt = loginAttempt;
  if (!attempt || attempt.state.status !== 'pending') return;
  attempt.state.status = 'error'; attempt.state.error = message;
  attempt.controller.abort(new Error(message));
  await attempt.promise;
}
function startLogin(provider) {
  const state = { status: 'pending', provider, events: [], startedAt: Date.now(), expiresAt: Date.now() + LOGIN_TIMEOUT_MS };
  const attempt = { state, controller: new AbortController() };
  login = state; loginAttempt = attempt;
  const timer = setTimeout(() => { void cancelLogin('Sign-in timed out; try again'); }, LOGIN_TIMEOUT_MS);
  timer.unref();
  // Models.login races abort before the provider has closed its callback
  // server. Await the provider flow itself so cancel/restart cannot reuse an
  // occupied port or leave a late callback server behind.
  attempt.promise = modelsByMode.oauth.getProvider(provider).auth.oauth.login({
    signal: attempt.controller.signal,
    notify(event) {
      if (state.status !== 'pending') return;
      // Preserve SDK fields; expose the URL/text fields consumed by the UI.
      state.events.push(event.type === 'device_code' ? { ...event, url: event.verificationUri, message: `Enter code ${event.userCode}` } : event.type === 'info' && event.links?.length ? { ...event, url: event.links[0].url } : event);
    },
    prompt(prompt) {
      const signal = prompt.signal ? AbortSignal.any([prompt.signal, attempt.controller.signal]) : attempt.controller.signal;
      return new Promise((resolve, reject) => {
        const finish = (error, code) => {
          signal.removeEventListener('abort', abort);
          delete state.prompt; attempt.resolveCode = undefined;
          error ? reject(error) : resolve(code);
        };
        const abort = () => finish(new Error('Sign-in cancelled'));
        if (signal.aborted) return abort();
        state.prompt = { type: prompt.type, message: prompt.message, placeholder: prompt.placeholder };
        attempt.resolveCode = code => finish(null, code);
        signal.addEventListener('abort', abort, { once: true });
      });
    },
  }, { agentName: 'sunday', getDeviceId: () => settings.deviceId }).then(credential => credentials.modify(credentialId(provider, 'oauth'), async () => {
    attempt.controller.signal.throwIfAborted();
    return credential;
  })).then(() => {
    if (state.status === 'pending') state.status = 'done';
  }, error => {
    if (state.status === 'pending') { state.status = 'error'; state.error = error.message; }
  }).finally(() => {
    clearTimeout(timer); delete state.prompt; attempt.resolveCode = undefined;
  });
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Request too large'); }
  return text ? JSON.parse(text) : {};
}
const sessionLocks = new Map();
function safeRepoUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(host) || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts.some(part => !/^[\w.-]+$/.test(part))) return null;
  return { url: parsed.href, name: parts.at(-1).replace(/\.git$/i, '') };
}
function cloneRepo(url, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'http.followRedirects=false', 'clone', '--', url, destination], { cwd: reposDir, shell: false, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https' } });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString().slice(0, 4096 - stderr.length); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(stderr.trim().slice(0, 1000) || (code === null ? 'Git clone timed out' : 'Git clone failed'))); });
  });
}
function withSessionLock(id, fn) {
  const previous = sessionLocks.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  sessionLocks.set(id, current);
  return current.finally(() => { if (sessionLocks.get(id) === current) sessionLocks.delete(id); });
}
const validSessionId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const defaultPersona = () => personas.find(item => item.id === 'sunday') || personas[0] || { id: 'sunday', name: 'Sunday', specialty: '', instructions: '', color: 'cyan', emoji: 'normal' };
const defaultProfile = () => ({ ...validateProfile(defaultPersona()), personaId: defaultPersona().id, color: defaultPersona().color, emoji: defaultPersona().emoji });
function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
      typeof profile.name !== 'string' || profile.name.trim().length < 1 || profile.name.length > 80 ||
      typeof profile.specialty !== 'string' || profile.specialty.length > 200 ||
      typeof profile.instructions !== 'string' || profile.instructions.length > 8000) {
    throw new Error('Profile requires name (1–80 characters), specialty (up to 200), and instructions (up to 8000)');
  }
  const color = profile.color ?? 'cyan', emoji = profile.emoji ?? 'normal';
  if (!colors.includes(color) || !emojis.includes(emoji)) throw new Error('Invalid profile color or emoji');
  return { name: profile.name, specialty: profile.specialty, instructions: profile.instructions, allowedTools: validateTools(profile.allowedTools), color, emoji };
}
async function readSession(id) {
  try {
    const session = JSON.parse(await readFile(join(sessionsDir, `${id}.json`), 'utf8'));
    const matched = personas.find(persona => persona.id === session.profile?.personaId) || personas.find(persona => persona.name === session.profile?.name);
    const profile = session.profile ? validateProfile({ ...session.profile, color: session.profile.color ?? matched?.color ?? defaultPersona().color, emoji: session.profile.emoji ?? 'normal' }) : defaultProfile();
    session.profile = { ...profile, personaId: matched?.id || defaultPersona().id };
    return session;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function saveSession(session) { await save(join('sessions', `${session.id}.json`), session); await chmod(join(sessionsDir, `${session.id}.json`), 0o600); }
const port = Number(process.env.PORT || 3000);
const production = process.argv.includes('--production');
const vite = production ? null : await (await import('vite')).createServer({ configFile: new URL('./vite.config.js', import.meta.url).pathname, server: { middlewareMode: true } });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (!url.pathname.startsWith('/api/')) {
      if (vite) return vite.middlewares(req, res);
      const files = { '/': 'index.html', '/index.html': 'index.html' };
      const relative = files[url.pathname] || ( /^\/assets\/[\w.-]+$/.test(url.pathname) ? url.pathname.slice(1) : null );
      if (!relative) return json(res, 404, { error: 'Not found' });
      const content = await readFile(new URL(`./dist/${relative}`, import.meta.url));
      res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
      return res.end(content);
    }
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return json(res, 403, { error: 'Invalid host' });
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Invalid origin' });
    if (!['GET', 'DELETE'].includes(req.method) && req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, { error: 'Use application/json' });
    if (url.pathname === '/api/personas' && req.method === 'GET') return json(res, 200, { personas });
    const personaMatch = url.pathname.match(/^\/api\/personas\/([^/]+)$/);
    if (url.pathname === '/api/personas' && req.method === 'POST') {
      const input = await body(req);
      const profile = validateProfile({ ...input, color: input.color ?? 'cyan', emoji: input.emoji ?? 'normal' });
      const persona = { id: randomUUID(), ...profile };
      await serialize(async () => { const next = [...personas, persona]; await save('personas.json', next); personas = next; });
      return json(res, 201, { persona });
    }
    if (personaMatch && ['PATCH', 'DELETE'].includes(req.method)) {
      return await serialize(async () => {
        const index = personas.findIndex(persona => persona.id === personaMatch[1]);
        if (index < 0) return json(res, 404, { error: 'Persona not found' });
        if (req.method === 'DELETE') {
          const next = personas.filter(persona => persona.id !== personaMatch[1]);
          await save('personas.json', next); personas = next;
          return json(res, 200, { deleted: true });
        }
        const input = await body(req);
        const persona = { id: personas[index].id, ...validateProfile({ ...input, color: input.color ?? 'cyan', emoji: input.emoji ?? 'normal' }) };
        const next = personas.slice(); next[index] = persona;
        await save('personas.json', next); personas = next;
        return json(res, 200, { persona });
      });
    }
    if (url.pathname === '/api/repos' && req.method === 'GET') {
      const repos = [];
      for (const name of await readdir(reposDir, { withFileTypes: true })) if (name.isDirectory()) repos.push({ name: name.name });
      repos.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, { repos });
    }
    if (url.pathname === '/api/repos' && req.method === 'POST') {
      const input = await body(req), repo = safeRepoUrl(input.url);
      if (!repo || !/^[\w.-]+$/.test(repo.name) || repo.name === '.' || repo.name === '..') throw new Error('Invalid HTTPS repository URL');
      const destination = join(reposDir, repo.name);
      try { await mkdir(destination); } catch (error) { if (error.code === 'EEXIST') return json(res, 409, { error: 'Repository already exists' }); throw error; }
      try { await cloneRepo(repo.url, destination); }
      catch (error) { await rm(destination, { recursive: true, force: true }); return json(res, 400, { error: String(error.message).slice(0, 1000) }); }
      return json(res, 201, { repo: { name: repo.name } });
    }
    if (url.pathname === '/api/sessions' && req.method === 'GET') {
      const sessions = [];
      for (const name of await readdir(sessionsDir)) if (/^[a-f0-9-]{36}\.json$/.test(name)) {
        const session = await readSession(name.slice(0, -5));
        if (session) sessions.push({ id: session.id, title: session.title, updatedAt: session.updatedAt, profile: session.profile, allowedRepositories: session.allowedRepositories || [] });
      }
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      return json(res, 200, { sessions });
    }
    if (url.pathname === '/api/sessions' && req.method === 'POST') {
      const input = await body(req), now = Date.now();
      const persona = input.personaId === undefined ? null : personas.find(item => item.id === input.personaId);
      if (input.personaId !== undefined && !persona) throw new Error('Persona not found');
      const selectedProfile = persona || (input.profile === undefined ? defaultPersona() : input.profile);
      const session = { id: randomUUID(), title: 'New chat', updatedAt: now, messages: [], allowedRepositories: [], profile: { ...validateProfile(selectedProfile), personaId: selectedProfile.personaId || selectedProfile.id || defaultPersona().id } };
      await saveSession(session);
      return json(res, 201, { session });
    }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/profile)?$/);
    if (sessionMatch && url.pathname.endsWith('/profile') && req.method === 'PATCH') {
      const id = sessionMatch[1];
      if (!validSessionId(id)) return json(res, 400, { error: 'Invalid session ID' });
      const input = await body(req);
      const persona = input.personaId === undefined ? null : personas.find(item => item.id === input.personaId);
      if (input.personaId !== undefined && !persona) throw new Error('Persona not found');
      const profile = persona ? { ...validateProfile(persona), personaId: persona.id } : { ...validateProfile(input), personaId: input.personaId || defaultPersona().id };
      return await withSessionLock(id, async () => {
        const session = await readSession(id);
        if (!session) return json(res, 404, { error: 'Session not found' });
        session.profile = profile; session.updatedAt = Date.now();
        await saveSession(session);
        return json(res, 200, { session });
      });
    }
    if (sessionMatch && !url.pathname.endsWith('/profile') && ['PATCH', 'DELETE'].includes(req.method)) {
      const id = sessionMatch[1];
      if (!validSessionId(id)) return json(res, 400, { error: 'Invalid session ID' });
      const input = req.method === 'PATCH' ? await body(req) : null;
      if (input?.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120)) throw new Error('Chat title must be 1–120 characters');
      const persona = input?.personaId === undefined ? null : personas.find(item => item.id === input.personaId);
      if (input?.personaId !== undefined && !persona) throw new Error('Persona not found');
      if (input?.allowedRepositories !== undefined) {
        if (!Array.isArray(input.allowedRepositories) || input.allowedRepositories.length > 100 || input.allowedRepositories.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..')) throw new Error('Invalid allowed repositories');
        const available = new Set((await readdir(reposDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name));
        if (input.allowedRepositories.some(name => !available.has(name))) throw new Error('Repository not found');
      }
      return await withSessionLock(id, async () => {
        const session = await readSession(id);
        if (!session) return json(res, 404, { error: 'Session not found' });
        if (req.method === 'DELETE') {
          await rm(join(sessionsDir, id), { recursive: true, force: true });
          await rm(join(sessionsDir, `${id}.json`));
          return json(res, 200, { deleted: true });
        }
        if (input.title !== undefined) { session.title = input.title.trim(); session.titleEdited = true; }
        if (persona) session.profile = { ...validateProfile(persona), personaId: persona.id };
        if (input.allowedRepositories !== undefined) session.allowedRepositories = [...new Set(input.allowedRepositories)];
        session.updatedAt = Date.now();
        await saveSession(session);
        return json(res, 200, { session });
      });
    }
    if (sessionMatch && req.method === 'GET') {
      if (!validSessionId(sessionMatch[1])) return json(res, 400, { error: 'Invalid session ID' });
      const session = await readSession(sessionMatch[1]);
      return session ? json(res, 200, { session }) : json(res, 404, { error: 'Session not found' });
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, 200, await publicSettings(url.searchParams.get('provider') ?? settings.provider, url.searchParams.get('mode') ?? undefined));
    if (url.pathname === '/api/providers' && req.method === 'POST') {
      const input = await body(req);
      const { provider } = selection(input.provider, 'api_key');
      if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096) throw new Error('Enter a valid API key');
      await credentials.modify(provider, async () => ({ type: 'api_key', key: input.apiKey.trim() }));
      return json(res, 200, await publicSettings());
    }
    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      const input = await body(req);
      const { provider, mode } = selection(input.provider ?? settings.provider, input.mode);
      if (input.apiKey !== undefined && (mode !== 'api_key' || typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096)) throw new Error('Invalid API key or authorization mode');
      // A new key unlocks the static catalog before it is persisted. Validate
      // the whole request first so invalid model/thinking input cannot save it.
      const available = input.apiKey !== undefined ? modelsByMode[mode].getModels(provider) : await modelsByMode[mode].getAvailable(provider);
      if (input.model !== undefined && input.model !== null && typeof input.model !== 'string') throw new Error('Invalid model');
      if (input.model && !available.some(m => m.id === input.model)) throw new Error('Invalid model or provider not connected');
      const previousModel = provider === settings.provider && mode === settings.mode ? settings.model : undefined;
      const model = input.model || (available.some(m => m.id === previousModel) ? previousModel : defaultModel(provider, mode, available)) || defaultModel(provider, mode);
      const selectedModel = modelsByMode[mode].getModel(provider, model);
      if (input.thinkingLevel !== undefined && !getSupportedThinkingLevels(selectedModel).includes(input.thinkingLevel)) throw new Error('Unsupported thinking level for this model');
      const thinkingLevel = input.thinkingLevel ?? clampThinkingLevel(selectedModel, settings.thinkingLevel);
      await serialize(async () => {
        if (input.apiKey !== undefined) { const nextAuth = { ...auth, [credentialId(provider, mode)]: { type: 'api_key', key: input.apiKey.trim() } }; await save('auth.json', nextAuth); auth = nextAuth; }
        const next = { ...settings, provider, mode, model, thinkingLevel }; await save('settings.json', next); settings = next;
      });
      return json(res, 200, await publicSettings());
    }
    if (url.pathname === '/api/auth/start' && req.method === 'POST') {
      // OAuth endpoints default to OpenAI even when settings preview another
      // provider, preserving the existing UI's empty start/cancel payloads.
      const input = await body(req), { provider } = selection(input.provider ?? 'openai', 'oauth');
      return await withLoginLock(async () => {
        if (login.status !== 'pending') { await loginAttempt?.promise; startLogin(provider); }
        return json(res, 200, login);
      });
    }
    if (url.pathname === '/api/auth/status' && req.method === 'GET') return json(res, 200, login);
    if (url.pathname === '/api/auth/cancel' && req.method === 'POST') { await body(req); return await withLoginLock(async () => { await cancelLogin(); return json(res, 200, login); }); }
    if (url.pathname === '/api/auth/code' && req.method === 'POST') { const attempt = loginAttempt; const { code } = await body(req); if (attempt !== loginAttempt || login.status !== 'pending' || !attempt?.resolveCode || typeof code !== 'string' || !code.trim() || code.length > 8192) throw new Error('No pending prompt or empty code'); attempt.resolveCode(code.trim()); return json(res, 200, {}); }
    if (url.pathname === '/api/auth' && req.method === 'DELETE') { const { provider } = selection(url.searchParams.get('provider') ?? 'openai', 'oauth'); return await withLoginLock(async () => { await cancelLogin(); await modelsByMode.oauth.logout(provider); login = { status: 'idle', events: [] }; return json(res, 200, {}); }); }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const input = await body(req);
      if (!validSessionId(input.sessionId)) throw new Error('Invalid session ID');
      return await withSessionLock(input.sessionId, async () => {
        if (res.destroyed) return;
        const session = await readSession(input.sessionId);
        if (!session) return json(res, 404, { error: 'Session not found' });
        if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 200 || input.messages.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim())) throw new Error('Invalid chat messages');
        const userMessage = input.messages[input.messages.length - 1];
        if (userMessage.role !== 'user') throw new Error('Last message must be from user');
        session.messages.push({ role: 'user', content: userMessage.content });
        session.updatedAt = Date.now();
        if (session.title === 'New chat' && !session.titleEdited) session.title = userMessage.content.slice(0, 80);
        await saveSession(session);
        const selected = { ...settings }, models = modelsByMode[selected.mode], model = models.getModel(selected.provider, selected.model);
        if (!model) throw new Error('Choose a valid model in settings');
        if (!await models.getAuth(model)) throw new Error(`Connect ${providers.find(p => p.id === selected.provider).name} in settings first`);
        if (res.destroyed) return;
        const controller = new AbortController(); res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
        const send = data => { if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`); };
        const history = session.messages.map(m => m.role === 'user' ? { role: 'user', content: m.content, timestamp: Date.now() } : { role: 'assistant', content: [{ type: 'text', text: m.content }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
        let answer = '';
        try {
          const profile = session.profile || defaultProfile();
          const prompt = [`You are ${profile.name}, a helpful assistant.`, profile.specialty && `Specialty: ${profile.specialty}`, profile.instructions && `Instructions: ${profile.instructions}`, session.allowedRepositories?.length && `Allowed repositories: ${session.allowedRepositories.join(', ')}. Tool paths must begin with the repository name. These are shared repositories; changes affect other sessions.`].filter(Boolean).join('\n\n');
          const allowed = session.allowedRepositories?.length ? validateTools(profile.allowedTools).filter(name => BASIC_TOOL_NAMES.includes(name)) : [];
          const tools = makeTools(allowed);
          for (let round = 0; round < 4; round++) {
            const stream = models.streamSimple(model, { systemPrompt: prompt, messages: history, ...(tools.length && round < 3 ? { tools } : {}) }, { signal: controller.signal, reasoning: selected.thinkingLevel === 'off' ? undefined : selected.thinkingLevel });
            for await (const event of stream) {
              if (event.type === 'text_delta') { answer += event.delta; send({ type: 'delta', text: event.delta }); }
              if (event.type === 'error') throw new Error(event.error.errorMessage || 'Provider request failed');
            }
            const assistant = await stream.result();
            history.push(assistant);
            const calls = assistant.content.filter(block => block.type === 'toolCall');
            if (!calls.length) break;
            if (round === 3) throw new Error('Tool round limit reached');
            for (const call of calls) {
              if (controller.signal.aborted) throw new Error('Chat cancelled');
              send({ type: 'tool_status', name: BASIC_TOOL_NAMES.includes(call.name) ? call.name : 'unknown' });
              let result, isError = false;
              try {
                if (!allowed.includes(call.name) || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new Error('Tool is not allowed or arguments are invalid');
                result = await executeTool(call.name, call.arguments, session.allowedRepositories.map(name => join(reposDir, name)));
              } catch (error) { result = error.message; isError = true; }
              history.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: String(result).slice(0, 50000) }], isError, timestamp: Date.now() });
            }
          }
          send({ type: 'done' });
        } catch (error) { send({ type: 'error', error: error.message }); }
        if (answer) { session.messages.push({ role: 'assistant', content: answer }); session.updatedAt = Date.now(); await saveSession(session); }
        return res.end();
      });
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) { if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message }); else res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Sunday: http://localhost:${port}`));
async function shutdown() { await withLoginLock(() => cancelLogin()); await vite?.close(); server.close(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
