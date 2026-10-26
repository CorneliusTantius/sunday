import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateContext, shouldCompact, measuredInput, compactionCut, isContextOverflow } from '../src/server/context.js';
import { getContextMetrics } from '../src/web/context.js';
test('context meter rejects stale session usage and estimates tool results', () => {
  const messages = [{ role: 'assistant', content: '', toolCalls: [{ arguments: { path: 'file' }, result: 'x'.repeat(3000) }] }];
  const metrics = getContextMetrics({ model: 'm', provider: 'p', messageCount: 10, contextWindow: 10000, tokens: 5000 }, { model: 'm', provider: 'p' }, messages, '', 10000);
  assert.equal(metrics.measuredUsage, false);
  assert.ok(metrics.contextTokens >= 1000);
  assert.ok(metrics.contextTokens < 5000);
});

test('compaction uses Pi reserve-token threshold', () => {
  assert.equal(shouldCompact(83616, 100000), false);
  assert.equal(shouldCompact(83617, 100000), true);
  assert.equal(shouldCompact(900, 0), false);
});
test('estimate includes system, tools and attachment content', () => {
  const base = estimateContext('', []);
  assert.ok(estimateContext('system instructions', [{ role: 'user', content: 'file data'.repeat(100) }], [{ name: 'read' }]) > base);
});
test('measurement includes cached input and output like Pi', () => {
  assert.equal(measuredInput({ input: 100, cacheRead: 50, cacheWrite: 10, output: 99 }), 259);
});

test('mid-turn compaction retains a complete latest tool exchange', () => {
  assert.equal(compactionCut([{ role: 'user', content: 'x'.repeat(100000) }, { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(100000) }] }, { role: 'toolResult', content: [] }, { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(80000) }] }, { role: 'toolResult', content: [] }, { role: 'toolResult', content: [] }]), 3);
  assert.equal(compactionCut([{ role: 'user' }]), 0);
});
test('overflow detection excludes authentication and timeout errors', () => {
  assert.equal(isContextOverflow(new Error('context_length_exceeded')), true);
  assert.equal(isContextOverflow(new Error('prompt is too long')), true);
  assert.equal(isContextOverflow(new Error('Invalid API key')), false);
  assert.equal(isContextOverflow(new Error('Request timed out')), false);
});
