import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, posix } from 'node:path';
import { SkillError } from './skill-library.js';

const execFileAsync = promisify(execFile);
const MAX_SKILL_BYTES = 50_000;
const MAX_SKILLS_IN_PACKAGE = 20;

export function validateNpmPackageSpec(input) {
  if (typeof input !== 'string') throw new SkillError('Enter an npm package name, for example @team/review-skill');
  const spec = input.trim();
  const match = /^(?<name>(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@(?<version>[A-Za-z0-9][A-Za-z0-9.+~^*-]*))?$/.exec(spec);
  if (!match || spec.length > 214 || match.groups.name.length > 214) {
    throw new SkillError('Enter an npm package name with an optional version, such as @team/review-skill@1.2.0');
  }
  return spec;
}

function unquote(value) {
  const text = value.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

export function parseSkillMarkdown(markdown, fallbackName, fallbackDescription) {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  let name = '';
  let description = '';
  let content = markdown;
  if (match) {
    const lines = match[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const field = /^(name|description):\s*(.*)$/.exec(lines[i]);
      if (!field) continue;
      const key = field[1];
      const value = field[2].trim();
      if (key === 'name') name = unquote(value);
      else if (value === '>' || value === '>-' || value === '|' || value === '|-') {
        const block = [];
        while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) block.push(lines[++i].trim());
        description = block.join(value.startsWith('>') ? ' ' : '\n');
      } else description = unquote(value);
    }
    content = markdown.slice(match[0].length).trim();
  }
  return {
    name: name || fallbackName,
    description: description || fallbackDescription || `Imported npm skill: ${fallbackName}`,
    content,
  };
}

function safeArchiveSkillPath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/')) return false;
  const normalized = posix.normalize(value);
  return normalized === value && value.startsWith('package/') && !value.split('/').some(part => !part || part === '.' || part === '..') && value.endsWith('/SKILL.md');
}

async function run(execute, command, args, options, message) {
  try { return await execute(command, args, options); }
  catch { throw new SkillError(message, 502); }
}

export async function downloadNpmSkills(packageInput, { execute = execFileAsync } = {}) {
  const spec = validateNpmPackageSpec(packageInput);
  const tempDir = await mkdtemp(join(tmpdir(), 'sunday-npm-skill-'));
  try {
    const packed = await run(execute, 'npm', [
      'pack', spec, '--ignore-scripts', '--json', `--pack-destination=${tempDir}`,
      '--registry=https://registry.npmjs.org/',
    ], {
      cwd: tempDir,
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
    }, 'Could not fetch that npm package. Check the package name and try again.');

    let packageInfo;
    try { packageInfo = JSON.parse(packed.stdout)[0]; }
    catch { throw new SkillError('npm returned an invalid package archive response', 502); }
    if (!packageInfo || typeof packageInfo.filename !== 'string' || basename(packageInfo.filename) !== packageInfo.filename) {
      throw new SkillError('npm returned an invalid package archive name', 502);
    }
    const archive = join(tempDir, packageInfo.filename);
    const listing = await run(execute, 'tar', ['-tzf', archive], {
      cwd: tempDir, timeout: 15_000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    }, 'Could not inspect the npm package archive');
    const paths = [...new Set(listing.stdout.split(/\r?\n/).filter(safeArchiveSkillPath))];
    if (!paths.length) throw new SkillError('This npm package does not contain a SKILL.md file');
    if (paths.length > MAX_SKILLS_IN_PACKAGE) throw new SkillError(`This npm package contains more than ${MAX_SKILLS_IN_PACKAGE} skills`);

    const skills = [];
    for (const archivePath of paths) {
      const file = await run(execute, 'tar', ['-xOzf', archive, '--', archivePath], {
        cwd: tempDir, timeout: 15_000, maxBuffer: MAX_SKILL_BYTES + 1, encoding: 'utf8',
      }, 'Could not read a SKILL.md file from the npm package');
      if (Buffer.byteLength(file.stdout, 'utf8') > MAX_SKILL_BYTES) throw new SkillError('An npm skill is larger than 50,000 bytes');
      const directoryName = posix.basename(posix.dirname(archivePath));
      const fallbackName = directoryName === 'package' ? packageInfo.name || spec : directoryName;
      const fallbackDescription = typeof packageInfo.description === 'string' ? packageInfo.description : '';
      const parsed = parseSkillMarkdown(file.stdout, fallbackName, fallbackDescription);
      skills.push({ ...parsed, package: spec, path: archivePath.slice('package/'.length) });
    }
    return skills;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
