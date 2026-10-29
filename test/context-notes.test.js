import test from 'node:test';
import assert from 'node:assert/strict';
import { groupContextNotes, isAutomaticContextSource } from '../src/web/context-notes.js';

test('automatic context notes use only the reserved auto/ source namespace', () => {
  assert.equal(isAutomaticContextSource('auto/repository/hash'), true);
  assert.equal(isAutomaticContextSource('sunday/notes/plan.md'), false);
  assert.equal(isAutomaticContextSource('automatic/notes.md'), false);
  assert.equal(isAutomaticContextSource(null), false);
});

test('context note groups preserve input order and separate auto sources', () => {
  const notes = [
    { source: 'sunday/plan.md' },
    { source: 'auto/repository/hash' },
    { source: 'workspace/design.md' },
  ];
  assert.deepEqual(groupContextNotes(notes), {
    intentional: [notes[0], notes[2]],
    automatic: [notes[1]],
  });
});
