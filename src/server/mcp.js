import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { devNull } from 'node:os';
import { runToolCall } from '@earendil-works/pi-agent-core';
import {
  getAgentDir,
  createAgentSession, createCodemodeExtension, createMcpExtension,
  createToolSearchExtension, DefaultResourceLoader, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';

export async function mcpAuthStatus(config, agentDir = getAgentDir()) {
  let states;
  try { states = JSON.parse(await readFile(join(agentDir, 'mcp-auth.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; states = {}; }
  return Object.fromEntries(Object.entries(config.mcpServers).filter(([, server]) => server.url).map(([name, server]) => {
    const url = String(new URL(server.url));
    const tokens = (states[`mcp__${name.replace(/-/g, '_')}|${url}`] ?? states[url])?.tokens;
    return [name, Boolean(tokens?.access_token)];
  }));
}

export function validateMcpConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || !config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) throw new Error('Invalid MCP config');
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name) || !server || typeof server !== 'object' || Array.isArray(server)) throw new Error(`Invalid MCP server: ${name}`);
    if (server.enabled !== undefined && typeof server.enabled !== 'boolean') throw new Error(`Invalid MCP enabled flag: ${name}`);
    if ((server.command && server.url) || (!server.command && !server.url && !server.type)) throw new Error(`Invalid MCP server transport: ${name}`);
    if (server.command !== undefined && (typeof server.command !== 'string' || !server.command.trim())) throw new Error(`Invalid MCP command: ${name}`);
    if (server.url !== undefined && (typeof server.url !== 'string' || !URL.canParse(server.url) || !['http:', 'https:'].includes(new URL(server.url).protocol))) throw new Error(`Invalid MCP URL: ${name}`);
    if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some(arg => typeof arg !== 'string'))) throw new Error(`Invalid MCP args: ${name}`);
    if (server.env !== undefined && (!server.env || typeof server.env !== 'object' || Array.isArray(server.env) || Object.values(server.env).some(value => typeof value !== 'string'))) throw new Error(`Invalid MCP env: ${name}`);
    if (server.headers !== undefined && (!server.headers || typeof server.headers !== 'object' || Array.isArray(server.headers) || Object.values(server.headers).some(value => typeof value !== 'string'))) throw new Error(`Invalid MCP headers: ${name}`);
    if (server.type !== undefined && !['stdio', 'http', 'streamable-http'].includes(server.type)) throw new Error(`Invalid MCP type: ${name}`);
  }
  return config;
}

