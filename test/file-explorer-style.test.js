import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/web/components/CodeEditor.jsx', import.meta.url), 'utf8');

test('explorer hides filename search but preserves directory controls', () => {
  const markup = component.slice(component.indexOf('  return <section'));
  assert.doesNotMatch(markup, /Search filenames|onSubmit=\{searchFiles\}|Matching files/);
  assert.match(markup, /onSubmit=\{changeDirectory\}/);
  assert.match(markup, /directoryContents\(''\)/);
});
