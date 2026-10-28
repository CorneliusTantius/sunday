import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');

test('agents disclosure keeps its contents inaccessible while collapsed', () => {
  assert.match(app, /inert=\{!expanded\} aria-hidden=\{!expanded\}/);
});
