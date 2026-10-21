import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createToolOutputStorage } from '../src/server/tool-output-storage.js';

async function withStorage(run) {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-tool-output-'));
  const storage = createToolOutputStorage(join(dir, 'outputs.sqlite'));
  try { await run(storage); }
  finally { storage.close(); await rm(dir, { recursive: true, force: true }); }
}

test('tool outputs are searchable by session and exact character ranges can be fetched', async () => {
  await withStorage(storage => {
    const text = 'alpha line\n'.repeat(1200) + '🌙 UniqueNeedle is here\n' + 'trailing line\n'.repeat(100);
    const stored = storage.store('session-a', 'call-a', 'bash', text);
    assert.equal(stored.characters, text.length);
    assert.equal(stored.bytes, Buffer.byteLength(text));
    const matches = storage.search('session-a', 'uniqueneedle');
    assert.ok(matches.length >= 1);
    assert.equal(matches[0].outputId, stored.id);
    assert.ok(matches[0].offset <= text.indexOf('UniqueNeedle'));
    const chunk = storage.fetch('session-a', matches[0].outputId, matches[0].offset, 8000);
    assert.match(chunk.text, /UniqueNeedle/);
    const exact = storage.fetch('session-a', stored.id, text.indexOf('UniqueNeedle'), 12);
    assert.equal(exact.text, 'UniqueNeedle');
    assert.equal(exact.nextOffset, text.indexOf('UniqueNeedle') + 12);
  });
});

test('tool output search and fetch cannot cross session boundaries', async () => {
  await withStorage(storage => {
    const stored = storage.store('session-a', 'call-a', 'mcp_example', 'private marker output');
    assert.deepEqual(storage.search('session-b', 'private'), []);
    assert.throws(() => storage.fetch('session-b', stored.id), /not found for this session/);
    assert.throws(() => storage.fetch('session-a', stored.id, 1000), /beyond the end/);
  });
});

test('deleting sessions removes retained output and its search index entries', async () => {
  await withStorage(storage => {
    const stored = storage.store('session-a', 'call-a', 'bash', 'deletable searchable marker');
    storage.store('session-b', 'call-b', 'bash', 'keep searchable marker');
    assert.equal(storage.has('session-a'), true);
    storage.deleteSessions(['session-a']);
    assert.equal(storage.has('session-a'), false);
    assert.deepEqual(storage.search('session-a', 'deletable'), []);
    assert.throws(() => storage.fetch('session-a', stored.id), /not found for this session/);
    assert.equal(storage.search('session-b', 'keep').length, 1);
  });
});

test('tool output storage validates search and fetch limits', async () => {
  await withStorage(storage => {
    const stored = storage.store('session-a', 'call-a', 'bash', 'a searchable marker');
    assert.throws(() => storage.search('session-a', '  '), /Invalid tool output search query/);
    assert.throws(() => storage.search('session-a', 'marker', 6), /Invalid tool output search request/);
    assert.throws(() => storage.fetch('session-a', stored.id, 0, 8001), /Invalid tool output fetch request/);
    assert.throws(() => storage.fetch('session-a', stored.id, -1), /Invalid tool output fetch request/);
  });
});
