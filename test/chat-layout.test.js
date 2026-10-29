import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('viewport layout confines scrolling to chat history and repository content', t => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const repositories = readFileSync(new URL('../src/web/components/Repositories.jsx', import.meta.url), 'utf8');
  assert.match(app, /h-dvh w-full min-h-0 overflow-hidden/);
  assert.match(app, /<main key=\{page\} class=\{`relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden motion-reduce:animate-none \$\{pagePhase === 'exit' \? 'page-exit' : 'page-enter'\}`\} inert=\{pagePhase === 'exit'\}>/);
  assert.match(app, /ref=\{transcript\} class=\{`[^`]*min-h-0[^`]*flex-1[^`]*overflow-y-auto[^`]*`\}[^>]*id="conversation"/);
  assert.match(repositories, /<section class="[^"]*min-h-0[^\"]*overflow-hidden[^\"]*" id="repositories-page"/);
  assert.match(repositories, /id="repos-list" class="[^"]*min-h-0 flex-1[^\"]*overflow-y-auto overscroll-y-contain/);
  assert.match(app, /id="messages"/);
  assert.match(app, /class=\{`flex flex-col gap-6 \$\{messages\.length \? 'py-6' : ''\}`\} id="messages"/);
  const styles = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  assert.match(styles, /@keyframes page-enter/);
  assert.match(styles, /@keyframes page-exit/);
  assert.match(styles, /\.page-exit \{ animation: page-exit 140ms ease-in both; pointer-events: none; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.page-enter, \.page-exit, \.settings-view-enter \{ animation: none; \}/);
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /<html[^>]*class="h-full w-full overflow-hidden/);
  assert.match(html, /<body[^>]*class="h-full w-full overflow-hidden/);
  assert.match(html, /id="app" class="h-full w-full overflow-hidden"/);
  assert.doesNotMatch(html, /100vw/);
  assert.match(app, /class="[^"]*text-xl[^"]*" id="open-settings"/);
  assert.doesNotMatch(app, /<MenuIcon[^>]*class=/);
});
