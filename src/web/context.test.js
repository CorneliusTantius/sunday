import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTokens, getContextMetrics } from './context.js';

test('context metrics use matching measured usage or estimate message content and references', () => {
  const messages = [{ content: 'abc', fileReferences: [{ content: 'def' }], toolCalls: [{ arguments: { x: 1 } }] }];
  assert.deepEqual(getContextMetrics(null, null, messages, 'x', 100), {
    measuredUsage: false, contextWindow: 100, contextTokens: Math.ceil((3 + 3 + JSON.stringify({ x: 1 }).length + 1) / 3), contextPercent: 5,
  });
  const usage = { model: 'm', provider: 'p', messageCount: 1, tokens: 20, contextWindow: 200 };
  assert.deepEqual(getContextMetrics(usage, { model: 'm', provider: 'p' }, messages, 'abc', 0), {
    measuredUsage: true, contextWindow: 200, contextTokens: 21, contextPercent: 11,
  });
});

test('context token formatting preserves unit thresholds', () => {
  assert.deepEqual([999, 1_000, 1_000_000].map(formatTokens), ['999', '1.0k', '1.0M']);
});
