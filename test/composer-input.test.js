import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/web/components/ComposerInput.jsx', import.meta.url), 'utf8');

test('chat composer textarea has a subtle surface and keyboard-only focus indicator', () => {
  assert.match(source, /<div class="relative rounded-box">/);
  assert.doesNotMatch(source, /focus-within:ring/);
  assert.match(source, /<textarea class="w-full resize-none rounded-box border-0 bg-black\/10 px-3 py-2 text-base-content shadow-none placeholder:text-base-content\/60 focus:border-0 focus:bg-black\/10 focus:shadow-none focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"/);
  assert.doesNotMatch(source, /<textarea class="[^\"]*\btextarea(?:-ghost)?\b/);
});
