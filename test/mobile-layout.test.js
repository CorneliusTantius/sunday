import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('mobile styles reduce spacing and text size while keeping controls and long content contained', t => {
  const dom = new JSDOM(`<main>
    <section class="conversation"><div class="messages"><div class="message assistant"><div class="avatar"><div class="avatar-character"></div></div><div class="message-bubble"></div></div></div></section>
    <div class="composer-wrap"><div class="composer"><textarea></textarea></div></div>
    <div class="settings-providers"><button class="settings-nav"></button></div>
    <div class="context-meter-label"></div><div class="code-row"></div>
    <div class="settings-page-heading"></div><div class="toast"></div>
    <select class="select chat-model"></select><select class="select thinking-level"></select>
  </main>`);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  document.head.append(style);
  // JSDOM does not evaluate media queries: apply matching mobile rules in source order.
  const mobile = document.createElement('style');
  mobile.textContent = [...style.sheet.cssRules].flatMap(rule => {
    if (!rule.conditionText) return [rule.cssText];
    if (/^\(max-width:\s*700px\)$/.test(rule.conditionText)) {
      return [...rule.cssRules].map(child => child.cssText);
    }
    return [];
  }).join('\n');
  style.remove();
  document.head.append(mobile);
  const css = selector => dom.window.getComputedStyle(document.querySelector(selector));
  assert.equal(css('.conversation').width, 'calc(100% - 32px)');
  assert.equal(css('.composer-wrap').width, 'calc(100% - 32px)');
  assert.equal(css('.messages').paddingTop, '72px');
  assert.equal(css('.messages').paddingBottom, '24px');
  assert.equal(css('.message').fontSize, '16px');
  assert.equal(css('.message').gap, '6px');
  for (const selector of ['.avatar', '.avatar-character']) {
    assert.equal(css(selector).width, '22px');
    assert.equal(css(selector).height, '22px');
  }
  assert.equal(css('.assistant .message-bubble').maxWidth, '100%');
  for (const selector of ['textarea', '.chat-model', '.thinking-level']) {
    assert.equal(css(selector).fontSize, '16px', `${selector} must avoid mobile input zoom`);
  }
  for (const selector of ['.context-meter-label', '.code-row', '.settings-page-heading']) {
    assert.equal(css(selector).flexWrap, 'wrap');
  }
  assert.equal(css('.settings-nav').minWidth, '0px');
  assert.equal(css('.settings-nav').width, 'auto');
  assert.equal(css('.toast').maxWidth, 'calc(100% - 24px)');
});
