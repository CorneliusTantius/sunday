import { randomUUID } from 'node:crypto';

const minuteMs = 60_000;
const weekdayNumbers = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map();

function getFormatter(timezone) {
  if (!formatterCache.has(timezone)) {
    formatterCache.set(timezone, new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatterCache.get(timezone);
}

function localParts(timestamp, timezone) {
  const values = Object.fromEntries(getFormatter(timezone).formatToParts(timestamp).map(part => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    weekday: weekdayNumbers[values.weekday], hour: Number(values.hour), minute: Number(values.minute),
  };
}

function matches(schedule, parts) {
  if (schedule.type === 'every_n_minutes') return parts.minute % schedule.interval === 0;
  if (schedule.type === 'every_n_hours') return parts.minute === 0 && parts.hour % schedule.interval === 0;
  const [hour, minute] = schedule.time.split(':').map(Number);
  if (parts.hour !== hour || parts.minute !== minute) return false;
  if (schedule.type === 'weekly' && parts.weekday !== schedule.weekday) return false;
  if (schedule.type === 'monthly' && parts.day !== schedule.dayOfMonth) return false;
  return true;
}

export function scheduledOccurrences(schedule, fromExclusive, toInclusive) {
  if (!Number.isFinite(fromExclusive) || !Number.isFinite(toInclusive) || fromExclusive >= toInclusive) return [];
  const firstMinute = Math.floor(fromExclusive / minuteMs) * minuteMs + minuteMs;
  const lastMinute = Math.floor(toInclusive / minuteMs) * minuteMs;
  const occurrences = [], calendarDates = new Set();
  for (let timestamp = firstMinute; timestamp <= lastMinute; timestamp += minuteMs) {
    const parts = localParts(timestamp, schedule.timezone);
    if (!matches(schedule, parts)) continue;
    if (['daily', 'weekly', 'monthly'].includes(schedule.type)) {
      const date = `${parts.year}-${parts.month}-${parts.day}`;
      if (calendarDates.has(date)) continue;
      calendarDates.add(date);
    }
    occurrences.push(timestamp);
  }
  return occurrences;
}

export function createScheduledJobScheduler({ storage, runJob, now = Date.now, intervalMs = 1000, onError = console.error }) {
  let lastCheckedAt = now(), timer = null, checking = false;
  const activeJobs = new Set();

  async function tick(at = now()) {
    if (checking) return;
    checking = true;
    const from = lastCheckedAt;
    lastCheckedAt = at;
    try {
      for (const job of storage.listJobs()) {
        if (!job.enabled) continue;
        for (const scheduledFor of scheduledOccurrences(job.schedule, from, at)) {
          const startedAt = now();
          const run = {
            id: randomUUID(), jobId: job.id, scheduledFor,
            status: activeJobs.has(job.id) ? 'skipped' : 'running',
            startedAt, finishedAt: activeJobs.has(job.id) ? startedAt : null,
            sessionId: null, result: null,
            error: activeJobs.has(job.id) ? 'Skipped because the previous run is still active.' : null,
          };
          if (!storage.createRun(run)) continue;
          if (run.status === 'skipped') continue;
          activeJobs.add(job.id);
          let execution;
          try { execution = runJob(job, run); }
          catch (error) { execution = Promise.reject(error); }
          Promise.resolve(execution).then(result => {
            storage.updateRun({ ...run, status: 'completed', finishedAt: now(), result: result ?? '', error: null });
          }, error => {
            storage.updateRun({ ...run, status: 'failed', finishedAt: now(), error: String(error?.message || error).slice(0, 5000) });
          }).catch(error => onError('Could not save scheduled job result:', error)).finally(() => activeJobs.delete(job.id));
        }
      }
    } catch (error) { onError('Scheduled job scheduler failed:', error); }
    finally { checking = false; }
  }

  return {
    start() {
      if (!timer) {
        timer = setInterval(() => { void tick(); }, intervalMs);
        timer.unref?.();
      }
    },
    stop() { clearInterval(timer); timer = null; },
    tick,
    isRunning(jobId) { return activeJobs.has(jobId); },
  };
}
