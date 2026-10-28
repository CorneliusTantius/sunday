import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');

test('chat header keeps accessible unlabeled model and thinking dropdowns', () => {
  const controls = app.match(/<div class="flex flex-wrap items-center gap-2 pt-3">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(controls);
  assert.match(controls, /<select[^>]*id="chat-model" aria-label="Model"/);
  assert.match(controls, /<select[^>]*id="thinking-level" aria-label="Thinking"/);
  assert.doesNotMatch(controls, /<label|>MODEL<|>THINKING</);
});

test('greeting is larger and context/token details are slightly smaller', () => {
  assert.match(app, /<h1 class="text-3xl font-semibold tracking-tight" id="welcome-greeting">/);
  const contextLine = app.match(/<div class="mb-1 flex justify-between gap-3 text-\[11px\] text-base-content\/70">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(contextLine);
  assert.match(contextLine, /CONTEXT/);
  assert.match(contextLine, /TOKENS/);
});
