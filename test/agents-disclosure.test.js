import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');

test('Agents list is always visible below Socials with a divider', () => {
  const sidebar = app.slice(app.indexOf('<ul class="menu menu-sm'), app.indexOf('<main '));
  const socials = sidebar.indexOf('id="socials-link"');
  const divider = sidebar.indexOf('<hr class="divider my-1" />');
  const heading = sidebar.indexOf('<h2 id="agents-heading"');
  const sessions = sidebar.indexOf('id="sessions-list"');
  assert.ok(socials >= 0 && divider > socials && heading > divider && sessions > heading);
  assert.match(sidebar, /<h2 id="agents-heading"[^>]*>Agents<\/h2>/);
  assert.doesNotMatch(sidebar, /agents-toggle|Sunday Agents|inert=\{!expanded\}/);
});
