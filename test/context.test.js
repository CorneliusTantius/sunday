import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateContext, shouldCompact, measuredInput } from '../src/server/context.js';
test('compaction threshold is inclusive at 75 percent', () => {
  assert.equal(shouldCompact(749, 1000), false);
  assert.equal(shouldCompact(750, 1000), true);
  assert.equal(shouldCompact(900, 0), false);
});
test('estimate includes system, tools and attachment content', () => {
  const base = estimateContext('', []);
  assert.ok(estimateContext('system instructions', [{ role: 'user', content: 'file data'.repeat(100) }], [{ name: 'read' }]) > base);
});
test('measurement includes cached input but not output', () => {
  assert.equal(measuredInput({ input: 100, cacheRead: 50, cacheWrite: 10, output: 99 }), 160);
});
