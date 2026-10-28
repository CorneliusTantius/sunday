import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');

test('Agents list is always visible below Socials with a divider', () => {
  const sidebar = app.slice(app.indexOf('<ul class="menu menu-sm'), app.indexOf('<main '));
  const socials = sidebar.indexOf('id="socials-link"');
  const divider = sidebar.indexOf('<hr class="my-1 border-base-300" />');
  const heading = sidebar.indexOf('<h2 id="agents-heading"');
  const sessions = sidebar.indexOf('id="sessions-list"');
  assert.ok(socials >= 0 && divider > socials && heading > divider && sessions > heading);
  assert.match(sidebar, /<h2 id="agents-heading"[^>]*>Agents<\/h2>/);
  assert.doesNotMatch(sidebar, /agents-toggle|Sunday Agents|inert=\{!expanded\}/);
  assert.equal((sidebar.match(/<hr/g) || []).length, 1, 'only one intended sidebar separator');
  assert.match(sidebar, /id="sessions-list"[^>]*>[\s\S]*id="new-chat"[\s\S]*pinnedSessions\.map/);
  assert.match(sidebar, /class="btn btn-ghost btn-sm justify-start border border-base-300[^\"]*" id="new-chat"/);
  const gearStart = app.indexOf('title="Configure agent"');
  const gearEnd = app.indexOf('</button>', gearStart);
  assert.ok(gearStart >= 0 && gearEnd > gearStart);
  assert.match(app.slice(gearStart, gearEnd), /<svg[^>]*width="16" height="16"/);
});
