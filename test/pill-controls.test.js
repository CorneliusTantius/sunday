import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const adjustments = css.slice(css.indexOf('/* Settings pills retain definition'));

test('settings pills have outlines and preserve active and focus states', () => {
  assert.match(adjustments, /\.settings-modal \.select, \.settings-modal input\.text-input\s*\{[^}]*border-color: var\(--line\)/);
  assert.match(adjustments, /\.settings-modal \.settings-nav\.active\s*\{[^}]*border-color: var\(--violet\)/);
  assert.match(adjustments, /\.settings-modal \.secondary-button:hover\s*\{ border-color: var\(--highlight\)/);
});

test('chat selectors are compact without shrinking desktop text or settings fields', () => {
  assert.match(adjustments, /\.chat-model, \.thinking-level\s*\{\s*height: 36px;\s*padding-inline: 12px;\s*font-size: 16px;/);
  assert.match(adjustments, /\.chat-model \{ flex: 0 1 240px; max-width: 240px;/);
  assert.match(adjustments, /\.thinking-level \{ width: 110px; flex-shrink: 0;/);
  assert.match(adjustments, /appearance: none/);
});

test('mobile chat selectors stay slim in one row with a flexible model width', () => {
  assert.match(adjustments, /@media \(max-width: 700px\)\s*\{\s*\.composer-controls \{ flex-wrap: nowrap; gap: 6px; \}\s*\.chat-model, \.thinking-level \{ height: 30px; padding-inline: 8px; font-size: 14px; \}\s*\.chat-model \{ flex: 1; max-width: none; \}\s*\.thinking-level \{ width: 90px; \}/);
});
