import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScheduledJobsStorage } from './scheduled-jobs-storage.js';

function job(id = 'job-1') {
  return {
    id, name: 'Morning check', personaId: 'persona-1', task: 'Check changes',
    allowedRepositories: ['app'], schedule: { type: 'daily', time: '09:00', timezone: 'UTC' },
    enabled: true, createdAt: 10, updatedAt: 10,
  };
}

test('scheduled job and run storage survive reopening and cascade on job deletion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-scheduled-jobs-'));
  const path = join(directory, 'scheduled-jobs.sqlite');
  let storage = createScheduledJobsStorage(path);
  try {
    const scheduledJob = {
      ...job(), model: 'gpt-5', provider: 'openai', mode: 'api_key', thinkingLevel: 'high',
    };
    storage.saveJob(scheduledJob);
    assert.deepEqual(storage.getJob(scheduledJob.id), scheduledJob);
    assert.deepEqual(storage.listJobs(), [scheduledJob]);

    const firstRun = {
      id: 'run-1', jobId: scheduledJob.id, scheduledFor: 1000, status: 'running',
      startedAt: 1001, sessionId: 'session-1',
    };
    assert.equal(storage.createRun(firstRun), true);
    assert.equal(storage.createRun({ ...firstRun, id: 'duplicate-run' }), false);
    assert.deepEqual(storage.updateRun({
      ...firstRun, status: 'completed', finishedAt: 2000, result: 'All clear',
    }), {
      id: 'run-1', jobId: scheduledJob.id, scheduledFor: 1000, status: 'completed',
      startedAt: 1001, finishedAt: 2000, sessionId: 'session-1', result: 'All clear', error: null,
    });
    assert.equal(storage.createRun({
      id: 'run-2', jobId: scheduledJob.id, scheduledFor: 3000, status: 'running', startedAt: 3001,
    }), true);
    storage.close();
    storage = createScheduledJobsStorage(path);
    assert.equal(storage.recoverIncompleteRuns(4000), 1);
    assert.deepEqual(storage.getJob(scheduledJob.id), scheduledJob);
    assert.deepEqual(storage.listRuns(scheduledJob.id), [
      {
        id: 'run-2', jobId: scheduledJob.id, scheduledFor: 3000, status: 'failed',
        startedAt: 3001, finishedAt: 4000, sessionId: null, result: null,
        error: 'Sunday stopped before this run completed.',
      },
      {
        id: 'run-1', jobId: scheduledJob.id, scheduledFor: 1000, status: 'completed',
        startedAt: 1001, finishedAt: 2000, sessionId: 'session-1', result: 'All clear', error: null,
      },
    ]);
    assert.equal(storage.deleteJob(scheduledJob.id), true);
    assert.equal(storage.deleteJob(scheduledJob.id), false);
    assert.deepEqual(storage.listRuns(scheduledJob.id), []);
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
