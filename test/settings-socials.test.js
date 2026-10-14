import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
const socials = readFileSync(new URL('../src/web/components/Socials.jsx', import.meta.url), 'utf8');

test('Socials is a sidebar page rather than a settings section', () => {
  assert.match(app, /id="socials-link" href="#socials"/);
  assert.match(app, /location.hash === '#socials' \? 'socials'/);
  assert.match(app, /page === 'socials' && <Socials \/>/);
  assert.match(app, /querySelector\('#socials-title'\)\?\.focus\(\)/);
  assert.match(socials, /id="socials-title" tabIndex="-1"/);
  assert.match(socials, /No platforms are connected yet/);
  assert.doesNotMatch(settings, /settings-socials|page === 'socials'/);
});

test('Update description has dedicated spacing before its action', () => {
  assert.match(css, /#settings-update-page > \.field-note\s*\{\s*margin-bottom: 20px;/);
});
