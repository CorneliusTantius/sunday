import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLanguage } from '../src/web/components/editor-language.js';

test('editor lazily loads supported file languages and falls back to plain text', async () => {
  for (const path of ['app.js', 'app.jsx', 'app.ts', 'app.tsx', 'script.mjs', 'script.cjs', 'data.JSON', 'script.py', 'index.html', 'index.htm', 'style.css']) {
    const support = await loadLanguage(path);
    assert.ok(support.language, `Expected language support for ${path}`);
  }
  assert.deepEqual(await loadLanguage('README.md'), []);
  assert.deepEqual(await loadLanguage('LICENSE'), []);
});
