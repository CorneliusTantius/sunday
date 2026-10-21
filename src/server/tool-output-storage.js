import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const MAX_SESSION_OUTPUTS = 100;
const MAX_SESSION_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_OUTPUTS = 1000;
const MAX_TOTAL_OUTPUT_BYTES = 512 * 1024 * 1024;
const CHUNK_LENGTH = 2400;
const CHUNK_OVERLAP = 200;
const MAX_FETCH_LENGTH = 8000;

function searchExpression(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new Error('Invalid tool output search query');
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].slice(0, 12);
  if (!terms.length) throw new Error('Invalid tool output search query');
  return terms.map(term => `"${term.replaceAll('"', '""')}"*`).join(' OR ');
}

function splitOutput(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_LENGTH, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      if (boundary > start + CHUNK_LENGTH * 0.65) end = boundary + 1;
    }
    chunks.push({ startOffset: start, content: text.slice(start, end) });
    start = end >= text.length ? text.length : Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

export function createToolOutputStorage(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tool_outputs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      output TEXT NOT NULL,
      characters INTEGER NOT NULL,
      bytes INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tool_outputs_session_created_idx ON tool_outputs(session_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS tool_output_chunks (
      id INTEGER PRIMARY KEY,
      output_id TEXT NOT NULL REFERENCES tool_outputs(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      start_offset INTEGER NOT NULL,
      content TEXT NOT NULL,
      UNIQUE(output_id, position)
    );
    CREATE INDEX IF NOT EXISTS tool_output_chunks_session_idx ON tool_output_chunks(session_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS tool_output_search USING fts5(
      output_id UNINDEXED, session_id UNINDEXED, start_offset UNINDEXED,
      tool_name UNINDEXED, content, tokenize = 'porter unicode61'
    );
  `);

  const insertOutput = database.prepare(`INSERT INTO tool_outputs
    (id, session_id, tool_call_id, tool_name, created_at, output, characters, bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertChunk = database.prepare(`INSERT INTO tool_output_chunks
    (output_id, session_id, position, start_offset, content) VALUES (?, ?, ?, ?, ?)`);
  const insertSearch = database.prepare(`INSERT INTO tool_output_search
    (rowid, output_id, session_id, start_offset, tool_name, content) VALUES (?, ?, ?, ?, ?, ?)`);
  const outputById = database.prepare('SELECT * FROM tool_outputs WHERE id = ? AND session_id = ?');
  const hasOutputs = database.prepare('SELECT 1 FROM tool_outputs WHERE session_id = ? LIMIT 1');
  const sessionUsage = database.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM tool_outputs WHERE session_id = ?');
  const totalUsage = database.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM tool_outputs');
  const chunkIdsByOutput = database.prepare('SELECT id FROM tool_output_chunks WHERE output_id = ?');
  const deleteSearch = database.prepare('DELETE FROM tool_output_search WHERE rowid = ?');
  const deleteOutputsForSession = database.prepare('DELETE FROM tool_outputs WHERE session_id = ?');

  function store(sessionId, toolCallId, toolName, output) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200 ||
        typeof toolCallId !== 'string' || !toolCallId || toolCallId.length > 200 ||
        typeof toolName !== 'string' || !toolName || toolName.length > 200 || typeof output !== 'string') {
      throw new Error('Invalid tool output');
    }
    const bytes = Buffer.byteLength(output);
    if (bytes > MAX_OUTPUT_BYTES) throw new Error(`Tool output exceeds the ${MAX_OUTPUT_BYTES} byte storage limit`);
    const session = sessionUsage.get(sessionId);
    if (session.count >= MAX_SESSION_OUTPUTS || session.bytes + bytes > MAX_SESSION_OUTPUT_BYTES) {
      throw new Error('Session tool output storage limit reached; only a partial preview is available for this output');
    }
    const total = totalUsage.get();
    if (total.count >= MAX_TOTAL_OUTPUTS || total.bytes + bytes > MAX_TOTAL_OUTPUT_BYTES) {
      throw new Error('Tool output storage limit reached; only a partial preview is available for this output');
    }
    const id = randomUUID();
    const createdAt = Date.now();
    const chunks = splitOutput(output);
    database.exec('BEGIN IMMEDIATE');
    try {
      insertOutput.run(id, sessionId, toolCallId, toolName, createdAt, output, output.length, bytes);
      for (const [position, chunk] of chunks.entries()) {
        const row = insertChunk.run(id, sessionId, position, chunk.startOffset, chunk.content);
        insertSearch.run(row.lastInsertRowid, id, sessionId, chunk.startOffset, toolName, chunk.content);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { id, sessionId, toolCallId, toolName, createdAt, characters: output.length, bytes };
  }

  function has(sessionId) {
    return typeof sessionId === 'string' && Boolean(hasOutputs.get(sessionId));
  }

  function search(sessionId, query, limit = 5) {
    if (typeof sessionId !== 'string' || !sessionId || !Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Invalid tool output search request');
    const expression = searchExpression(query);
    return database.prepare(`
      SELECT o.id AS outputId, o.tool_name AS toolName, o.created_at AS createdAt,
        c.start_offset AS offset,
        snippet(tool_output_search, 4, '⟦', '⟧', '…', 32) AS excerpt
      FROM tool_output_search
      JOIN tool_output_chunks c ON c.id = tool_output_search.rowid
      JOIN tool_outputs o ON o.id = c.output_id
      WHERE tool_output_search MATCH ? AND c.session_id = ?
      ORDER BY bm25(tool_output_search), o.created_at DESC, c.position
      LIMIT ?
    `).all(expression, sessionId, limit);
  }

  function fetch(sessionId, outputId, offset = 0, limit = MAX_FETCH_LENGTH) {
    if (typeof sessionId !== 'string' || !sessionId || typeof outputId !== 'string' || !/^[a-f0-9-]{36}$/.test(outputId) ||
        !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_FETCH_LENGTH) {
      throw new Error('Invalid tool output fetch request');
    }
    const row = outputById.get(outputId, sessionId);
    if (!row) throw new Error('Tool output not found for this session');
    if (offset > row.characters) throw new Error('Tool output offset is beyond the end of the output');
    return {
      outputId: row.id,
      toolName: row.tool_name,
      createdAt: row.created_at,
      totalCharacters: row.characters,
      offset,
      nextOffset: Math.min(offset + limit, row.characters),
      text: row.output.slice(offset, offset + limit),
    };
  }

  function deleteSessions(sessionIds) {
    if (!Array.isArray(sessionIds)) throw new Error('Invalid session IDs');
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const sessionId of sessionIds) {
        const outputs = database.prepare('SELECT id FROM tool_outputs WHERE session_id = ?').all(sessionId);
        for (const output of outputs) {
          for (const chunk of chunkIdsByOutput.all(output.id)) deleteSearch.run(chunk.id);
        }
        deleteOutputsForSession.run(sessionId);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  return { store, has, search, fetch, deleteSessions, close: () => database.close() };
}

export const TOOL_OUTPUT_NAMES = ['tool_output_search', 'tool_output_fetch'];
export const TOOL_OUTPUT_TOOLS = [
  { name: 'tool_output_search', description: 'Search the full text of large tool outputs retained for this session. Search results include an output ID and character offset; use tool_output_fetch to read exact text around a result.', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 300 }, limit: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['query'], additionalProperties: false } },
  { name: 'tool_output_fetch', description: 'Fetch an exact character range from a retained tool output. Use output ID and offset returned by tool_output_search; limit is at most 8000 characters.', parameters: { type: 'object', properties: { outputId: { type: 'string', pattern: '^[a-f0-9-]{36}$' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 8000 } }, required: ['outputId'], additionalProperties: false } },
];
export const TOOL_OUTPUT_INLINE_LIMIT = 4000;
