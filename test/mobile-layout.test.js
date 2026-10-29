import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('mobile content remains wrapped and contained', t => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const bubble = readFileSync(new URL('../src/web/components/MessageBubble.js', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
  assert.match(app, /max-\[700px\]:fixed[^\"]*max-\[700px\]:w-\[min\(20rem,85vw\)\]/);
  assert.match(bubble, /max-sm:max-w-\[90%\]/);
  assert.match(bubble, /\[&_pre\]:max-w-full[\s\S]*?\[&_pre\]:overflow-x-auto[\s\S]*?\[&_pre\]:whitespace-pre/);
  assert.match(settings, /flex-wrap gap-2/);
});
