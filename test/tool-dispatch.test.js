import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchToolCalls } from '../src/server/tool-dispatch.js';

test('delegations overlap, join before other tools, and preserve result order', async () => {
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = ['read', 'subagent_create', 'subagent_send_prompt', 'edit'].map((name, id) => ({ name, id }));
  const results = await dispatchToolCalls(calls, async ({ id }) => {
    events.push(`start:${id}`);
    if (id === 1) await gate;
    if (id === 2) release();
    events.push(`end:${id}`);
    return id;
  });
  assert.deepEqual(results, [0, 1, 2, 3]);
  assert.deepEqual(events, ['start:0', 'end:0', 'start:1', 'start:2', 'end:2', 'end:1', 'start:3', 'end:3']);
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
