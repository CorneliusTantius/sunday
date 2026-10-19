import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function validateMcpConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => key !== 'mcpServers') || !config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) throw new Error('Invalid MCP configuration');
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (!/^[\w.-]{1,128}$/.test(name) || !server || typeof server !== 'object' || Array.isArray(server) || (server.enabled !== undefined && typeof server.enabled !== 'boolean')) throw new Error('Invalid MCP server configuration');
    if (typeof server.command === 'string') {
      if (Object.keys(server).some(key => !['command','args','env','enabled'].includes(key)) || !server.command.trim() || server.args !== undefined && (!Array.isArray(server.args) || server.args.some(arg => typeof arg !== 'string')) || server.env !== undefined && (!server.env || typeof server.env !== 'object' || Array.isArray(server.env) || Object.values(server.env).some(value => typeof value !== 'string'))) throw new Error('Invalid MCP stdio configuration');
    } else if (typeof server.url === 'string') {
      try { const url = new URL(server.url); if (!['http:','https:'].includes(url.protocol)) throw Error(); } catch { throw new Error('Invalid MCP HTTP configuration'); }
      if (Object.keys(server).some(key => !['url','headers','enabled'].includes(key)) || server.headers !== undefined && (!server.headers || typeof server.headers !== 'object' || Array.isArray(server.headers) || Object.values(server.headers).some(value => typeof value !== 'string'))) throw new Error('Invalid MCP HTTP configuration');
    } else throw new Error('Invalid MCP server configuration');
  }
  return config;
}
export async function connectMcp(config, signal) {
  const clients = [], tools = [], toolOwners = new Map();
  try {
    for (const [name, server] of Object.entries(validateMcpConfig(config).mcpServers)) {
      if (server.enabled === false) continue;
      const client = new Client({ name: 'sunday', version: '1.0.0' });
      const transport = server.command ? new StdioClientTransport({ command: server.command, args: server.args, env: { ...process.env, ...server.env } }) : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } });
      clients.push({ name, client, transport });
      signal.throwIfAborted();
      await client.connect(transport, { signal, timeout: 30000 });
      const listed = await client.listTools({}, { signal, timeout: 30000 });
      for (const tool of listed.tools) {
        const exposedName = `mcp_${name}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        if (toolOwners.has(exposedName)) throw new Error(`Duplicate MCP tool name: ${exposedName}`);
        toolOwners.set(exposedName, { client, name: tool.name });
        tools.push({ name: exposedName, description: tool.description || '', parameters: tool.inputSchema });
      }
    }
    return { tools, async call(name, args) { const entry = toolOwners.get(name); if (!entry) throw new Error('Unknown MCP tool'); return entry.client.callTool({ name: entry.name, arguments: args }, undefined, { signal, timeout: 60000 }); }, close: async () => Promise.allSettled(clients.map(({ client }) => client.close())) };
  } catch (error) { await Promise.allSettled(clients.map(({ client }) => client.close())); throw error; }
}
