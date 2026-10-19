import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMcpConfig } from '../src/server/mcp.js';

test('validates stdio and HTTP MCP server configuration', () => {
  assert.deepEqual(validateMcpConfig({ mcpServers: { local: { command: 'node', args: ['server.js'], env: { TOKEN: 'x' } }, remote: { url: 'https://example.com/mcp', headers: { Authorization: 'x' } } } }).mcpServers.remote.url, 'https://example.com/mcp');
  for (const config of [{}, { mcpServers: { a: { command: '' } } }, { mcpServers: { a: { url: 'file:///etc/passwd' } } }, { mcpServers: { a: { command: 'x', enabled: 'yes' } } }]) assert.throws(() => validateMcpConfig(config));
});
