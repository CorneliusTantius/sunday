import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
const personas = readFileSync(new URL('../src/web/components/Personas.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('settings modal uses a translucent dark backdrop', () => {
  assert.match(settings, /pointer-events-none absolute inset-0 bg-black\/50/);
});

test('settings modal animates efficiently and respects reduced motion', () => {
  assert.doesNotMatch(settings, /setEntered|requestAnimationFrame/);
  assert.match(settings, /aria-hidden="true" class=\{`pointer-events-none absolute inset-0 bg-black\/50 \$\{closing \? 'settings-backdrop-exit' : 'settings-backdrop-enter'\}`\}/);
  assert.match(settings, /relative z-10[^\"]*\$\{closing \? 'settings-modal-exit' : 'settings-modal-enter'\}/);
  assert.match(styles, /\.settings-backdrop-enter \{ animation: settings-backdrop-in 240ms ease-out both; will-change: opacity; \}/);
  assert.match(styles, /\.settings-modal-enter \{ animation: settings-modal-in 280ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both; will-change: transform, opacity; \}/);
  assert.match(styles, /\.settings-modal-exit \{ animation: settings-modal-out 220ms cubic-bezier\(0\.4, 0, 1, 1\) both; will-change: transform, opacity; \}/);
  assert.match(settings, /setTimeout\(onClose, reduced \? 0 : 240\)/);
  assert.match(settings, /event\.target === event\.currentTarget\) requestClose\(\)/);
  assert.match(settings, /id="close-settings"[^>]*onClick=\{requestClose\}/);
  assert.match(styles, /\.settings-backdrop-enter, \.settings-backdrop-exit, \.settings-modal-enter, \.settings-modal-exit \{ animation: none; will-change: auto; \}/);
});

test('settings fills the mobile viewport with compact scrollable section navigation', () => {
  assert.match(settings, /grid place-items-center p-0 sm:p-4/);
  assert.match(settings, /h-\[100dvh\] max-h-\[100dvh\][^\"]*rounded-none border-0[^\"]*sm:rounded-box/);
  assert.doesNotMatch(settings.match(/<section class=\{`card relative z-10[\s\S]*?aria-labelledby="settings-title"/)?.[0] || '', /sm:border|border-base-300/);
  assert.match(settings, /grid h-full min-h-0 grid-cols-1 gap-3 px-2\.5 py-3 sm:grid-cols-/);
  assert.match(settings, /min-w-0 min-h-0 gap-1 overflow-x-auto/);
  assert.equal((settings.match(/btn-ghost btn-sm w-max sm:w-full/g) || []).length, 4);
});

test('settings tab content animates in and respects reduced motion', () => {
  for (const [id, page] of [['provider', 'providers'], ['connect', 'connect'], ['config', 'config']]) {
    assert.ok(settings.includes(`id="settings-${id}-page" class={page === '${page}' ? 'settings-view-enter' : 'hidden'}`));
  }
  assert.ok(settings.includes("class={page === 'update' ? 'grid gap-3 settings-view-enter' : 'hidden'}"));
  assert.match(personas, /class=\{`grid gap-5\$\{hidden \? ' hidden' : ' settings-view-enter'\}`\}/);
  assert.match(styles, /\.settings-view-enter \{ animation: settings-view-enter 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.page-enter, \.page-exit, \.settings-view-enter \{ animation: none; \}/);
});

test('inactive settings forms cannot receive interaction', () => {
  for (const page of ['providers', 'connect', 'config', 'update']) {
    assert.ok(settings.includes(`inert={page !== '${page}'}`));
  }
  assert.match(personas, /<section inert=\{hidden\}/);
});
