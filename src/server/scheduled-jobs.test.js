import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScheduledJob } from './scheduled-jobs.js';

const personas = [{ id: 'persona-1' }];
const repositories = new Set(['app', 'docs']);
const base = {
  name: '  Morning check ', personaId: 'persona-1', task: ' Check recent changes ',
  allowedRepositories: ['app', 'docs', 'app'],
  schedule: { type: 'weekly', weekday: 1, time: '09:30', timezone: 'America/New_York' },
};

test('scheduled job validation normalizes persisted fields and preserves identity on update', () => {
  const created = validateScheduledJob(base, { personas, repositories, now: 100 });
  assert.deepEqual(created, {
    id: undefined, name: 'Morning check', personaId: 'persona-1', task: 'Check recent changes',
    allowedRepositories: ['app', 'docs'],
    schedule: { type: 'weekly', weekday: 1, time: '09:30', timezone: 'America/New_York' },
    enabled: true, createdAt: 100, updatedAt: 100,
  });
  const updated = validateScheduledJob({ ...created, name: 'Evening check', enabled: false }, {
    personas, repositories, existing: { ...created, id: 'job-1', createdAt: 50 }, now: 200,
  });
  assert.equal(updated.id, 'job-1');
  assert.equal(updated.createdAt, 50);
  assert.equal(updated.updatedAt, 200);
  assert.equal(updated.enabled, false);
});

test('scheduled jobs accept every supported cadence with timezone-aware fields', () => {
  for (const schedule of [
    { type: 'daily', time: '00:00', timezone: 'UTC' },
    { type: 'weekly', weekday: 0, time: '23:59', timezone: 'Europe/London' },
    { type: 'monthly', dayOfMonth: 31, time: '12:00', timezone: 'Pacific/Auckland' },
    { type: 'every_n_minutes', interval: 15, timezone: 'UTC' },
    { type: 'every_n_hours', interval: 24, timezone: 'America/Los_Angeles' },
  ]) assert.deepEqual(validateScheduledJob({ ...base, schedule }, { personas, repositories }).schedule, schedule);
});

test('scheduled job validation rejects invalid persona, repository, task, and schedule values', () => {
  const cases = [
    [{ ...base, personaId: 'missing' }, /Persona not found/],
    [{ ...base, allowedRepositories: ['outside'] }, /Repository not found/],
    [{ ...base, task: '  ' }, /Task must contain/],
    [{ ...base, task: 'x'.repeat(20001) }, /Task must contain/],
    [{ ...base, schedule: { type: 'monthly', dayOfMonth: 32, time: '09:00', timezone: 'UTC' } }, /day of month/],
    [{ ...base, schedule: { type: 'weekly', weekday: 7, time: '09:00', timezone: 'UTC' } }, /weekday/],
    [{ ...base, schedule: { type: 'daily', time: '24:00', timezone: 'UTC' } }, /HH:MM/],
    [{ ...base, schedule: { type: 'every_n_minutes', interval: 60, timezone: 'UTC' } }, /interval/],
    [{ ...base, schedule: { type: 'every_n_hours', interval: 0, timezone: 'UTC' } }, /interval/],
    [{ ...base, schedule: { type: 'daily', time: '09:00', timezone: 'Mars/Olympus' } }, /timezone/],
  ];
  for (const [input, error] of cases) assert.throws(() => validateScheduledJob(input, { personas, repositories }), error);
});
