import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('context page remains independently scrollable', t => {
  const memory = readFileSync(new URL('../src/web/components/Memory.jsx', import.meta.url), 'utf8');
  assert.match(memory, /<section class="mx-auto w-full max-w-6xl min-h-0 overflow-y-auto[^\"]*" aria-labelledby="context-title">/);
  assert.match(memory, /aria-labelledby="context-title"/);
});
