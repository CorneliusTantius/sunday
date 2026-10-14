import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const jsx = readFileSync(new URL('../src/web/components/ToolCalls.jsx', import.meta.url), 'utf8');

function rule(selector, stylesheet = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

test('tool calls dialog uses native discrete entry and exit transitions', () => {
  const base = rule('.toolcalls-dialog');
  assert.match(base, /opacity\s*:\s*0\b/);
  assert.match(base, /transform\s*:\s*translateY\(10px\)\s+scale\(\.98\)/);
  assert.match(base, /transition\s*:[^;]*opacity\s+180ms\s+ease[^;]*transform\s+180ms\s+ease[^;]*display\s+180ms\s+allow-discrete[^;]*overlay\s+180ms\s+allow-discrete/);
  const open = rule('.toolcalls-dialog[open]');
  assert.match(open, /display\s*:\s*flex/);
  assert.match(open, /opacity\s*:\s*1\b/);
  assert.match(open, /transform\s*:\s*none/);
  const entry = rule('.toolcalls-dialog[open]', css.slice(css.indexOf('@starting-style')));
  assert.match(entry, /opacity\s*:\s*0\b/);
  assert.match(entry, /transform\s*:\s*translateY\(10px\)\s+scale\(\.98\)/);
});

test('tool calls backdrop transitions in and reduced motion disables both transitions', () => {
  const backdrop = rule('.toolcalls-dialog::backdrop');
  assert.match(backdrop, /opacity\s*:\s*0\b/);
  assert.match(backdrop, /transition\s*:[^;]*opacity[^;]*display[^;]*allow-discrete[^;]*overlay[^;]*allow-discrete/);
  assert.match(rule('.toolcalls-dialog[open]::backdrop'), /opacity\s*:\s*1\b/);
  assert.match(rule('.toolcalls-dialog[open]::backdrop', css.slice(css.indexOf('@starting-style'))), /opacity\s*:\s*0\b/);
  const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^]*?)\n\s*\}/)?.[1];
  assert.ok(reduced, 'missing reduced-motion media query');
  assert.match(reduced, /\.toolcalls-dialog\s*,\s*\.toolcalls-dialog::backdrop\s*\{[^}]*transition\s*:\s*none/s);
});

test('tool calls retain native dialog dismissal behavior', () => {
  assert.match(jsx, /<dialog\s+class="toolcalls-dialog"/);
  assert.match(jsx, /onClose=\{\(\) => setOpen\(false\)\}/);
  assert.match(jsx, /event\.target === dialog\.current\) dialog\.current\.close\(\)/);
  assert.match(jsx, /dialog\.current\?\.close\(\)/);
});
