import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('repositories keep controls fixed while only the repository list scrolls', t => {
  const dom = new JSDOM('<section class="repositories-page"><header class="repositories-header"></header><button class="repository-clone"></button><ul class="repos-list"></ul></section>');
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const computed = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
  assert.equal(computed('.repositories-page').overflow, 'hidden');
  assert.equal(computed('.repos-list').overflowY, 'auto');
  assert.equal(computed('.repos-list').minHeight, '0px');
});
