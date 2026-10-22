import { DatabaseSync } from 'node:sqlite';

export function createSessionStorage(path) {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL');
  if (database.prepare('PRAGMA table_info(sessions)').all().some(column => column.name === 'parent_session_id')) {
    database.exec('DROP TABLE sessions');
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  const getStatement = database.prepare('SELECT data FROM sessions WHERE id = ?');
  const listStatement = database.prepare('SELECT id FROM sessions ORDER BY created_at, id');
  const saveStatement = database.prepare(`
    INSERT INTO sessions (id, created_at, data)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      created_at = excluded.created_at,
      data = excluded.data
  `);
  const deleteStatement = database.prepare('DELETE FROM sessions WHERE id = ?');

  function get(id) {
    const row = getStatement.get(id);
    return row ? JSON.parse(row.data) : null;
  }

  function listIds() {
    return listStatement.all().map(row => row.id);
  }

  function save(session) {
    saveStatement.run(session.id, session.createdAt, JSON.stringify(session));
  }

  function deleteSessions(ids) {
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const id of ids) deleteStatement.run(id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  return { get, listIds, save, deleteSessions, close: () => database.close() };
}
