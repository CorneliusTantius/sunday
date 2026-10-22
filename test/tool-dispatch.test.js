import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchToolCalls } from '../src/server/tool-dispatch.js';

test('adjacent read-only tools overlap and results preserve call order', async () => {
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = ['read', 'context_search', 'find', 'edit'].map((name, id) => ({ name, id }));
  const results = await dispatchToolCalls(calls, async ({ id }) => {
    events.push(`start:${id}`);
    if (id === 0) await gate;
    if (id === 1) release();
    events.push(`end:${id}`);
    return id;
  });
  assert.deepEqual(results, [0, 1, 2, 3]);
  assert.deepEqual(events, ['start:0', 'start:1', 'end:1', 'start:2', 'end:2', 'end:0', 'start:3', 'end:3']);
});

test('mutations, MCP tools, and unknown tools remain barriers', async () => {
  const calls = ['read', 'find', 'edit', 'read', 'mcp_read', 'context_search', 'unknown'];
  const events = [];
  await dispatchToolCalls(calls.map(name => ({ name })), async ({ name }) => { events.push(name); });
  assert.deepEqual(events, calls);
});

test('failed read batches wait for every started read and do not start later tools', async () => {
  let finished = false;
  const error = new Error('cancelled');
  await assert.rejects(dispatchToolCalls([
    { name: 'read', id: 0 },
    { name: 'find', id: 1 },
    { name: 'edit', id: 2 }
  ], async ({ id }) => {
    assert.notEqual(id, 2);
    if (id === 0) throw error;
    await new Promise(resolve => setImmediate(resolve));
    finished = true;
  }), error);
  assert.equal(finished, true);
});
