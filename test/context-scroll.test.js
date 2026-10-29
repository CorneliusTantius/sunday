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
  assert.match(memory, /class="mt-3 max-h-\[65vh\] min-w-0 space-y-4 overflow-auto"/);
  assert.match(memory, /rounded-xl flex-col items-start gap-1 overflow-hidden p-3 text-left/);
  assert.match(memory, /<strong class="min-w-0 flex-1 whitespace-normal break-words">\{item.title\}<\/strong>/);
  assert.match(memory, /badge badge-sm shrink-0 \$\{isAutomaticContextSource\(item\.source\) \? 'badge-secondary' : 'badge-outline'\}/);
  assert.match(memory, /isAutomaticContextSource\(item\.source\) \? 'Auto' : 'Intentional'/);
  assert.match(memory, /<span class="w-full min-w-0 whitespace-normal break-all">\{item.source\}<\/span>/);
  assert.match(memory, /<pre class="max-w-full whitespace-pre-wrap break-all">\{selected.content\}<\/pre>/);
  assert.match(memory, /role="group" aria-label="Filter notes by type"/);
  assert.match(memory, /aria-pressed=\{noteFilter === filter\.id\} onClick=\{\(\) => setNoteFilter\(filter\.id\)\}/);
  assert.match(memory, /filterContextNotes\(visibleSources, noteFilter\)/);
  assert.match(memory, /label: 'Intentional notes', notes: filteredNoteGroups\.intentional/);
  assert.match(memory, /label: 'Auto notes', notes: filteredNoteGroups\.automatic/);
  assert.match(memory, /layoutSeparatedContextGraph\(graph\.nodes, graph\.links\)/);
});
