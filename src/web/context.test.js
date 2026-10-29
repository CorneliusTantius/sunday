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

test('post-compaction server estimates remain visible when internal history exceeds displayed messages', () => {
  const usage = { model: 'm', provider: 'p', messageCount: 8, measured: false, tokens: 150, contextWindow: 1000 };
  const metrics = getContextMetrics(usage, { model: 'm', provider: 'p' }, [{ content: 'short' }, { content: 'history' }], '', 1000);
  assert.deepEqual(metrics, { measuredUsage: false, contextWindow: 1000, contextTokens: 150, contextPercent: 15 });
});

test('stale context estimates are ignored when displayed messages are newer', () => {
  const usage = { model: 'm', provider: 'p', messageCount: 2, measured: false, tokens: 150, contextWindow: 1000 };
  const messages = [{ content: 'one' }, { content: 'two' }, { content: 'three' }, { content: 'four' }];
  const metrics = getContextMetrics(usage, { model: 'm', provider: 'p' }, messages, '', 1000);
  assert.equal(metrics.contextTokens, Math.ceil((3 + 3 + 5 + 4) / 3));
  assert.equal(metrics.measuredUsage, false);
});

test('context token formatting preserves unit thresholds', () => {
  assert.deepEqual([999, 1_000, 1_000_000].map(formatTokens), ['999', '1.0k', '1.0M']);
});
