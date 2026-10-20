import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContextStorage } from '../src/server/context-storage.js';

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-context-'));
  const store = createContextStorage(join(dir, 'context.sqlite'));
  try { await run(store); }
  finally { store.close(); await rm(dir, { recursive: true, force: true }); }
}

test('context sources are chunked, searchable with stemming, and re-indexed incrementally', async () => withStore(store => {
  const content = `${'Release deployments use the stable branch. Rollback to the prior release. '.repeat(120)}\n${'Unrelated implementation details. '.repeat(120)}`;
  const first = store.index('deploy/release.md', 'Release guide', content);
  assert.equal(first.indexed, true);
  assert.ok(first.added > 1);
  assert.deepEqual(store.search('deployment', 3).map(result => result.source), Array(3).fill('deploy/release.md'));
  assert.equal(store.search('rollback')[0].scope, 'shared');

  const unchanged = store.index('deploy/release.md', 'Release guide', content);
  assert.equal(unchanged.indexed, false);
  assert.equal(unchanged.chunks, first.added);

  const changedContent = `${content.slice(0, -40)}Roll back by redeploying the previous release.`;
  const updated = store.index('deploy/release.md', 'Release guide', changedContent);
  assert.equal(updated.indexed, true);
  assert.ok(updated.reused > 0);
  assert.ok(store.search('redeploying previous').length > 0);
  assert.equal(store.getSource(store.listSources()[0].id).content, changedContent);
}));

test('context source deletion removes its searchable chunks and validates inputs', async () => withStore(store => {
  store.index('docs/guide.md', 'Guide', 'Run the local test suite before release.');
  assert.equal(store.search('local tests').length, 1);
  const id = store.listSources()[0].id;
  assert.equal(store.deleteSource(id), true);
  assert.deepEqual(store.listSources(), []);
  assert.deepEqual(store.search('local tests'), []);
  assert.equal(store.deleteSource(id), false);
  assert.throws(() => store.index('', 'Guide', 'text'), /Invalid context source/);
  assert.throws(() => store.search('---'), /Invalid context search query/);
}));
