import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
const personas = readFileSync(new URL('../src/web/components/Personas.jsx', import.meta.url), 'utf8');

test('settings modal uses a translucent dark backdrop', () => {
  assert.match(settings, /fixed inset-0 z-50 grid place-items-center bg-black\/50 p-4 transition-opacity duration-200/);
});

test('inactive settings forms cannot receive interaction', () => {
  for (const page of ['providers', 'connect', 'config', 'update']) {
    assert.ok(settings.includes(`inert={page !== '${page}'}`));
  }
  assert.match(personas, /<section inert=\{hidden\}/);
});
