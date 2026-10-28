import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/web/components/ToolCalls.jsx', import.meta.url), 'utf8');

test('tool calls dialog remains accessible and responds to cancel', () => {
  assert.match(jsx, /onCancel=\{event => \{ event\.preventDefault\(\); close\(\); \}\}/);
  assert.match(jsx, /aria-label="Close tool calls" onClick=\{close\}/);
});
