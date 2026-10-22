import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchToolCalls } from '../src/server/tool-dispatch.js';

test('adjacent delegations overlap, join before other tools, and preserve result order', async () => {
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = ['read', 'subagent_create', 'subagent_send_prompt', 'context_search', 'edit'].map((name, id) => ({ name, id }));
  const results = await dispatchToolCalls(calls, async ({ id }) => {
    events.push(`start:${id}`);
    if (id === 1) await gate;
    if (id === 2) release();
    events.push(`end:${id}`);
    return id;
  });
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
  assert.deepEqual(events, ['start:0', 'end:0', 'start:1', 'start:2', 'end:2', 'end:1', 'start:3', 'end:3', 'start:4', 'end:4']);
});

test('failed batches wait for all children and do not start later tools', async () => {
  let finished = false;
  const error = new Error('cancelled');
  await assert.rejects(dispatchToolCalls([
    { name: 'subagent_create', id: 0 },
    { name: 'subagent_send_prompt', id: 1 },
    { name: 'edit', id: 2 }
  ], async ({ id }) => {
    assert.notEqual(id, 2);
    if (id === 0) throw error;
    await new Promise(resolve => setImmediate(resolve));
    finished = true;
  }), error);
  assert.equal(finished, true);
});

test('adjacent read-only tools overlap but mutations and unknown tools remain barriers', async () => {
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = ['read', 'find', 'edit', 'read', 'mcp_read', 'context_search'].map((name, id) => ({ name, id }));
  const results = await dispatchToolCalls(calls, async ({ id }) => {
    events.push(`start:${id}`);
    if (id === 0) await gate;
    if (id === 1) release();
    events.push(`end:${id}`);
    return id;
  });
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(events, ['start:0', 'start:1', 'end:1', 'end:0', 'start:2', 'end:2', 'start:3', 'end:3', 'start:4', 'end:4', 'start:5', 'end:5']);
});

test('delegations never jump over intervening edits or reads', async () => {
  const calls = ['subagent_create', 'edit', 'subagent_send_prompt', 'read', 'subagent_create'];
  const events = [];
  await dispatchToolCalls(calls.map(name => ({ name })), async ({ name }) => { events.push(name); });
  assert.deepEqual(events, calls);
});

test('synchronous failures still join already scheduled reads before stopping', async () => {
  let finished = false;
  await assert.rejects(dispatchToolCalls([{ name: 'read' }, { name: 'find' }, { name: 'edit' }], call => {
    if (call.name === 'read') throw new Error('read failed');
    assert.equal(call.name, 'find');
    return new Promise(resolve => setImmediate(() => { finished = true; resolve(); }));
  }), /read failed/);
  assert.equal(finished, true);
});
