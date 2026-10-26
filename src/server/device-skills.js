import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseSkillMarkdown } from './npm-skill-import.js';

const MAX_SKILLS = 100;
const MAX_SKILL_BYTES = 50_000;

async function readSkill(path, fallbackName, location) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > MAX_SKILL_BYTES) return null;
    const markdown = await readFile(path, 'utf8');
    const parsed = parseSkillMarkdown(markdown, fallbackName, `Installed on this device at ${location}`);
    if (!parsed.content || !parsed.name || !parsed.description) return null;
    const id = `device-${createHash('sha256').update(resolve(path)).digest('hex').slice(0, 16)}`;
    return { id, ...parsed, source: { type: 'device', location }, enabled: false };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

export async function discoverDeviceSkills(roots) {
  const found = new Map();
  for (const root of roots) {
    if (found.size >= MAX_SKILLS) break;
    let rootMetadata;
    try { rootMetadata = await lstat(root.path); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    // Do not follow symlink roots or symlinked skill folders/files. This is a read-only local import.
    if (!rootMetadata.isDirectory()) continue;
    let entries;
    try { entries = await readdir(root.path, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    const rootSkill = await readSkill(join(root.path, 'SKILL.md'), basename(root.path), `${root.label}/SKILL.md`);
    if (rootSkill) found.set(rootSkill.id, rootSkill);
    for (const entry of entries) {
      if (found.size >= MAX_SKILLS) break;
      if (!entry.isDirectory()) continue;
      const location = `${root.label}/${entry.name}`;
      const skill = await readSkill(join(root.path, entry.name, 'SKILL.md'), entry.name, location);
      if (skill) found.set(skill.id, skill);
    }
  }
  return [...found.values()];
}
