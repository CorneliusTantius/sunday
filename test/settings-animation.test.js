import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('visible settings pages animate without remounting their forms', () => {
  assert.match(css, /\.settings-detail > section:not\(\.hidden\)\s*\{\s*animation: settings-page-arrive 200ms/);
  assert.match(css, /@keyframes settings-page-arrive\s*\{\s*from \{ opacity: 0; transform: translateY\(6px\); \}\s*to \{ opacity: 1; transform: translateY\(0\); \}/);
});

test('settings page animation respects reduced motion', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.settings-detail > section:not\(\.hidden\) \{ animation: none; \}/);
});
