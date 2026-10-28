import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('viewport layout confines scrolling to chat history and repository content', t => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const repositories = readFileSync(new URL('../src/web/components/Repositories.jsx', import.meta.url), 'utf8');
  assert.match(app, /h-dvh min-h-0 overflow-hidden/);
  assert.match(app, /<main class="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">/);
  assert.match(app, /ref=\{transcript\} class=\{`[^`]*min-h-0[^`]*flex-1[^`]*overflow-y-auto[^`]*`\}[^>]*id="conversation"/);
  assert.match(repositories, /<section class="[^"]*min-h-0[^\"]*overflow-hidden[^\"]*" id="repositories-page"/);
  assert.match(repositories, /id="repos-list" class="[^"]*min-h-0 flex-1[^\"]*overflow-y-auto overscroll-y-contain/);
  assert.match(app, /id="messages"/);
});
