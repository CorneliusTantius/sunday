import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('hides native scrollbar indicators globally without disabling scrolling', () => {
  assert.match(css, /\*\s*\{[^}]*scrollbar-width:\s*none;[^}]*-ms-overflow-style:\s*none;/s);
  assert.match(css, /\*::-webkit-scrollbar\s*\{[^}]*display:\s*none;[^}]*width:\s*0;[^}]*height:\s*0;/);
  assert.doesNotMatch(css, /^\*\s*\{[^}]*scrollbar-color:/m);

  for (const selector of ['.conversation', '.settings-detail', '.sidebar-scroll', '.context-page', '.code-editor-sidebar']) {
    assert.match(css, new RegExp(`${selector.replaceAll('.', '\\.')}[^\\{]*\\{[^}]*overflow(?:-y)?:\\s*(?:auto|scroll)`, 's'));
  }
});
