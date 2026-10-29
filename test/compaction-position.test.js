import test from 'node:test';
import assert from 'node:assert/strict';
import { compactionMessageIndex } from '../src/server/compaction-position.js';

test('maps compaction context boundaries to visible transcript message positions', () => {
  const messages = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'done', toolCalls: [{ id: 'call-1', name: 'read', result: 'output' }] },
    { role: 'user', content: 'next' },
    { role: 'assistant', content: 'answer' },
  ];

  assert.equal(compactionMessageIndex(messages, 0), 0);
  assert.equal(compactionMessageIndex(messages, 1), 1);
  assert.equal(compactionMessageIndex(messages, 2), 2);
  assert.equal(compactionMessageIndex(messages, 4), 2);
  assert.equal(compactionMessageIndex(messages, 5), 3);
  assert.equal(compactionMessageIndex(messages, 6), 4);
});
