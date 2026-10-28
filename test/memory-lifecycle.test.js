import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextStorage } from '../src/server/context-storage.js';
import { memoryPrefix, retrieveMemory, reviewMemory, memoryOverview, maintainMemory } from '../src/server/memory-lifecycle.js';

const session = () => ({ allowedRepositories: ['sunday'], messages: [{ role: 'user', content: 'sqlite memory design' }] });
const proposal = { title: 'Storage', content: '# Storage\n\n## Findings\n- SQLite stores durable memory.' };

test('automatic review saves deduplicated snapshots and retrieval excludes other scopes', async () => {
  const storage = createContextStorage(':memory:');
  try {
    storage.index('other/sqlite', 'SQLite', 'sqlite memory design');
    storage.index(`${memoryPrefix(['other'])}note`, 'SQLite', 'sqlite memory design');
    const options = { storage, session: session(), review: async () => JSON.stringify(proposal) };
    await reviewMemory(options);
    await reviewMemory(options);
    assert.equal(storage.listSources().length, 3);
    const found = retrieveMemory(storage, session());
    assert.equal(found.length, 1);
    assert.ok(found[0].source.startsWith(memoryPrefix(['sunday'])));
    assert.deepEqual(retrieveMemory(storage, { ...session(), allowedRepositories: [] }), []);
  } finally { storage.close(); }
});

test('similar automatic notes reuse a source without losing earlier facts', async () => {
  const storage = createContextStorage(':memory:');
  try {
    const first = { title: 'Graph layout behavior', content: '# Graph layout behavior\n\n## Findings\n- Radial simulation prevents square boundary accumulation.\n- Spring animation settles graph nodes.' };
    const update = { ...first, content: `${first.content}\n- Spring animation respects accessibility preferences.` };
    const options = { storage, session: session() };
    const saved = await reviewMemory({ ...options, review: async () => JSON.stringify(first) });
    const updated = await reviewMemory({ ...options, review: async () => JSON.stringify(update) });
    assert.equal(updated.source, saved.source);
    assert.equal(storage.listSources().length, 1);
    const stored = storage.getSource(storage.listSources()[0].id);
    assert.ok(stored.content.includes(first.content));
    assert.ok(stored.content.includes(update.content));
    const repeated = await reviewMemory({ ...options, review: async () => JSON.stringify(update) });
    assert.equal(repeated.status, 'unchanged');
    assert.equal(storage.getSource(stored.id).content, stored.content);
  } finally { storage.close(); }
});

test('related automatic notes are linked without touching curated or other-scope notes', async () => {
  const storage = createContextStorage(':memory:');
  try {
    const first = { title: 'Graph radial layout', content: '# Graph radial layout\n\n## Findings\n- Radial simulation prevents square boundary accumulation.\n- Spring animation settles graph nodes.' };
    const second = { title: 'Graph radial simulation', content: '# Graph radial simulation\n\n## Findings\n- Radial simulation prevents square boundary accumulation.\n- Spring animation settles graph nodes.' };
    storage.index('sunday/manual', 'Graph radial layout', first.content);
    storage.index(`${memoryPrefix(['other'])}other`, first.title, first.content);
    const options = { storage, session: session() };
    const a = await reviewMemory({ ...options, review: async () => JSON.stringify(first) });
    const b = await reviewMemory({ ...options, review: async () => JSON.stringify(second) });
    assert.notEqual(a.source, b.source);
    assert.deepEqual(storage.links(b.source).links.map(link => [link.target, link.relation]), [[a.source, 'related']]);
    assert.equal(storage.links('sunday/manual').links.length, 0);
    assert.equal(storage.links(`${memoryPrefix(['other'])}other`).links.length, 0);
    storage.linkSources(b.source, a.source, 'supports');
    await reviewMemory({ ...options, review: async () => JSON.stringify(second) });
    assert.equal(storage.links(b.source).links[0].relation, 'supports');
  } finally { storage.close(); }
});

test('an edited automatic source is not overwritten when its old snapshot recurs', async () => {
  const storage = createContextStorage(':memory:');
  try {
    const options = { storage, session: session(), review: async () => JSON.stringify(proposal) };
    const original = await reviewMemory(options);
    const edited = '# Different subject\n\n## Findings\n- Browser typography improves contrast.';
    storage.index(original.source, 'Different subject', edited);
    const next = await reviewMemory(options);
    assert.notEqual(next.source, original.source);
    const notes = storage.listSources();
    assert.equal(notes.length, 2);
    assert.equal(storage.getSource(notes.find(note => note.source === original.source).id).content, edited);
    assert.equal((await reviewMemory(options)).source, next.source);
  } finally { storage.close(); }
});

test('notes with the same title but unrelated content are not merged', async () => {
  const storage = createContextStorage(':memory:');
  try {
    const options = { storage, session: session() };
    const first = { title: 'Release', content: '# Release\n\n## Findings\n- Database migration requires SQLite backups.' };
    const second = { title: 'Release', content: '# Release\n\n## Findings\n- Browser typography uses accessible contrast.' };
    const a = await reviewMemory({ ...options, review: async () => JSON.stringify(first) });
    const b = await reviewMemory({ ...options, review: async () => JSON.stringify(second) });
    assert.notEqual(a.source, b.source);
    assert.equal(storage.listSources().length, 2);
    assert.equal(storage.links(a.source).links.length, 0);
  } finally { storage.close(); }
});

test('review skips empty decisions and rejects malformed or sensitive proposals', async () => {
  let writes = 0;
  const options = { storage: { listSources: () => [], index() { writes++; } }, session: session() };
  assert.equal((await reviewMemory({ ...options, review: async () => 'null' })).status, 'skipped');
  for (const raw of ['invalid', '{}', 'true', '42', '[]', JSON.stringify({ ...proposal, content: proposal.content + '\n- password=unsafe' })]) {
    await assert.rejects(reviewMemory({ ...options, review: async () => raw }));
  }
  assert.equal(writes, 0);
});

test('scope ordering is stable and cancelled reviews cannot write', async () => {
  assert.equal(memoryPrefix(['a', 'b']), memoryPrefix(['b', 'a', 'a']));
  const controller = new AbortController();
  await assert.rejects(reviewMemory({ storage: { listSources: () => [], index() { assert.fail('unexpected write'); } }, session: session(), signal: controller.signal,
    review: async () => { controller.abort(); return JSON.stringify(proposal); } }));
});
