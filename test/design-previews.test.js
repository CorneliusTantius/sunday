import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const socials = readFileSync(new URL('../src/web/components/Socials.jsx', import.meta.url), 'utf8');

test('scheduled job preview has a staggered page-entry animation', () => {
  assert.match(css, /\.scheduled-job-header \{ animation: scheduled-job-arrive/);
  assert.match(css, /\.scheduled-job-builder \{ animation: scheduled-job-arrive/);
  assert.match(css, /\.scheduled-job-summary \{ animation: scheduled-job-arrive/);
  assert.match(css, /@keyframes scheduled-job-arrive/);
});

test('Socials previews planned Slack and Gmail integrations without enabling connection actions', () => {
  assert.match(socials, /No platforms are connected yet\./);
  assert.match(socials, /Slack/);
  assert.match(socials, /Gmail/);
  assert.match(socials, /type="button" disabled>Coming soon/);
  assert.match(socials, /Example messages only/);
});

test('removed financial tracker has no navigation, route, or styles', () => {
  assert.doesNotMatch(app, /FinancialTracker|financial-tracker/);
  assert.doesNotMatch(css, /financial-/);
});
