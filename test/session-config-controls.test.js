import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/web/components/SessionConfig.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('agent settings has an enlarged top X and no redundant bottom Cancel button', () => {
  assert.match(source, /class="btn btn-ghost btn-square text-2xl" id="close-session-config"/);
  assert.doesNotMatch(source, /id="cancel-session-config"/);
});

test('agent settings dialog animates backdrop and X dismissal and respects reduced motion', () => {
  assert.match(source, /class=\{`modal session-config-dialog \$\{closing \? 'session-config-dialog-exit' : 'session-config-dialog-enter'\}`\}/);
  assert.match(source, /if \(event\.target === dialog\.current\) animateClose\(\)/);
  assert.match(source, /id="close-session-config"[^>]*onClick=\{animateClose\}/);
  assert.match(source, /const reduced = typeof window !== 'undefined' && window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(source, /\}, reduced \? 0 : 180\)/);
  assert.match(styles, /\.session-config-dialog-exit::backdrop \{ animation: agent-settings-backdrop-out 180ms ease-in both; \}/);
  assert.match(styles, /\.session-config-dialog-exit \.modal-box \{ animation: agent-settings-panel-out 180ms cubic-bezier\(0\.4, 0, 1, 1\) both;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.session-config-dialog-enter::backdrop,[\s\S]*?\.session-config-dialog-exit \.modal-box \{ animation: none; will-change: auto; \}/);
});

test('agent settings fields use a darker surface and a Nord-primary keyboard focus indicator', () => {
  for (const id of ['session-config-title', 'session-config-persona', 'session-config-model', 'session-config-thinking']) {
    const control = source.match(new RegExp(`<(?:input|select)[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(control, `missing settings control ${id}`);
    assert.match(control, /bg-black\/10/, `${id} needs a darker surface`);
    assert.match(control, /focus:bg-black\/10/, `${id} should keep its dark focus background`);
    assert.match(control, /focus:shadow-none/, `${id} should not show the default focus shadow`);
    assert.match(control, /focus:outline-none/, `${id} should suppress the default focus outline`);
    assert.match(control, /focus-visible:outline-2[^\"]*focus-visible:outline-primary/, `${id} needs a visible Nord-primary keyboard focus indicator`);
  }
});
