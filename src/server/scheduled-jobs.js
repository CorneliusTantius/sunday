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

export function validateScheduledJob(input, { personas, repositories, models = [], defaultModel, existing, now = Date.now() }) {
  if (!isObject(input)) throw new Error('Invalid scheduled job');
  const name = input.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error('Job name must be 1–120 characters');
  if (typeof input.personaId !== 'string' || !personas.some(persona => persona.id === input.personaId)) throw new Error('Persona not found');
  if (typeof input.task !== 'string' || !input.task.trim() || input.task.length > 20000) throw new Error('Task must contain 1–20000 characters');
  if (!Array.isArray(input.allowedRepositories) || input.allowedRepositories.length > 100 || input.allowedRepositories.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..')) throw new Error('Invalid allowed repositories');
  const allowedRepositories = [...new Set(input.allowedRepositories)];
  if (allowedRepositories.some(name => !repositories.has(name))) throw new Error('Repository not found');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('Invalid enabled state');
  const model = Object.hasOwn(input, 'model') ? input.model : existing?.model ?? null;
  const provider = Object.hasOwn(input, 'provider') ? input.provider : existing?.provider ?? null;
  const mode = Object.hasOwn(input, 'mode') ? input.mode : existing?.mode ?? null;
  const thinkingLevel = Object.hasOwn(input, 'thinkingLevel') ? input.thinkingLevel : existing?.thinkingLevel ?? null;
  if (model === '') throw new Error('Invalid model');
  if (provider === '') throw new Error('Invalid provider');
  if (mode === '') throw new Error('Invalid authorization mode');
  if (model !== null && (typeof model !== 'string' || !models.some(item => item.id === model && item.provider === provider && item.mode === mode))) throw new Error('Invalid model or provider not connected');
  if (model === null && (provider !== null || mode !== null)) throw new Error('Provider and mode require a model');
  if (model !== null && (typeof provider !== 'string' || !['api_key', 'oauth'].includes(mode))) throw new Error('Invalid model selection');
  if (thinkingLevel !== null && (typeof thinkingLevel !== 'string' || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(thinkingLevel))) throw new Error('Invalid thinking level');
  if (thinkingLevel) {
    const effectiveModel = model
      ? models.find(item => item.id === model && item.provider === provider && item.mode === mode)
      : models.find(item => item.id === defaultModel?.id && item.provider === defaultModel?.provider && item.mode === defaultModel?.mode);
    if (!effectiveModel?.thinkingLevels.includes(thinkingLevel)) throw new Error('Unsupported thinking level for this model');
  }

  return {
    id: existing?.id ?? input.id,
    name: name.trim(),
    personaId: input.personaId,
    task: input.task.trim(),
    allowedRepositories,
    schedule: validateSchedule(input.schedule),
    ...(model ? { model, provider, mode } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
