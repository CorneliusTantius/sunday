import { DatabaseSync } from 'node:sqlite';

export function createSessionStorage(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT,
      created_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_parent_session_id_idx ON sessions(parent_session_id);
  `);

  const getStatement = database.prepare('SELECT data FROM sessions WHERE id = ?');
  const listStatement = database.prepare('SELECT id FROM sessions ORDER BY created_at, id');
  const childrenStatement = database.prepare('SELECT id FROM sessions WHERE parent_session_id = ? ORDER BY created_at, id');
  const saveStatement = database.prepare(`
    INSERT INTO sessions (id, parent_session_id, created_at, data)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      parent_session_id = excluded.parent_session_id,
      created_at = excluded.created_at,
      data = excluded.data
  `);
  const deleteStatement = database.prepare('DELETE FROM sessions WHERE id = ?');

  function get(id) {
    const row = getStatement.get(id);
    return row ? JSON.parse(row.data) : null;
  }

  function listIds(parentSessionId) {
    const rows = parentSessionId === undefined ? listStatement.all() : childrenStatement.all(parentSessionId);
    return rows.map(row => row.id);
  }

  function save(session) {
    saveStatement.run(session.id, session.parentSessionId ?? null, session.createdAt, JSON.stringify(session));
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
