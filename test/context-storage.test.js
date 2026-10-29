import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createContextStorage } from '../src/server/context-storage.js';
import { memoryPrefix, memoryScopeId } from '../src/server/memory-lifecycle.js';

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-context-'));
  const path = join(dir, 'context.sqlite');
  const store = createContextStorage(path);
  try { await run(store, path); }
  finally { store.close(); await rm(dir, { recursive: true, force: true }); }
}

function storedChunks(path, source) {
  const database = new DatabaseSync(path);
  try {
    return database.prepare(`SELECT c.content FROM context_chunks c
      JOIN context_sources s ON s.id = c.source_id WHERE s.source = ? ORDER BY c.position`).all(source).map(row => row.content);
  } finally { database.close(); }
}

test('automatic memory scopes retain repository labels and aggregate only their exact sources', async () => withStore(store => {
  const repositories = ['sunday', 'docs'];
  const scopeId = memoryScopeId(repositories);
  const prefix = memoryPrefix(repositories);
  store.registerMemoryScope(scopeId, repositories);
  store.indexAutomatic(`${prefix}one`, 'First auto note', 'short content');
  store.indexAutomatic(`${prefix}two`, 'Second auto note', 'more content');
  store.indexAutomatic(`${memoryPrefix(['other'])}one`, 'Other scope note', 'excluded');
  store.index('sunday/manual', 'Curated note', 'excluded');
  const scopes = store.listAutoMemoryScopes();
  assert.deepEqual(scopes.find(scope => scope.id === scopeId), { id: scopeId, prefix, noteCount: 2, characters: 25, repositories: ['docs', 'sunday'] });
  assert.equal(scopes.length, 2);
  assert.equal(scopes.find(scope => scope.id !== scopeId).repositories, null);
  assert.throws(() => store.registerMemoryScope('a'.repeat(64), repositories), /Invalid automatic memory scope/);
}));

test('manual indexing cannot write into the reserved automatic-memory namespace', async () => withStore(store => {
  const source = `${memoryPrefix(['sunday'])}manual`;
  assert.throws(() => store.index(source, 'Manual note', 'Do not mix with auto notes.'), /Automatic context sources are reserved/);
  assert.throws(() => store.index('auto/unscoped/manual', 'Manual note', 'This namespace is also reserved.'), /Automatic context sources are reserved/);
  assert.equal(store.indexAutomatic(source, 'Auto note', 'Generated note content.').indexed, true);
  assert.equal(store.listSources().length, 1);
}));

test('context sources are chunked, searchable with stemming, and re-indexed incrementally', async () => withStore(store => {
  const content = `${'Release deployments use the stable branch. Rollback to the prior release. '.repeat(120)}\n${'Unrelated implementation details. '.repeat(120)}`;
  const first = store.index('deploy/release.md', 'Release guide', content);
  assert.equal(first.indexed, true);
  assert.ok(first.added > 1);
  assert.ok(store.search('deployment', 3).length > 0);
  assert.ok(store.search('deployment', 3).every(result => result.source === 'deploy/release.md'));
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

test('context chunks target 5,000 characters and retain overlap', async () => withStore((store, path) => {
  const content = 'stable release rollback checklist '.repeat(500);
  store.index('docs/large.md', 'Large guide', content);
  const chunks = storedChunks(path, 'docs/large.md');
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 5000));
  assert.ok(chunks.reduce((total, chunk) => total + chunk.length, 0) > content.trim().length);
}));

test('legacy context chunks are rebuilt on open without losing source data or graph links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-context-migration-'));
  const path = join(dir, 'context.sqlite');
  const content = 'legacy migration anchor release checklist '.repeat(500);
  const initial = createContextStorage(path);
  initial.index('docs/large.md', 'Large guide', content);
  initial.index('docs/related.md', 'Related guide', 'Related release architecture details.');
  initial.linkSources('docs/large.md', 'docs/related.md', 'documents');
  const sourceId = initial.listSources().find(source => source.source === 'docs/large.md').id;
  initial.close();

  const database = new DatabaseSync(path);
  let legacyCount;
  try {
    const oldChunks = database.prepare('SELECT id FROM context_chunks WHERE source_id = ?').all(sourceId);
    for (const chunk of oldChunks) database.prepare('DELETE FROM context_search WHERE rowid = ?').run(chunk.id);
    database.prepare('DELETE FROM context_chunks WHERE source_id = ?').run(sourceId);
    const insertChunk = database.prepare('INSERT INTO context_chunks (source_id, position, content, content_hash) VALUES (?, ?, ?, ?)');
    const insertSearch = database.prepare('INSERT INTO context_search (rowid, title, content) VALUES (?, ?, ?)');
    let start = 0, position = 0;
    while (start < content.length) {
      let end = Math.min(start + 3000, content.length);
      if (end < content.length) {
        const boundary = Math.max(content.lastIndexOf('\\n', end), content.lastIndexOf(' ', end));
        if (boundary > start + 1950) end = boundary;
      }
      const chunk = content.slice(start, end).trim();
      if (chunk) {
        const row = insertChunk.run(sourceId, position++, chunk, 'legacy');
        insertSearch.run(row.lastInsertRowid, 'Large guide', chunk);
      }
      start = end >= content.length ? content.length : Math.max(start + 1, end - 250);
    }
    legacyCount = position;
    database.prepare("UPDATE context_metadata SET value = '3000-250-v1' WHERE key = 'chunk_version'").run();
  } finally { database.close(); }

  const migrated = createContextStorage(path);
  try {
    const chunks = storedChunks(path, 'docs/large.md');
    assert.ok(chunks.length < legacyCount);
    assert.ok(chunks.every(chunk => chunk.length <= 5000));
    assert.equal(migrated.getSource(sourceId).content, content.trim());
    assert.ok(migrated.search('legacy migration anchor').length > 0);
    assert.deepEqual(migrated.links('docs/large.md').nodes, [{ source: 'docs/related.md', title: 'Related guide' }]);
    assert.equal(migrated.index('docs/large.md', 'Large guide', content).chunks, chunks.length);
  } finally { migrated.close(); await rm(dir, { recursive: true, force: true }); }
});

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
