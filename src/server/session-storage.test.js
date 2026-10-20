import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStorage } from './session-storage.js';

test('SQLite session storage saves, lists, updates, and deletes sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-sessions-'));
  const storage = createSessionStorage(join(directory, 'sessions.sqlite'));
  try {
    const parent = { id: 'parent', title: 'Parent', createdAt: 10, updatedAt: 10, messages: [] };
    const child = { id: 'child', parentSessionId: parent.id, title: 'Child', createdAt: 20, updatedAt: 20, messages: [{ role: 'user', content: 'Hello' }] };
    storage.save(parent);
    storage.save(child);
    assert.deepEqual(storage.listIds(), ['parent', 'child']);
    assert.deepEqual(storage.listIds(parent.id), ['child']);
    assert.deepEqual(storage.get(child.id), child);

    child.updatedAt = 30;
    child.messages.push({ role: 'assistant', content: 'Hi' });
    storage.save(child);
    assert.deepEqual(storage.get(child.id), child);

    storage.deleteSessions([child.id, parent.id]);
    assert.equal(storage.get(parent.id), null);
    assert.deepEqual(storage.listIds(), []);
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
