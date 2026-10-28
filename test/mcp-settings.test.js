import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');

const editor = readFileSync(new URL('../src/web/components/McpServers.jsx', import.meta.url), 'utf8');

test('MCP settings lists servers and edits configuration in a modal', () => {
  assert.match(source, /id="settings-mcp-nav"/);
  assert.match(source, /request\('\/api\/mcp'\)/);
  assert.match(source, /jsonRequest\('\/api\/mcp', 'PUT', config\)/);
  assert.doesNotMatch(source, /id="mcp-config"/);
  assert.match(editor, /Object\.entries\(servers\)/);
  assert.match(editor, /dialog\.current\.showModal\(\)/);
  assert.match(editor, /<form onSubmit=\{submit\}/);
  assert.match(editor, /A server with this name already exists/);
  assert.match(editor, /stdio servers execute code/);
  assert.match(editor, /stored locally/);
  assert.match(editor, /\.\.\.draft\.server/);
  assert.match(editor, /delete next\[name\]/);
  assert.ok(source.includes("page === 'connect' ? '' : ' hidden'"));
  assert.match(source, /jsonRequest\(url, method, body\)/);
  assert.match(source, /\/api\/mcp\/login/);
  assert.match(source, /redirectUrl: mcpRedirect/);
  assert.match(source, /method === 'DELETE'/);
  assert.match(source, /setTimeout\(poll, 1200\)/);
});
