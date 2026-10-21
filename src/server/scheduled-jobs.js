const scheduleTypes = new Set(['daily', 'weekly', 'monthly', 'every_n_minutes', 'every_n_hours']);
const weekdays = new Set([0, 1, 2, 3, 4, 5, 6]);

function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function validateSchedule(schedule) {
  if (!isObject(schedule) || !scheduleTypes.has(schedule.type)) throw new Error('Invalid schedule');
  const timezone = schedule.timezone;
  if (typeof timezone !== 'string' || !timezone || timezone.length > 100) throw new Error('Invalid schedule timezone');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
  catch { throw new Error('Invalid schedule timezone'); }

  const value = { type: schedule.type, timezone };
  if (['daily', 'weekly', 'monthly'].includes(schedule.type)) {
    if (typeof schedule.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) throw new Error('Schedule time must use HH:MM');
    value.time = schedule.time;
    if (schedule.type === 'weekly') {
      if (!weekdays.has(schedule.weekday)) throw new Error('Invalid schedule weekday');
      value.weekday = schedule.weekday;
    }
    if (schedule.type === 'monthly') {
      if (!Number.isInteger(schedule.dayOfMonth) || schedule.dayOfMonth < 1 || schedule.dayOfMonth > 31) throw new Error('Invalid day of month');
      value.dayOfMonth = schedule.dayOfMonth;
    }
  } else {
    const field = schedule.type === 'every_n_minutes' ? 'minutes' : 'hours';
    const maximum = field === 'minutes' ? 59 : 24;
    if (!Number.isInteger(schedule.interval) || schedule.interval < 1 || schedule.interval > maximum) throw new Error(`Schedule interval must be 1–${maximum} ${field}`);
    value.interval = schedule.interval;
  }
  return value;
}

export function validateScheduledJob(input, { personas, repositories, existing, now = Date.now() }) {
  if (!isObject(input)) throw new Error('Invalid scheduled job');
  const name = input.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error('Job name must be 1–120 characters');
  if (typeof input.personaId !== 'string' || !personas.some(persona => persona.id === input.personaId)) throw new Error('Persona not found');
  if (typeof input.task !== 'string' || !input.task.trim() || input.task.length > 20000) throw new Error('Task must contain 1–20000 characters');
  if (!Array.isArray(input.allowedRepositories) || input.allowedRepositories.length > 100 || input.allowedRepositories.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..')) throw new Error('Invalid allowed repositories');
  const allowedRepositories = [...new Set(input.allowedRepositories)];
  if (allowedRepositories.some(name => !repositories.has(name))) throw new Error('Repository not found');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('Invalid enabled state');

  return {
    id: existing?.id ?? input.id,
    name: name.trim(),
    personaId: input.personaId,
    task: input.task.trim(),
    allowedRepositories,
    schedule: validateSchedule(input.schedule),
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
