import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
const personas = readFileSync(new URL('../src/web/components/Personas.jsx', import.meta.url), 'utf8');

test('settings modal uses a translucent dark backdrop', () => {
  assert.match(settings, /fixed inset-0 z-50 grid place-items-center bg-black\/50 p-4 transition-opacity duration-200/);
});

test('settings modal animates open and close and respects reduced motion', () => {
  assert.ok(settings.includes("window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false"));
  assert.ok(settings.includes('requestAnimationFrame(() => setEntered(true))'));
  assert.match(settings, /transition-opacity duration-200 motion-reduce:transition-none \$\{entered && !closing \? 'opacity-100' : 'pointer-events-none opacity-0'\}/);
  assert.match(settings, /transition-\[transform,opacity\] duration-200 ease-out motion-reduce:transition-none \$\{entered && !closing \? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'\}/);
  assert.match(settings, /setTimeout\(onClose, reduced \? 0 : 240\)/);
  assert.match(settings, /event\.target === event\.currentTarget\) requestClose\(\)/);
  assert.match(settings, /id="close-settings"[^>]*onClick=\{requestClose\}/);
});

test('inactive settings forms cannot receive interaction', () => {
  for (const page of ['providers', 'connect', 'config', 'update']) {
    assert.ok(settings.includes(`inert={page !== '${page}'}`));
  }
  assert.match(personas, /<section inert=\{hidden\}/);
});
