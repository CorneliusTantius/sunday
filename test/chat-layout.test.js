import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('viewport layout confines scrolling to chat history and repository content', t => {
  const dom = new JSDOM(`<div id="app"><div class="app-shell"><main class="main">
    <section class="conversation"><div class="messages"><div class="message assistant"><div class="assistant-content"><div class="message-bubble"></div></div></div></div></section>
    <div class="composer-wrap"></div><section class="repositories-page"><ul class="repos-list"></ul></section>
  </main></div></div>`);
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const css = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
  for (const selector of ['html', 'body', '#app']) assert.equal(css(selector).overflow, 'hidden');
  assert.equal(css('.app-shell').overflow, 'hidden');
  assert.equal(css('.main').minHeight, '0px');
  assert.equal(css('.main').overflow, 'hidden');
  assert.equal(css('.repositories-page').overflow, 'hidden');
  for (const selector of ['.conversation', '.repositories-page .repos-list']) {
    assert.equal(css(selector).minHeight, '0px');
    assert.equal(css(selector).overflowY, 'auto');
    assert.equal(css(selector).getPropertyValue('overscroll-behavior-y'), 'contain');
  }
  assert.equal(css('.assistant .message-bubble').maxWidth, '100%');
});
