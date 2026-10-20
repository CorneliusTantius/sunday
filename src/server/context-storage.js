import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const MAX_SOURCE_LENGTH = 300;
const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_CHUNK_LENGTH = 3000;
const CHUNK_OVERLAP = 250;
const hash = value => createHash('sha256').update(value).digest('hex');

function splitChunks(content) {
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + MAX_CHUNK_LENGTH, content.length);
    if (end < content.length) {
      const boundary = Math.max(content.lastIndexOf('\n', end), content.lastIndexOf(' ', end));
      if (boundary > start + MAX_CHUNK_LENGTH * 0.65) end = boundary;
    }
    const chunk = content.slice(start, end).trim();
    if (chunk) chunks.push({ content: chunk, hash: hash(chunk) });
    start = end >= content.length ? content.length : Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function searchExpression(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new Error('Invalid context search query');
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].slice(0, 12);
  if (!terms.length) throw new Error('Invalid context search query');
  return terms.map(term => `"${term.replaceAll('"', '""')}"*`).join(' OR ');
}

export function createContextStorage(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS context_sources (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'shared',
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS context_chunks (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES context_sources(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      UNIQUE(source_id, position)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS context_search USING fts5(
      title, content, tokenize = 'porter unicode61'
    );
  `);

  const sourceById = database.prepare('SELECT * FROM context_sources WHERE id = ?');
  const chunksBySource = database.prepare('SELECT id, position, content_hash FROM context_chunks WHERE source_id = ? ORDER BY position');
  const insertSource = database.prepare(`
    INSERT INTO context_sources (id, source, title, scope, content, content_hash, updated_at)
    VALUES (?, ?, ?, 'shared', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source = excluded.source, title = excluded.title,
      content = excluded.content, content_hash = excluded.content_hash, updated_at = excluded.updated_at
  `);
  const insertChunk = database.prepare('INSERT INTO context_chunks (source_id, position, content, content_hash) VALUES (?, ?, ?, ?)');
  const updateChunk = database.prepare('UPDATE context_chunks SET content = ?, content_hash = ? WHERE id = ?');
  const insertSearch = database.prepare('INSERT INTO context_search (rowid, title, content) VALUES (?, ?, ?)');
  const updateSearch = database.prepare('UPDATE context_search SET title = ?, content = ? WHERE rowid = ?');
  const deleteSearch = database.prepare('DELETE FROM context_search WHERE rowid = ?');
  const deleteChunk = database.prepare('DELETE FROM context_chunks WHERE id = ?');

  function index(source, title, rawContent) {
    if (typeof source !== 'string' || !source.trim() || source.trim().length > MAX_SOURCE_LENGTH ||
        typeof title !== 'string' || !title.trim() || title.trim().length > MAX_TITLE_LENGTH ||
        typeof rawContent !== 'string' || !rawContent.trim() || rawContent.length > MAX_CONTENT_LENGTH) {
      throw new Error('Invalid context source');
    }
    source = source.trim();
    title = title.trim();
    const content = rawContent.trim();
    const sourceId = hash(source.normalize('NFKC'));
    const contentHash = hash(content);
    const previous = sourceById.get(sourceId);
    if (previous?.content_hash === contentHash && previous.title === title) {
      return { source, title, indexed: false, chunks: chunksBySource.all(sourceId).length };
    }

    const chunks = splitChunks(content);
    const existing = new Map(chunksBySource.all(sourceId).map(chunk => [chunk.position, chunk]));
    const now = Date.now();
    let added = 0, updated = 0, reused = 0, removed = 0;
    database.exec('BEGIN IMMEDIATE');
    try {
      insertSource.run(sourceId, source, title, content, contentHash, now);
      for (const [position, chunk] of chunks.entries()) {
        const old = existing.get(position);
        if (old && old.content_hash === chunk.hash) {
          reused++;
          if (previous?.title !== title) updateSearch.run(title, chunk.content, old.id);
          existing.delete(position);
          continue;
        }
        if (old) {
          updateChunk.run(chunk.content, chunk.hash, old.id);
          updateSearch.run(title, chunk.content, old.id);
          updated++;
          existing.delete(position);
        } else {
          const result = insertChunk.run(sourceId, position, chunk.content, chunk.hash);
          insertSearch.run(result.lastInsertRowid, title, chunk.content);
          added++;
        }
      }
      removed = existing.size;
      for (const old of existing.values()) {
        deleteSearch.run(old.id);
        deleteChunk.run(old.id);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { source, title, indexed: true, added, updated, reused, removed };
  }

  function search(query, limit = 5) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid context search limit');
    const expression = searchExpression(query);
    return database.prepare(`
      SELECT s.source, s.title, s.scope,
        snippet(context_search, 1, '[', ']', '…', 32) AS excerpt
      FROM context_search
      JOIN context_chunks c ON c.id = context_search.rowid
      JOIN context_sources s ON s.id = c.source_id
      WHERE context_search MATCH ?
      ORDER BY bm25(context_search, 4.0, 1.0), s.source, c.position
      LIMIT ?
    `).all(expression, limit).map(row => ({ source: row.source, title: row.title, scope: row.scope, excerpt: row.excerpt }));
  }

  function listSources() {
    return database.prepare(`
      SELECT s.id, s.source, s.title, s.scope, s.updated_at AS updatedAt,
        length(s.content) AS characters, count(c.id) AS chunks
      FROM context_sources s LEFT JOIN context_chunks c ON c.source_id = s.id
      GROUP BY s.id ORDER BY s.updated_at DESC, s.source
    `).all();
  }

  function getSource(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null;
    const row = sourceById.get(id);
    if (!row) return null;
    return { id: row.id, source: row.source, title: row.title, scope: row.scope, content: row.content, updatedAt: row.updated_at };
  }

  function deleteSource(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return false;
    const chunks = chunksBySource.all(id);
    if (!sourceById.get(id)) return false;
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const chunk of chunks) deleteSearch.run(chunk.id);
      database.prepare('DELETE FROM context_sources WHERE id = ?').run(id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return true;
  }

  return { index, search, listSources, getSource, deleteSource, close: () => database.close() };
}
