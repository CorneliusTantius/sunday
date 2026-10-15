import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const socials = readFileSync(new URL('../src/web/components/Socials.jsx', import.meta.url), 'utf8');
const finance = readFileSync(new URL('../src/web/components/FinancialTracker.jsx', import.meta.url), 'utf8');

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

test('Financial tracker is a top-level sidebar page immediately below Socials', () => {
  assert.match(app, /id="socials-link"[\s\S]*?id="financial-tracker-link" href="#financial-tracker"/);
  assert.match(app, /location\.hash === '#financial-tracker' \? 'financial-tracker'/);
  assert.match(app, /page === 'financial-tracker' && <FinancialTracker \/>/);
  assert.match(app, /querySelector\('#financial-tracker-title'\)\?\.focus\(\)/);
  assert.match(finance, /id="financial-tracker-title" tabIndex="-1"/);
  assert.match(finance, /SAMPLE DATA/);
  assert.match(finance, /no accounts are linked/);
});
