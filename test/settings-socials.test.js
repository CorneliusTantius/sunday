import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('Socials has settings navigation and a conditional placeholder page', () => {
  assert.match(settings, /id="settings-socials-nav" onClick=\{\(\) => navigate\('socials'\)\}>Socials/);
  assert.match(settings, /id="settings-socials-page" class=\{`settings-section\$\{page === 'socials' \? '' : ' hidden'\}`\}/);
  assert.match(settings, /No platforms are connected yet/);
  assert.match(settings, /page === 'socials' \|\| page === 'update' \? ' hidden'/);
});

test('Update description has dedicated spacing before its action', () => {
  assert.match(css, /#settings-update-page > \.field-note\s*\{\s*margin-bottom: 20px;/);
});
