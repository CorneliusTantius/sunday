import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');

test('agents disclosure stays mounted and transitions both directions', () => {
  assert.match(app, /agents-sessions\$\{expanded \? ' expanded' : ''\}/);
  assert.match(app, /inert=\{!expanded\} aria-hidden=\{!expanded\}/);
  assert.match(app, /class="agents-sessions-content"/);
  assert.match(css, /\.agents-sessions\s*\{[^}]*grid-template-rows: 0fr[^}]*visibility 0s linear 240ms/s);
  assert.match(css, /\.agents-sessions\.expanded\s*\{[^}]*grid-template-rows: 1fr[^}]*transition-delay: 0s/s);
  assert.match(css, /\.agents-sessions-content\s*\{[^}]*min-height: 0; overflow: hidden/s);
  assert.doesNotMatch(css, /agents-sessions:not\(\.hidden\)/);
});

test('composer uses rounder desktop and mobile corners', () => {
  assert.match(css, /\.composer \{ padding: 16px 22px 12px; border-radius: 40px; \}/);
  assert.match(css, /\.composer \{ padding: 12px 16px; border-radius: 32px; \}/);
});
