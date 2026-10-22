import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const component = readFileSync(new URL('../src/web/components/CodeEditor.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
test('explorer hides filename search but preserves directory controls', () => {
  const markup = component.slice(component.indexOf('  return <section'));
  assert.doesNotMatch(markup, /Search filenames|onSubmit=\{searchFiles\}|Matching files/);
  assert.match(markup, /onSubmit=\{changeDirectory\}/);
  assert.match(markup, /directoryContents\(''\)/);
});
test('explorer has rounded rows and visible keyboard focus', () => {
  assert.match(css, /\.code-editor-directory-button, \.code-editor-file-button \{[^}]*border-radius: 12px/);
  assert.match(css, /\.code-editor-file-button:focus-visible/);
  assert.match(component, /code-editor-entry-icon/);
});
test('Files page enters with a smooth staggered animation', () => {
  assert.match(css, /\.code-editor-header \{[^}]*animation: files-heading-arrive 520ms/);
  assert.match(css, /\.code-editor-layout \{[^}]*animation: files-workspace-arrive 640ms[^}]*80ms both/);
  assert.match(css, /@keyframes files-heading-arrive/);
  assert.match(css, /@keyframes files-workspace-arrive/);
});