async function makeSession(config, agentDir, openUrl, ui = {}) {
  validateMcpConfig(config);
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(), agentDir: agentDir ?? process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME}/.pi/agent`,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    // Server notifications are untrusted and may echo credentials; never persist SDK server logs.
    extensionFactories: [createCodemodeExtension({ mode: 'on' }), createToolSearchExtension(), createMcpExtension({ loadConfig: () => ({ servers: Object.entries(config.mcpServers).map(([name, entry]) => ({ name, config: entry, source: 'extension' })), errors: [] }), openUrl, logPath: devNull }),
      pi => pi.on('tool_result', event => event.isError ? {
        content: [{ type: 'text', text: 'MCP tool execution failed. Check arguments, server configuration, sign-in, and connectivity in Settings → MCP.' }], details: {},
      } : undefined),
    ],
  });
  await loader.reload();
  if (loader.getExtensions().errors.length) throw new Error('MCP extensions could not load; check the installed SDK and server configuration.');
  const settingsManager = SettingsManager.create(process.cwd());
  // tools: [] is an empty allowlist, not just "no filesystem tools". Modifiers keep MCP tools callable.
  const { session } = await createAgentSession({ noTools: true, tools: ['+codemode', '+tool_search'], resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory() });
  try {
    await session.bindExtensions({ mode: 'rpc', onError: () => ui.notify?.('MCP extension failed', 'error'), uiContext: { select: async () => undefined, input: async () => undefined, notify: () => {}, ...ui } });
  } catch {
    await closeSession(session);
    throw new Error('MCP initialization failed; check the installed SDK and server configuration.');
  }
  return session;
}

async function closeSession(session) {
  try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); }
  finally { session.dispose(); }
}

// Redact at the adapter boundary, including successful codemode output that caught a nested error.
async function createMcpRedactor(config) {
  const secrets = new Set();
  const remember = value => {
    if (typeof value !== 'string' || !value) return;
    secrets.add(value);
    for (const match of value.matchAll(/\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g)) {
      const resolved = process.env[match[1] || match[2]];
      if (resolved) secrets.add(resolved);
    }
    try { secrets.add(decodeURIComponent(value)); } catch { /* Already decoded or not URL-encoded. */ }
  };
  for (const server of Object.values(config.mcpServers)) {
    for (const value of Object.values(server.env || {})) remember(value);
    for (const value of Object.values(server.headers || {})) {
      remember(value);
      remember(value.replace(/^(?:Bearer|Basic)\s+/i, ''));
    }
    remember(server.oauth?.clientSecret);
    if (server.url) {
      const url = new URL(server.url);
      for (const value of [url.username, url.password, ...url.searchParams.values()]) remember(value);
    }
  }
  const refresh = async () => {
    let auth;
    try { auth = JSON.parse(await readFile(join(getAgentDir(), 'mcp-auth.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw new Error('MCP credentials could not be read safely'); }
    for (const entry of Object.values(auth)) {
      for (const key of ['access_token', 'refresh_token', 'id_token']) remember(entry?.tokens?.[key]);
      remember(entry?.clientInformation?.client_secret);
      remember(entry?.codeVerifier);
      remember(entry?.oauthState);
    }
  };
  await refresh();
  const redact = text => {
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      for (const value of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)])) {
        text = text.split(value).join('[REDACTED]');
      }
    }
    return text;
  };
  const sanitize = value => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), sanitize(item)]));
    return value;
  };
  return { refresh, redact, sanitize };
}

export async function connectMcp(config, signal, { agentDir } = {}) {
  validateMcpConfig(config);
  signal?.throwIfAborted();
  const servers = Object.entries(config.mcpServers).filter(([, server]) => server.enabled !== false).map(([name]) => name);
  if (!servers.length) return { tools: [], prepare: async () => ({ servers: [] }), call: async () => { throw new Error('No MCP servers are enabled'); }, close: async () => {} };
  const { refresh, redact, sanitize } = await createMcpRedactor(config);
  const diagnostics = [];
  // SDK failure messages can contain transport URLs or credentials. Publish only known states.
  const notify = (message, type) => {
    if (!['warning', 'error'].includes(type)) return;
    const affected = servers.filter(name => message.includes(`${name}:`));
    const action = message.includes('needs sign-in')
      ? 'Sign in again in Settings → MCP.'
      : 'Check the enabled MCP server configuration and connectivity in Settings → MCP; stored sign-in credentials do not verify connectivity.';
    const diagnostic = `MCP ${affected.length ? affected.join(', ') : 'connection or discovery'} needs attention. ${action}`;
    if (!diagnostics.includes(diagnostic)) diagnostics.push(diagnostic);
  };
  const session = await makeSession(config, agentDir, undefined, { notify });
  let closing;
  const close = () => {
    if (!closing) {
      signal?.removeEventListener('abort', onAbort);
      closing = closeSession(session);
    }
    return closing;
  };
  const onAbort = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) { await close(); signal.throwIfAborted(); }
  let sequence = 0;
  return {
    get tools() { return session.agent.state.tools.map(tool => ({ ...tool, description: redact(tool.description), parameters: sanitize(tool.parameters) })); },
    async prepare() {
      signal?.throwIfAborted();
      if (closing) throw new Error('MCP connection is closed');
      // The outer chat loop does not call session.prompt(), so run its discovery hooks explicitly.
      const { systemPromptOptions } = await session.extensionRunner.emitBeforeAgentStart(
        { messageType: 'user', prompt: '' },
        { cwd: process.cwd(), customPrompt: '', selectedTools: session.getActiveToolNames(), sections: {} },
      );
      await refresh();
      return sanitize({ servers, discovery: systemPromptOptions.sections.mcp_servers || '', diagnostics: [...diagnostics] });
    },
    async call(name, args, assistantMessage) {
      signal?.throwIfAborted();
      if (closing) throw new Error('MCP connection is closed');
      if (!session.agent.state.tools.some(tool => tool.name === name)) throw new Error(`Unknown MCP tool: ${name}`);
      if (assistantMessage?.role !== 'assistant') throw new Error('MCP execution requires the assistant message that issued the call');
      // Nested codemode calls require the actual issuing message, not a separate model run.
      session.agent.state.messages = [assistantMessage];
      const toolCall = { type: 'toolCall', id: `sunday-mcp-${++sequence}`, name, arguments: args ?? {} };
      const failure = () => new Error(`MCP tool ${name} failed. Check its arguments and the server configuration, sign-in, and connectivity in Settings → MCP.`);
      let outcome;
      try {
        outcome = await runToolCall(toolCall, {
          tools: session.agent.state.tools, assistantMessage,
          context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
          beforeToolCall: session.agent.beforeToolCall, afterToolCall: session.agent.afterToolCall, signal,
        });
      } catch { throw failure(); }
      const result = { ...outcome.result, ...(diagnostics.length ? { diagnostics: [...diagnostics] } : {}) };
      await refresh();
      if (outcome.isError) throw failure();
      return JSON.stringify(sanitize(result));
    },
    close,
  };
}

export async function createMcpLogin(config, name, agentDir) {
  if (!config.mcpServers[name]?.url) throw new Error('OAuth requires an HTTP MCP server');
  const loginFailure = 'MCP sign-in failed. Check the server configuration and try signing in again in Settings → MCP.';
  let resolveRedirect, url, error, status = 'starting';
  const redirect = new Promise(resolve => { resolveRedirect = resolve; });
  const session = await makeSession({ mcpServers: { [name]: config.mcpServers[name] } }, agentDir,
    value => { url = value; status = 'waiting'; }, {
      input: (_title, _placeholder, options) => {
        options?.signal?.addEventListener('abort', () => resolveRedirect(undefined), { once: true });
        return redirect;
      },
      notify: (_message, type) => { if (type === 'error') { error = loginFailure; status = 'failed'; } },
    });
  session.prompt(`/mcp login ${name}`).then(() => { if (!error) status = 'complete'; }, () => { error = loginFailure; status = 'failed'; }).finally(() => closeSession(session));
  return {
    get url() { return url; }, get status() { return status; }, get error() { return error; },
    submit(value) { resolveRedirect(value); },
    close() { resolveRedirect(undefined); return closeSession(session); },
  };
}
