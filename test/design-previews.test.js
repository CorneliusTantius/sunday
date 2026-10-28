import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
const socials = readFileSync(new URL('../src/web/components/Socials.jsx', import.meta.url), 'utf8');

test('Socials previews planned Slack and Gmail integrations without enabling connection actions', () => {
  assert.match(socials, /No platforms are connected yet\./);
  assert.match(socials, /Slack/);
  assert.match(socials, /Gmail/);
  assert.match(socials, /type="button" disabled>Coming soon/);
  assert.match(socials, /Example messages only/);
});

test('removed financial tracker has no navigation or route', () => {
  assert.doesNotMatch(app, /FinancialTracker|financial-tracker/);
});
