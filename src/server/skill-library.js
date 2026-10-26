import { createHash } from 'node:crypto';

export class SkillError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SkillError';
    this.statusCode = statusCode;
  }
}

const MAX_SKILLS = 100;
const MAX_CONTENT_LENGTH = 50_000;
const MAX_ENABLED_CONTENT_LENGTH = 100_000;
const MAX_NAME_LENGTH = 80;

function slug(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 52) || 'skill';
}

function contentFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SkillError('Invalid skill data');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) throw new SkillError(`Skill name must be 1–${MAX_NAME_LENGTH} characters`);
  if (!description || description.length > 500) throw new SkillError('Skill description must be 1–500 characters');
  if (!content || content.length > MAX_CONTENT_LENGTH) throw new SkillError(`Skill instructions must be 1–${MAX_CONTENT_LENGTH} characters`);
  return { name, description, content };
}

function ensureCapacity(existing) {
  if (existing.length >= MAX_SKILLS) throw new SkillError(`You can install up to ${MAX_SKILLS} skills`);
}

function ensureUniqueId(id, existing, excludeId) {
  if (existing.some(skill => skill.id === id && skill.id !== excludeId)) throw new SkillError('A skill with this name is already installed');
}

export function createSkill(input, existing = [], now = Date.now()) {
  ensureCapacity(existing);
  const fields = contentFields(input);
  const id = slug(fields.name);
  ensureUniqueId(id, existing);
  return { id, ...fields, source: { type: 'sunday' }, enabled: false, createdAt: now, updatedAt: now };
}

export function updateSkill(current, input, existing = [], now = Date.now()) {
  if (!current || !input || typeof input !== 'object' || Array.isArray(input)) throw new SkillError('Invalid skill update');
  const editable = ['name', 'description', 'content'].some(key => Object.hasOwn(input, key));
  const fields = editable ? contentFields({
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    content: input.content ?? current.content,
  }) : { name: current.name, description: current.description, content: current.content };
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new SkillError('Skill enabled must be true or false');
  const id = current.source.type === 'sunday' ? slug(fields.name) : current.id;
  ensureUniqueId(id, existing, current.id);
  const enabled = input.enabled ?? current.enabled;
  const enabledContentLength = existing.reduce((total, skill) => total + (skill.id === current.id || !skill.enabled ? 0 : skill.content.length), 0) + (enabled ? fields.content.length : 0);
  if (enabledContentLength > MAX_ENABLED_CONTENT_LENGTH) throw new SkillError('Enabled skill instructions cannot exceed 100,000 characters in total');
  return {
    ...current,
    id,
    ...fields,
    enabled,
    updatedAt: now,
  };
}

export function createImportedSkill(input, existing = [], now = Date.now()) {
  ensureCapacity(existing);
  if (!input || typeof input !== 'object' || typeof input.package !== 'string' || typeof input.path !== 'string') {
    throw new SkillError('Invalid npm skill package data');
  }
  const fields = contentFields(input);
  const hash = createHash('sha256').update(`${input.package}\n${input.path}`).digest('hex').slice(0, 10);
  const id = `npm-${slug(fields.name).slice(0, 42)}-${hash}`;
  ensureUniqueId(id, existing);
  return {
    id,
    ...fields,
    source: { type: 'npm', package: input.package, path: input.path },
    enabled: false,
    createdAt: now,
    updatedAt: now,
  };
}
