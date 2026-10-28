import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/web/components/ComposerInput.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('chat composer textarea stays borderless when keyboard-focused', () => {
  assert.match(source, /<div class="relative rounded-box">/);
  assert.doesNotMatch(source, /focus-within:ring/);
  assert.match(source, /<textarea class="w-full resize-none rounded-box border-0 bg-transparent px-3 py-2 text-base-content shadow-none placeholder:text-base-content\/60 focus:border-0 focus:bg-transparent focus:shadow-none focus:outline-none"/);
  assert.doesNotMatch(source, /<textarea class="[^\"]*\btextarea(?:-ghost)?\b/);
  assert.match(styles, /#prompt:focus-visible \{\s*outline: none;\s*caret-color: var\(--color-primary\);/);
});
