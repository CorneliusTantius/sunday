import {
  createAgentSession, createCodemodeExtension, createMcpExtension,
  createToolSearchExtension, DefaultResourceLoader, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';

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
  const settingsManager = SettingsManager.create(process.cwd());
  settingsManager.applyOverrides({ defaultTools: ['+codemode', '+tool_search'] });
  const { session } = await createAgentSession({ tools: [], resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory() });
  await session.bindExtensions({ mode: 'rpc', uiContext: { select: async () => undefined, input: async () => undefined, notify: () => {}, ...ui } });
  return session;
}

async function closeSession(session) {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
  session.dispose();
}

export async function connectMcp(config, signal, { agentDir } = {}) {
  const session = await makeSession(config, agentDir);
  if (signal?.aborted) { await closeSession(session); signal.throwIfAborted(); }
  else signal?.addEventListener('abort', () => { void closeSession(session); }, { once: true });
  return {
    get tools() { return session.agent.state.tools; },
    async call(name, args) {
      signal?.throwIfAborted();
      const tool = session.agent.state.tools.find(item => item.name === name);
      if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
      const result = await tool.execute(`mcp-call-${Date.now()}`, args ?? {}, signal);
      return JSON.stringify(result);
    },
    close() { return closeSession(session); },
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
