import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('context page remains independently scrollable', t => {
  const memory = readFileSync(new URL('../src/web/components/Memory.jsx', import.meta.url), 'utf8');
  assert.match(memory, /<section class="mx-auto w-full max-w-6xl min-h-0 overflow-y-auto[^\"]*" aria-labelledby="context-title">/);
  assert.match(memory, /aria-labelledby="context-title"/);
});

test('notes list rows use moderate corners and contain long note text', () => {
  const memory = readFileSync(new URL('../src/web/components/Memory.jsx', import.meta.url), 'utf8');
  assert.match(memory, /<ul class="mt-3 grid max-h-\[65vh\] min-w-0 list-none gap-2 overflow-auto p-0">/);
  assert.match(memory, /rounded-box flex-col items-start gap-1 overflow-hidden p-3 text-left/);
  assert.match(memory, /<strong class="w-full min-w-0 whitespace-normal break-words">\{item.title\}<\/strong>/);
  assert.match(memory, /<span class="w-full min-w-0 whitespace-normal break-all">\{item.source\}<\/span>/);
  assert.match(memory, /<pre class="max-w-full whitespace-pre-wrap break-all">\{selected.content\}<\/pre>/);
});
