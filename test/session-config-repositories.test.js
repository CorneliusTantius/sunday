import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/web/components/SessionConfig.jsx', import.meta.url), 'utf8');

test('allowed repositories use an even responsive grid and wrap long names', () => {
  assert.match(source, /id="session-config-repos" class="max-h-56 overflow-y-auto[^\"]*"/);
  assert.match(source, /class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-\[repeat\(2,minmax\(0,1fr\)\)\]"/);
  assert.match(source, /label key=\{repo\.name\} class="label min-w-0 cursor-pointer justify-start gap-3/);
  assert.match(source, /<span class="min-w-0 break-words">\{repo\.name\}<\/span>/);
  assert.match(source, /type="checkbox" value=\{repo\.name\} checked=\{allowed\.includes\(repo\.name\)\} disabled=\{busy\}/);
});
