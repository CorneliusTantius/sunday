import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
const personas = readFileSync(new URL('../src/web/components/Personas.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('settings modal uses a translucent dark backdrop', () => {
  assert.match(settings, /fixed inset-0 z-50 grid place-items-center bg-black\/50 p-4 transition-opacity duration-300/);
});

test('settings modal animates open and close and respects reduced motion', () => {
  assert.ok(settings.includes("window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false"));
  assert.ok(settings.includes('requestAnimationFrame(() => setEntered(true))'));
  assert.match(settings, /transition-opacity duration-300 motion-reduce:transition-none \$\{closing \? 'ease-in' : 'ease-out'\}/);
  assert.match(settings, /transition-\[transform,opacity\] duration-300 motion-reduce:transition-none \$\{closing \? 'ease-in' : 'ease-out'\}/);
  assert.match(settings, /setTimeout\(onClose, reduced \? 0 : 340\)/);
  assert.match(settings, /event\.target === event\.currentTarget\) requestClose\(\)/);
  assert.match(settings, /id="close-settings"[^>]*onClick=\{requestClose\}/);
});

test('settings tab content animates in and respects reduced motion', () => {
  for (const [id, page] of [['provider', 'providers'], ['connect', 'connect'], ['config', 'config'], ['mcp', 'mcp']]) {
    assert.ok(settings.includes(`id="settings-${id}-page" class={page === '${page}' ? 'settings-view-enter' : 'hidden'}`));
  }
  assert.ok(settings.includes("class={page === 'update' ? 'grid gap-3 settings-view-enter' : 'hidden'}"));
  assert.match(personas, /class=\{`grid gap-5\$\{hidden \? ' hidden' : ' settings-view-enter'\}`\}/);
  assert.match(styles, /\.settings-view-enter \{ animation: settings-view-enter 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.page-enter, \.settings-view-enter \{ animation: none; \}/);
});

test('inactive settings forms cannot receive interaction', () => {
  for (const page of ['providers', 'connect', 'config', 'update']) {
    assert.ok(settings.includes(`inert={page !== '${page}'}`));
  }
  assert.match(personas, /<section inert=\{hidden\}/);
});
