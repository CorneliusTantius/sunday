import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
const personas = readFileSync(new URL('../src/web/components/Personas.jsx', import.meta.url), 'utf8');

test('settings crossfade keeps outgoing pages paintable but out of flow', () => {
  assert.match(css, /\.settings-detail > section\.hidden\s*\{[^}]*display: block !important;[^}]*position: absolute;[^}]*opacity: 0;[^}]*visibility: hidden;[^}]*pointer-events: none;[^}]*visibility 0s 240ms;/);
  assert.match(css, /\.settings-detail > section\s*\{[^}]*opacity: 1;[^}]*transition: opacity 240ms/);
  assert.doesNotMatch(css, /animation: settings-page-arrive/);
});

test('inactive forms are inert throughout the outgoing transition', () => {
  for (const page of ['providers', 'connect', 'config', 'update']) {
    assert.ok(settings.includes(`inert={page !== '${page}'}`));
  }
  assert.match(personas, /<section inert=\{hidden\}/);
});

test('settings crossfade respects reduced motion', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.settings-detail > section,\s*\.settings-detail > section\.hidden \{ transition: none; \}/);
});
