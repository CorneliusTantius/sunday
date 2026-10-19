import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');

test('MCP settings page loads, edits, and saves MCP JSON with safety guidance', () => {
  assert.match(source, /id="settings-mcp-nav"/);
  assert.match(source, /request\('\/api\/mcp'\)/);
  assert.match(source, /jsonRequest\('\/api\/mcp', 'PUT', config\)/);
  assert.match(source, /JSON\.parse\(mcpConfig\)/);
  assert.match(source, /id="mcp-config"/);
  assert.match(source, /stdio servers execute code/);
  assert.match(source, /stored locally/);
  assert.match(source, /page === 'update' \|\| page === 'mcp'/);
  assert.match(source, /jsonRequest\(url, method, body\)/);
  assert.match(source, /\/api\/mcp\/login/);
  assert.match(source, /redirectUrl: mcpRedirect/);
  assert.match(source, /method === 'DELETE'/);
  assert.match(source, /setTimeout\(poll, 1200\)/);
});
