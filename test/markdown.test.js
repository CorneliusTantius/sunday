import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { h, render } from 'preact';
import MessageBubble, { renderMarkdown } from '../src/web/components/MessageBubble.js';

const parse = text => JSDOM.fragment(renderMarkdown(text));

function assertSafe(root) {
  assert.equal(root.querySelector('script, img, svg, iframe, style, object, embed'), null);
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      assert.ok(!/^on/i.test(attribute.name), attribute.name);
      if (['href', 'src'].includes(attribute.name)) {
        assert.ok(!/^\s*(javascript|vbscript|file|data):/i.test(attribute.value), attribute.value);
      }
    }
    if (element.getAttribute('target') === '_blank') {
      assert.ok(element.relList.contains('noopener'));
      assert.ok(element.relList.contains('noreferrer'));
    }
  }
}

test('Markdown renders headings, emphasis, lists, tables, code and links', () => {
  const root = parse('# Heading\n\n## Subheading\n\n**bold** *italic* ~~deleted~~\n\n- first\n- second\n\n3. third\n4. fourth\n\n| Name | Value |\n| --- | ---: |\n| one | **two** |\n\n`<b>inline</b>`\n\n```js\nconst html = "<script>alert(1)</script>";\n```\n\n[Docs](https://example.com "Documentation") [Local](/help) [Email](mailto:hello@example.com)\n\nfirst line\nsecond line');
  for (const [selector, text] of [['h1', 'Heading'], ['h2', 'Subheading'], ['strong', 'bold'], ['em', 'italic'], ['s', 'deleted']]) {
    assert.equal(root.querySelector(selector).textContent, text);
  }
  assert.equal(root.querySelectorAll('ul > li').length, 2);
  assert.equal(root.querySelectorAll('ol > li').length, 2);
  assert.equal(root.querySelector('ol').getAttribute('start'), '3');
  assert.equal(root.querySelector('[role="region"][aria-label="Table"] > table tbody td strong').textContent, 'two');
  assert.equal(root.querySelector('[role="region"][aria-label="Table"]').getAttribute('tabindex'), '0');
  assert.equal(root.querySelector('p > code').textContent, '<b>inline</b>');
  assert.equal(root.querySelector('pre > code').className, 'language-js');
  assert.match(root.querySelector('pre > code').textContent, /<script>alert\(1\)<\/script>/);
  assert.deepEqual([...root.querySelectorAll('a')].map(a => a.getAttribute('href')), ['https://example.com', '/help', 'mailto:hello@example.com']);
  assert.equal(root.querySelector('a').title, 'Documentation');
  assert.ok(root.querySelector('br'));
  assertSafe(root);
});

test('raw HTML and images remain inert literal text without resource requests', () => {
  const input = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<svg onload=alert(1)>\n<iframe src="https://example.com"></iframe>\n<style>body{display:none}</style>\n\n![remote](https://example.com/tracking.png) ![data](data:image/png;base64,AAAA)';
  const root = parse(input);
  assertSafe(root);
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(root.textContent, /!remote/);
  assert.match(root.textContent, /!\[data\]/);
});

test('unsafe links are rejected including references, autolinks and obfuscated schemes', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'jav&#x61;script:alert(1)', 'vbscript:evil', 'file:///etc/passwd', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,AAAA']) {
    for (const input of [`[click](${url})`, `[click][ref]\n\n[ref]: ${url}`, `<${url}>`]) {
      const root = parse(input);
      assertSafe(root);
      assert.equal(root.querySelector('a'), null, input);
    }
  }
});

test('titles, fenced languages, and code cannot inject HTML attributes or markup', () => {
  for (const input of [
    '[safe](https://example.com "&quot; onmouseover=&quot;alert(1)")',
    '```js" onmouseover="alert(1)\n<img src=x onerror=alert(1)>\n```',
    '`[evil](javascript:alert(1)) <svg onload=alert(1)>`',
  ]) assertSafe(parse(input));
});

test('every streaming prefix is safe, including unfinished links, HTML and fences', () => {
  for (const input of [
    '<img src=x onerror=alert(1)> **bold**',
    '[evil](javascript:alert(1)) [ok](https://example.com)',
    '[evil][ref]\n\n[ref]: data:text/html;base64,AAAA',
    '```html\n<script>alert(1)</script>\n```\n\n| A | B |\n| - | - |\n| a | b |',
  ]) {
    for (let length = 0; length <= input.length; length++) assertSafe(parse(input.slice(0, length)));
  }
  assert.equal(renderMarkdown(''), '');
  assert.equal(parse('```js\nconst value = 1;').querySelector('pre code').textContent, 'const value = 1;');
});

test('bubble updates streamed Markdown but renders errors as plain text with preserved whitespace', t => {
  const dom = new JSDOM('<div id="root"></div>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  const root = document.getElementById('root');
  t.after(() => { render(null, root); globalThis.document = previousDocument; dom.window.close(); });
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  document.head.append(style);
  render(h(MessageBubble, { content: '**stream' }), root);
  assert.equal(root.querySelector('strong'), null);
  render(h(MessageBubble, { content: '**streamed**' }), root);
  assert.equal(root.querySelector('strong').textContent, 'streamed');
  render(h(MessageBubble, { content: '| A | B |\n| - | - |\n| one | two |\n\n```\nlong line\n```' }), root);
  const table = root.querySelector('[role="region"][aria-label="Table"]');
  assert.ok(table.className.includes('overflow-x-auto'));
  const markdownBubble = root.firstElementChild;
  assert.ok(markdownBubble.className.includes('[&_pre]:whitespace-pre-wrap'));
  assert.ok(markdownBubble.className.includes('[&_pre]:overflow-x-auto'));
  const error = '**not bold**\n  <img src=x onerror=alert(1)>';
  render(h(MessageBubble, { content: error, error: true }), root);
  const errorBubble = root.querySelector('[class*="whitespace-pre-wrap"]');
  assert.equal(errorBubble.textContent, error);
  assert.equal(root.querySelector('strong, img, [role="region"]'), null);
  assert.ok(errorBubble.className.includes('whitespace-pre-wrap'));
  render(h(MessageBubble, { content: '*recovered*' }), root);
  assert.equal(root.querySelector('em').textContent, 'recovered');
  assert.equal(root.querySelector('.error-text'), null);
});
