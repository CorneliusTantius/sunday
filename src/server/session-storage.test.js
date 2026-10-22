import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSessionStorage } from './session-storage.js';

test('SQLite session storage saves, lists, updates, and deletes sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-sessions-'));
  const storage = createSessionStorage(join(directory, 'sessions.sqlite'));
  try {
    const session = { id: 'session', title: 'Session', createdAt: 10, updatedAt: 10, messages: [] };
    storage.save(session);
    assert.deepEqual(storage.listIds(), ['session']);
    assert.deepEqual(storage.get(session.id), session);

    session.updatedAt = 30;
    session.messages.push({ role: 'assistant', content: 'Hi' });
    storage.save(session);
    assert.deepEqual(storage.get(session.id), session);

    storage.deleteSessions([session.id]);
    assert.equal(storage.get(session.id), null);
    assert.deepEqual(storage.listIds(), []);
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('old hierarchical session storage is discarded instead of migrated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-sessions-old-'));
  const path = join(directory, 'sessions.sqlite');
  const oldDatabase = new DatabaseSync(path);
  oldDatabase.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, created_at INTEGER NOT NULL, data TEXT NOT NULL)');
  oldDatabase.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('old-child', 'old-parent', 20, JSON.stringify({ id: 'old-child', parentSessionId: 'old-parent', messages: [] }));
  oldDatabase.close();

  const storage = createSessionStorage(path);
  try {
    assert.deepEqual(storage.listIds(), []);
    const database = new DatabaseSync(path);
    assert.deepEqual(database.prepare('PRAGMA table_info(sessions)').all().map(column => column.name), ['id', 'created_at', 'data']);
    database.close();
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
