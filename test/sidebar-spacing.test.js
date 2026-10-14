import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
test('sidebar destinations share a row height and consistent sibling spacing', () => {
  assert.match(css, /\.feature-heading \{[^}]*min-height: 52px/);
  assert.match(css, /\.sidebar > :is\(\.feature-heading, \.agents-feature\) \+ :is\(\.feature-heading, \.agents-feature\) \{ margin-top: 8px; \}/);
  assert.match(css, /\.sidebar > \.feature-heading, \.sidebar > \.agents-feature \{ flex-shrink: 0; \}/);
});

test('standalone menu links group icons and labels like the agents link', () => {
  assert.match(css, /\.feature-link \{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 10px;/);
  assert.match(css, /\.feature-heading\.feature-link \{ justify-content: flex-start; \}/);
  // The agents heading still reserves the opposite edge for its disclosure button.
  assert.match(css, /\.feature-heading \{[^}]*justify-content: space-between;/);
});

test('nested agents use smaller text, avatars and spacing than parent navigation', () => {
  assert.match(css, /\.agents-sessions \.new-chat \{ height: 32px; padding: 0 10px; font-size: 13px;/);
  assert.match(css, /\.agents-sessions \.sessions-list \{ gap: 6px; \}/);
  assert.match(css, /\.agents-sessions \.session-row \{[^}]*repeat\(2, 24px\); gap: 2px; padding: 8px;/);
  assert.match(css, /\.agents-sessions \.session-row \.avatar-character \{ width: 22px; height: 22px; \}/);
  assert.match(css, /\.agents-sessions \.session-row \.session-item \{ padding: 2px; font-size: 13px; \}/);
});
