import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/web/components/ToolCalls.jsx', import.meta.url), 'utf8');

test('tool call status badges stay compact and code cards do not show mockup dots', () => {
  assert.match(jsx, /badge badge-sm max-w-full flex-none whitespace-nowrap px-2 text-\[10px\] leading-tight[\s\S]*\? 'badge-info'/);
  assert.doesNotMatch(jsx, /mockup-code/);
  assert.equal((jsx.match(/rounded-box border border-base-300 bg-base-200 p-3 font-mono text-xs/g) || []).length, 2);
});

test('tool calls dialog remains accessible and responds to cancel', () => {
  assert.match(jsx, /onCancel=\{event => \{ event\.preventDefault\(\); close\(\); \}\}/);
  assert.match(jsx, /aria-label="Close tool calls" onClick=\{close\}/);
});
