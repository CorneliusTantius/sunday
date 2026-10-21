import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledJobScheduler, scheduledOccurrences } from './scheduler.js';

const at = value => Date.parse(value);

test('calendar cadences use the selected timezone and honor weekday/month-day selection', () => {
  const winter = scheduledOccurrences({ type: 'daily', time: '09:00', timezone: 'America/Los_Angeles' }, at('2024-01-15T16:59:00Z'), at('2024-01-15T17:01:00Z'));
  assert.deepEqual(winter, [at('2024-01-15T17:00:00Z')]);
  const summer = scheduledOccurrences({ type: 'daily', time: '09:00', timezone: 'America/Los_Angeles' }, at('2024-07-15T15:59:00Z'), at('2024-07-15T16:01:00Z'));
  assert.deepEqual(summer, [at('2024-07-15T16:00:00Z')]);
  const weekly = scheduledOccurrences({ type: 'weekly', weekday: 0, time: '09:00', timezone: 'America/New_York' }, at('2024-03-10T12:59:00Z'), at('2024-03-10T13:01:00Z'));
  assert.deepEqual(weekly, [at('2024-03-10T13:00:00Z')]);
  assert.deepEqual(scheduledOccurrences({ type: 'monthly', dayOfMonth: 31, time: '09:00', timezone: 'UTC' }, at('2024-02-01T00:00:00Z'), at('2024-03-01T00:00:00Z')), []);
  assert.deepEqual(scheduledOccurrences({ type: 'monthly', dayOfMonth: 31, time: '09:00', timezone: 'UTC' }, at('2024-03-31T08:59:00Z'), at('2024-03-31T09:01:00Z')), [at('2024-03-31T09:00:00Z')]);
});

test('interval schedules align to local clock boundaries and skip invalid or repeated calendar times', () => {
  const minutes = scheduledOccurrences({ type: 'every_n_minutes', interval: 20, timezone: 'Asia/Kathmandu' }, at('2024-01-01T00:00:00Z'), at('2024-01-01T01:00:00Z'));
  assert.deepEqual(minutes, ['2024-01-01T00:15:00Z', '2024-01-01T00:35:00Z', '2024-01-01T00:55:00Z'].map(at));
  const hours = scheduledOccurrences({ type: 'every_n_hours', interval: 4, timezone: 'America/Los_Angeles' }, at('2024-07-15T06:59:00Z'), at('2024-07-15T11:01:00Z'));
  assert.deepEqual(hours, ['2024-07-15T07:00:00Z', '2024-07-15T11:00:00Z'].map(at));
  const nonexistent = scheduledOccurrences({ type: 'daily', time: '02:30', timezone: 'America/New_York' }, at('2024-03-10T06:59:00Z'), at('2024-03-10T07:01:00Z'));
  assert.deepEqual(nonexistent, []);
  const repeated = scheduledOccurrences({ type: 'daily', time: '01:30', timezone: 'America/New_York' }, at('2024-11-03T05:29:00Z'), at('2024-11-03T06:31:00Z'));
  assert.deepEqual(repeated, [at('2024-11-03T05:30:00Z')]);
});

function memoryStorage(job) {
  const runs = [];
  return {
    runs,
    listJobs: () => [job],
    createRun(run) {
      if (runs.some(item => item.jobId === run.jobId && item.scheduledFor === run.scheduledFor)) return false;
      runs.push({ ...run });
      return true;
    },
    updateRun(run) { Object.assign(runs.find(item => item.id === run.id), run); },
  };
}

test('scheduler starts fresh after downtime and records overlapping occurrences as skipped', async () => {
  const start = at('2024-01-01T12:01:05Z');
  let clock = start;
  const offlineStorage = memoryStorage({ id: 'daily', enabled: true, schedule: { type: 'daily', time: '12:01', timezone: 'UTC' } });
  const offline = createScheduledJobScheduler({ storage: offlineStorage, runJob: async () => 'unexpected', now: () => clock, onError: assert.fail });
  clock += 60_000;
  await offline.tick(clock);
  assert.deepEqual(offlineStorage.runs, []);
  offline.stop();

  clock = at('2024-01-01T12:00:00Z');
  const job = { id: 'interval', enabled: true, schedule: { type: 'every_n_minutes', interval: 1, timezone: 'UTC' } };
  const storage = memoryStorage(job);
  let completeFirst;
  let calls = 0;
  const scheduler = createScheduledJobScheduler({
    storage,
    now: () => clock,
    onError: assert.fail,
    runJob: async () => {
      calls++;
      if (calls === 1) return new Promise(resolve => { completeFirst = resolve; });
      return 'completed';
    },
  });
  clock = at('2024-01-01T12:01:00Z');
  await scheduler.tick(clock);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.isRunning(job.id), true);
  clock = at('2024-01-01T12:02:00Z');
  await scheduler.tick(clock);
  assert.equal(storage.runs[1].status, 'skipped');
  assert.match(storage.runs[1].error, /previous run is still active/);
  completeFirst('first result');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(storage.runs[0].status, 'completed');
  assert.equal(storage.runs[0].result, 'first result');
  assert.equal(scheduler.isRunning(job.id), false);
  scheduler.stop();
});
