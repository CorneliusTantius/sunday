import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextStorage } from '../src/server/context-storage.js';
import { memoryPrefix, memoryScopeId } from '../src/server/memory-lifecycle.js';
import { consolidateAutoMemory } from '../src/server/memory-consolidation.js';

const summary = {
  title: 'UI rendering behavior',
  content: '# UI rendering behavior\n\n## Findings\n- The renderer preserves keyboard-accessible note navigation.',
};

function addNote(storage, source, title, fact) {
  return storage.indexAutomatic(source, title, `# ${title}\n\n## Findings\n- ${fact}\n- This remains a durable, verified implementation detail.`);
}

test('manual consolidation replaces only grouped notes in the selected scope and preserves their links', async () => {
  const storage = createContextStorage(':memory:');
  try {
    const repositories = ['sunday'];
    const prefix = memoryPrefix(repositories);
    const scopeId = memoryScopeId(repositories);
    const first = addNote(storage, `${prefix}a`, 'UI keyboard navigation', 'Keyboard navigation works in note lists.');
    const second = addNote(storage, `${prefix}b`, 'UI accessible navigation', 'Keyboard navigation works in indexed notes.');
    addNote(storage, `${prefix}c`, 'Release process', 'The release process creates a signed build.');
    storage.index('sunday/manual', 'Manual context', 'Curated information stays separate.');
    storage.indexAutomatic(`${memoryPrefix(['other'])}note`, 'Other repository note', 'Never consolidate this scope.');
    storage.linkSources(`${prefix}a`, 'sunday/manual', 'supports');
    storage.linkSources(`${prefix}b`, 'sunday/manual', 'related');
    storage.linkSources(`${prefix}a`, `${prefix}b`, 'related');
    let calls = 0;
    const result = await consolidateAutoMemory({
      storage, scopeId, repositories,
      summarize: async (kind, input) => {
        assert.equal(kind, 'consolidate');
        calls++;
        const grouped = input.notes.filter(note => note.title.startsWith('UI')).map(note => note.id);
        const keep = input.notes.filter(note => !note.title.startsWith('UI')).map(note => note.id);
        return JSON.stringify({ groups: [{ ...summary, sourceIds: grouped }], keep });
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.beforeNotes, 3);
    assert.equal(result.afterNotes, 2);
    assert.equal(result.deletedNotes, 2);
    assert.equal(storage.getSource(first.id), null);
    assert.equal(storage.getSource(second.id), null);
    assert.equal(storage.listSources().filter(item => item.source.startsWith(`${prefix}consolidated/`)).length, 1);
    assert.ok(storage.getSource(storage.listSources().find(item => item.source === 'sunday/manual').id));
    assert.ok(storage.getSource(storage.listSources().find(item => item.source.startsWith(memoryPrefix(['other']))).id));
    const consolidatedSource = storage.listSources().find(item => item.source.startsWith(`${prefix}consolidated/`)).source;
    const preserved = storage.links(consolidatedSource);
    assert.deepEqual(preserved.links.map(link => [link.source, link.target, link.relation]), [[consolidatedSource, 'sunday/manual', 'related; supports']]);
  } finally { storage.close(); }
});

test('large automatic notes are reduced through bounded chunk summaries', async () => {
  const storage = createContextStorage(':memory:');
  try {
    const prefix = memoryPrefix(['sunday']);
    const scopeId = memoryScopeId(['sunday']);
    const content = `# Long note\n\n## Findings\n${'- Repeated verified technical detail about this implementation.\n'.repeat(1200)}`;
    assert.ok(content.length > 30_000);
    const original = storage.indexAutomatic(`${prefix}long`, 'Long note', content);
    let chunks = 0;
    const result = await consolidateAutoMemory({
      storage, scopeId,
      summarize: async (kind, input) => {
        if (kind === 'chunk') {
          chunks++;
          assert.ok(input.content.length <= 20_000);
          return JSON.stringify({ content: '# Long note\n\n## Findings\n- Repeated section summary.' });
        }
        return JSON.stringify({ groups: [{ ...summary, title: 'Long note', content: '# Long note\n\n## Findings\n- Repeated details were consolidated into one durable implementation fact.', sourceIds: [input.notes[0].id] }], keep: [] });
      },
    });
    assert.ok(chunks > 1);
    assert.equal(result.beforeNotes, 1);
    assert.equal(result.afterNotes, 1);
    assert.ok(result.afterCharacters < result.beforeCharacters);
    assert.equal(storage.getSource(original.id), null);
  } finally { storage.close(); }
});

test('invalid model proposals leave originals untouched', async () => {
  const storage = createContextStorage(':memory:');
  try {
    const prefix = memoryPrefix(['sunday']);
    const scopeId = memoryScopeId(['sunday']);
    addNote(storage, `${prefix}a`, 'One', 'A durable technical fact.');
    addNote(storage, `${prefix}b`, 'Two', 'Another durable technical fact.');
    await assert.rejects(consolidateAutoMemory({
      storage, scopeId,
      summarize: async () => JSON.stringify({ groups: [], keep: [] }),
    }), /Invalid consolidation response/);
    assert.equal(storage.listSources().filter(item => item.source.startsWith(prefix)).length, 2);
  } finally { storage.close(); }
});

test('cancellation after model response does not stage or delete notes', async () => {
  const storage = createContextStorage(':memory:');
  try {
    const prefix = memoryPrefix(['sunday']);
    const scopeId = memoryScopeId(['sunday']);
    addNote(storage, `${prefix}a`, 'One', 'A durable technical fact.');
    addNote(storage, `${prefix}b`, 'Two', 'Another durable technical fact.');
    const controller = new AbortController();
    await assert.rejects(consolidateAutoMemory({
      storage, scopeId, signal: controller.signal,
      summarize: async (kind, input) => {
        const ids = input.notes.map(note => note.id);
        controller.abort(new Error('cancelled'));
        return JSON.stringify({ groups: [{ ...summary, sourceIds: ids }], keep: [] });
      },
    }));
    assert.equal(storage.listSources().filter(item => item.source.startsWith(prefix)).length, 2);
    assert.equal(storage.listSources().some(item => item.source.includes('/consolidated/')), false);
  } finally { storage.close(); }
});
