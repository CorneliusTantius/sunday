import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');

test('removed financial tracker has no navigation or route', () => {
  assert.doesNotMatch(app, /FinancialTracker|financial-tracker/);
});
