import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    extensionFactories: [createCodemodeExtension({ mode: 'on' }), createToolSearchExtension(), createMcpExtension({ loadConfig: () => ({ servers: Object.entries(config.mcpServers).map(([name, entry]) => ({ name, config: entry, source: 'extension' })), errors: [] }), openUrl })],
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

export async function connectMcp(config, signal, { agentDir } = {}) {
  validateMcpConfig(config);
  signal?.throwIfAborted();
  const servers = Object.entries(config.mcpServers).filter(([, server]) => server.enabled !== false).map(([name]) => name);
  if (!servers.length) return { tools: [], prepare: async () => ({ servers: [] }), call: async () => { throw new Error('No MCP servers are enabled'); }, close: async () => {} };
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
    get tools() { return session.agent.state.tools; },
    async prepare() {
      signal?.throwIfAborted();
      if (closing) throw new Error('MCP connection is closed');
      // The outer chat loop does not call session.prompt(), so run its discovery hooks explicitly.
      const { systemPromptOptions } = await session.extensionRunner.emitBeforeAgentStart(
        { messageType: 'user', prompt: '' },
        { cwd: process.cwd(), customPrompt: '', selectedTools: session.getActiveToolNames(), sections: {} },
      );
      return { servers, discovery: systemPromptOptions.sections.mcp_servers || '', diagnostics: [...diagnostics] };
    },
    async call(name, args, assistantMessage) {
      signal?.throwIfAborted();
      if (closing) throw new Error('MCP connection is closed');
      if (!session.agent.state.tools.some(tool => tool.name === name)) throw new Error(`Unknown MCP tool: ${name}`);
      if (assistantMessage?.role !== 'assistant') throw new Error('MCP execution requires the assistant message that issued the call');
      // Nested codemode calls require the actual issuing message, not a separate model run.
      session.agent.state.messages = [assistantMessage];
      const toolCall = { type: 'toolCall', id: `sunday-mcp-${++sequence}`, name, arguments: args ?? {} };
      const outcome = await runToolCall(toolCall, {
        tools: session.agent.state.tools, assistantMessage,
        context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
        beforeToolCall: session.agent.beforeToolCall, afterToolCall: session.agent.afterToolCall, signal,
      });
      const result = { ...outcome.result, ...(diagnostics.length ? { diagnostics: [...diagnostics] } : {}) };
      if (outcome.isError) throw new Error(JSON.stringify(result));
      return JSON.stringify(result);
    },
    close,
  };
}

export async function createMcpLogin(config, name, agentDir) {
  if (!config.mcpServers[name]?.url) throw new Error('OAuth requires an HTTP MCP server');
  let resolveRedirect, url, error, status = 'starting';
  const redirect = new Promise(resolve => { resolveRedirect = resolve; });
  const session = await makeSession({ mcpServers: { [name]: config.mcpServers[name] } }, agentDir,
    value => { url = value; status = 'waiting'; }, {
      input: (_title, _placeholder, options) => {
        options?.signal?.addEventListener('abort', () => resolveRedirect(undefined), { once: true });
        return redirect;
      },
      notify: (message, type) => { if (type === 'error') { error = message; status = 'failed'; } },
    });
  session.prompt(`/mcp login ${name}`).then(() => { if (!error) status = 'complete'; }, failure => { error = failure.message; status = 'failed'; }).finally(() => closeSession(session));
  return {
    get url() { return url; }, get status() { return status; }, get error() { return error; },
    submit(value) { resolveRedirect(value); },
    close() { resolveRedirect(undefined); return closeSession(session); },
  };
}
