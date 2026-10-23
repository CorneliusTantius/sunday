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
