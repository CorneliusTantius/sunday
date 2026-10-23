import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('repositories keep controls fixed while only the repository list scrolls without a scrollbar', () => {
  assert.match(css, /\.repositories-page\s*\{[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.repositories-header\s*\{[^}]*flex:\s*none;/s);
  assert.match(css, /\.repository-clone\s*\{[^}]*flex:\s*none;/s);
  assert.match(css, /\.repositories-page \.repos-list\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*scrollbar-width:\s*none;/s);
  assert.match(css, /\.repositories-page \.repos-list::-webkit-scrollbar\s*\{[^}]*display:\s*none;/s);
});
