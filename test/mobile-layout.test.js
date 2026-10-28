import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('mobile content remains wrapped and contained', t => {
  const dom = new JSDOM(`<main>
    <div class="context-meter-label"></div><div class="code-row"></div>
    <div class="settings-page-heading"></div><div class="toast"></div>
    <div class="assistant message-bubble"></div>
  </main>`);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  document.head.append(style);
  const mobile = document.createElement('style');
  mobile.textContent = [...style.sheet.cssRules].flatMap(rule => {
    if (!rule.conditionText) return [rule.cssText];
    if (/^\(max-width:\s*700px\)$/.test(rule.conditionText)) return [...rule.cssRules].map(child => child.cssText);
    return [];
  }).join('\n');
  style.remove();
  document.head.append(mobile);
  const css = selector => dom.window.getComputedStyle(document.querySelector(selector));
  for (const selector of ['.context-meter-label', '.code-row', '.settings-page-heading']) {
    assert.equal(css(selector).flexWrap, 'wrap');
  }
  assert.ok(['90%', '100%'].includes(css('.assistant.message-bubble').maxWidth));
  assert.equal(css('.toast').maxWidth, 'calc(100% - 24px)');
});
