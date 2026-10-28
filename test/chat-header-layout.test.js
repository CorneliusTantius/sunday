import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
const character = readFileSync(new URL('../src/web/components/Character.jsx', import.meta.url), 'utf8');

test('chat header keeps accessible unlabeled model and thinking dropdowns', () => {
  const row = app.match(/<div class="flex min-w-0 flex-nowrap items-center gap-2 pt-3">([\s\S]*?)<\/div>/);
  assert.ok(row, 'model and thinking selectors should share a non-wrapping row');
  const controls = row[1];
  assert.match(controls, /<select class="select select-sm min-w-0 flex-\[2\] bg-base-200" id="chat-model" aria-label="Model"/);
  assert.match(controls, /<select class="select select-sm min-w-0 flex-1 bg-base-200" id="thinking-level" aria-label="Thinking"/);
  assert.doesNotMatch(controls, /<label|>MODEL<|>THINKING</);
});

test('chat activity and assistant avatar stay compact and top-aligned on mobile', () => {
  assert.match(app, /badge badge-ghost badge-sm mb-2 h-auto max-w-full whitespace-normal px-2 py-1 text-\[11px\] leading-tight" id="response-activity"/);
  assert.match(app, /class="avatar shrink-0 self-start"><Character profile=\{profile \|\| \{\}\} mobileCompact \/>/);
  assert.match(character, /mobileCompact \? 'max-\[700px\]:h-7 max-\[700px\]:w-7'/);
});

test('sidebar brand is a larger text-only title', () => {
  assert.match(app, /class="navbar-start flex min-w-0 items-center text-2xl font-bold tracking-tight[^"]*"[^>]*>Sunday<\/a>/);
  assert.doesNotMatch(app, /navbar-start[^\n]*<Character brand/);
});

test('scroll-to-latest has no outlined border', () => {
  const button = app.match(/<button class="([^\"]+)" id="scroll-to-latest"/)?.[1];
  assert.ok(button);
  assert.ok(button.includes('btn-ghost'));
  assert.ok(!button.includes('btn-outline'));
});

test('greeting is larger and context/token details are slightly smaller', () => {
  assert.match(app, /<h1 class="text-3xl font-semibold tracking-tight" id="welcome-greeting">/);
  const contextLine = app.match(/<div class="mb-1 flex justify-between gap-3 text-\[11px\] text-base-content\/70">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(contextLine);
  assert.match(contextLine, /CONTEXT/);
  assert.match(contextLine, /TOKENS/);
});
