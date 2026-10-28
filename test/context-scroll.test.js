import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('context page remains independently scrollable', t => {
  const dom = new JSDOM('<main><section class="context-page"></section></main>');
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const page = dom.window.getComputedStyle(dom.window.document.querySelector('.context-page'));
  assert.equal(page.overflowY, 'auto');
});
