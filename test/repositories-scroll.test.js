import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('repositories keep controls fixed while only the repository list scrolls', t => {
  const source = readFileSync(new URL('../src/web/components/Repositories.jsx', import.meta.url), 'utf8');
  assert.match(source, /class="[^"]*min-h-0[^\"]*overflow-hidden[^"]*"[^>]*id="repositories-page"/);
  assert.match(source, /id="repos-list" class="[^"]*min-h-0 flex-1[^\"]*overflow-y-auto overscroll-y-contain/);
  assert.match(source, /aria-label="Cloned repositories"/);
  assert.match(source, /id="repositories-page"[\s\S]*?<header/);
});
