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
  assert.match(memory, /import \{ renderMarkdown \} from '\.\/MessageBubble\.js';/);
  assert.match(memory, /dangerouslySetInnerHTML=\{\{ __html: renderMarkdown\(selected\.content\) \}\}/);
  assert.match(memory, /role="group" aria-label="Filter notes by type"/);
  assert.match(memory, /aria-pressed=\{noteFilter === filter\.id\} onClick=\{\(\) => setNoteFilter\(filter\.id\)\}/);
  assert.match(memory, /<span class="ml-1 text-xs tabular-nums opacity-80">\{filter\.count\}<\/span>/);
  assert.match(memory, /<span class="text-sm font-normal tabular-nums opacity-70">\{group\.notes\.length\}<\/span>/);
  assert.match(memory, /<strong class="font-semibold text-base-content tabular-nums">\{sources\.length\}<\/strong>/);
  assert.doesNotMatch(memory, /class="badge[^\"]*">\{(?:filter\.count|group\.notes\.length|visibleSources\.length|sources\.length)\}<\/span>/);
  assert.match(memory, /filterContextNotes\(visibleSources, noteFilter\)/);
  assert.match(memory, /label: 'Intentional notes', notes: filteredNoteGroups\.intentional/);
  assert.match(memory, /label: 'Auto notes', notes: filteredNoteGroups\.automatic/);
  assert.match(memory, /layoutSeparatedContextGraph\(graph\.nodes, graph\.links, mobileGraph\)/);
});
