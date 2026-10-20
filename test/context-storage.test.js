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

test('context links are directed, upsert relations, validate sources, and cascade on deletion', async () => withStore(store => {
  store.index('notes/a.md', 'A', 'Note A');
  store.index('notes/b.md', 'B', 'Note B');
  store.index('notes/c.md', 'C', 'Note C');
  assert.deepEqual(store.linkSources('notes/a.md', 'notes/b.md'), { source: 'notes/a.md', target: 'notes/b.md', relation: 'related' });
  store.linkSources('notes/a.md', 'notes/b.md', 'depends-on');
  store.linkSources('notes/a.md', 'notes/c.md', 'mentions');
  const graph = store.graph();
  assert.deepEqual(graph.nodes.map(({ source, title }) => ({ source, title })), [
    { source: 'notes/a.md', title: 'A' },
    { source: 'notes/b.md', title: 'B' },
    { source: 'notes/c.md', title: 'C' },
  ]);
  assert.deepEqual(graph.links, [
    { source: 'notes/a.md', target: 'notes/b.md', relation: 'depends-on' },
    { source: 'notes/a.md', target: 'notes/c.md', relation: 'mentions' },
  ]);
  assert.deepEqual(store.links('notes/a.md'), {
    nodes: [{ source: 'notes/b.md', title: 'B' }, { source: 'notes/c.md', title: 'C' }],
    links: [
      { source: 'notes/a.md', target: 'notes/b.md', relation: 'depends-on' },
      { source: 'notes/a.md', target: 'notes/c.md', relation: 'mentions' },
    ],
  });
  assert.deepEqual(store.links('notes/b.md'), {
    nodes: [{ source: 'notes/a.md', title: 'A' }],
    links: [{ source: 'notes/a.md', target: 'notes/b.md', relation: 'depends-on' }],
  });
  assert.equal(store.unlinkSources('notes/a.md', 'notes/b.md'), true);
  assert.equal(store.unlinkSources('notes/a.md', 'notes/b.md'), false);
  assert.throws(() => store.linkSources('notes/a.md', 'notes/a.md'), /Invalid context link/);
  assert.throws(() => store.linkSources('notes/a.md', 'missing.md'), /Context source not found/);
  assert.throws(() => store.linkSources('notes/a.md', 'notes/c.md', ' '), /Invalid context link/);
  store.linkSources('notes/a.md', 'notes/c.md');
  assert.equal(store.deleteSource(store.listSources().find(item => item.source === 'notes/c.md').id), true);
  assert.deepEqual(store.links('notes/a.md'), { nodes: [], links: [] });
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
