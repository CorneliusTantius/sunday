import { DatabaseSync } from 'node:sqlite';

export function createScheduledJobsStorage(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS scheduled_jobs_enabled_idx ON scheduled_jobs(enabled);
    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
      scheduled_for INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      session_id TEXT,
      result TEXT,
      error TEXT,
      UNIQUE(job_id, scheduled_for)
    );
    CREATE INDEX IF NOT EXISTS scheduled_job_runs_job_date_idx ON scheduled_job_runs(job_id, scheduled_for DESC);
  `);

  const getJobStatement = database.prepare('SELECT data FROM scheduled_jobs WHERE id = ?');
  const listJobsStatement = database.prepare('SELECT data FROM scheduled_jobs ORDER BY created_at, id');
  const saveJobStatement = database.prepare(`
    INSERT INTO scheduled_jobs (id, enabled, created_at, updated_at, data)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled,
      updated_at = excluded.updated_at, data = excluded.data
  `);
  const deleteJobStatement = database.prepare('DELETE FROM scheduled_jobs WHERE id = ?');
  const insertRunStatement = database.prepare(`
    INSERT INTO scheduled_job_runs (id, job_id, scheduled_for, status, started_at, finished_at, session_id, result, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, scheduled_for) DO NOTHING
  `);
  const updateRunStatement = database.prepare(`
    UPDATE scheduled_job_runs SET status = ?, started_at = ?, finished_at = ?, session_id = ?, result = ?, error = ?
    WHERE id = ?
  `);
  const recoverRunsStatement = database.prepare(`
    UPDATE scheduled_job_runs SET status = 'failed', finished_at = ?, error = ?
    WHERE status = 'running'
  `);
  const getRunStatement = database.prepare(`
    SELECT id, job_id AS jobId, scheduled_for AS scheduledFor, status,
      started_at AS startedAt, finished_at AS finishedAt,
      session_id AS sessionId, result, error
    FROM scheduled_job_runs WHERE id = ?
  `);

  function getJob(id) {
    const row = getJobStatement.get(id);
    return row ? JSON.parse(row.data) : null;
  }

  function listJobs() { return listJobsStatement.all().map(row => JSON.parse(row.data)); }

  function saveJob(job) {
    saveJobStatement.run(job.id, job.enabled ? 1 : 0, job.createdAt, job.updatedAt, JSON.stringify(job));
    return job;
  }

  function deleteJob(id) { return deleteJobStatement.run(id).changes > 0; }

  function createRun(run) {
    const result = insertRunStatement.run(
      run.id, run.jobId, run.scheduledFor, run.status,
      run.startedAt ?? null, run.finishedAt ?? null, run.sessionId ?? null,
      run.result ?? null, run.error ?? null,
    );
    return result.changes > 0;
  }

  function getRun(id) {
    const row = getRunStatement.get(id);
    return row ? { ...row } : null;
  }

  function updateRun(run) {
    const result = updateRunStatement.run(
      run.status, run.startedAt ?? null, run.finishedAt ?? null,
      run.sessionId ?? null, run.result ?? null, run.error ?? null, run.id,
    );
    return result.changes > 0 ? getRun(run.id) : null;
  }

  function recoverIncompleteRuns(finishedAt = Date.now()) {
    return recoverRunsStatement.run(finishedAt, 'Sunday stopped before this run completed.').changes;
  }

  function listRuns(jobId, limit = 50) {
    return database.prepare(`
      SELECT id, job_id AS jobId, scheduled_for AS scheduledFor, status,
        started_at AS startedAt, finished_at AS finishedAt,
        session_id AS sessionId, result, error
      FROM scheduled_job_runs WHERE job_id = ?
      ORDER BY scheduled_for DESC, id DESC LIMIT ?
    `).all(jobId, limit).map(row => ({ ...row }));
  }

  return { getJob, listJobs, saveJob, deleteJob, createRun, updateRun, listRuns, recoverIncompleteRuns, close: () => database.close() };
}
