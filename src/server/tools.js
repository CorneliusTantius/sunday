import { open, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const BASIC_TOOLS = [
  { name: 'read', description: "Read a text file using '<repo-name>/relative-path'.", parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'edit', description: "Replace exact text in a file using '<repo-name>/relative-path'.", parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'], additionalProperties: false } },
  { name: 'bash', description: 'Run a bash command from the agent workspace by default, or use path to start in an allowed repository or subdirectory. Commands may change directories. Optional timeout is in milliseconds (default 30000, maximum 300000).', parameters: { type: 'object', properties: { command: { type: 'string' }, path: { type: 'string' }, timeout: { type: 'integer', minimum: 1, maximum: 300000 } }, required: ['command'], additionalProperties: false } },
  { name: 'memory_search', description: 'Search shared notes for relevant saved knowledge. Use a short keyword or phrase query.', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 300 } }, required: ['query'], additionalProperties: false } },
  { name: 'memory_update', description: 'Create or replace a shared note by title. Save durable, useful knowledge for other agents; never save credentials or secrets.', parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, content: { type: 'string', minLength: 1, maxLength: 20000 } }, required: ['title', 'content'], additionalProperties: false } },
  { name: 'whisper_to_agent', description: 'Send a prompt to another existing agent session and wait for its answer. Choose the target from the available agent sessions; agents cannot whisper recursively.', parameters: { type: 'object', properties: { agentSessionId: { type: 'string', pattern: '^[a-f0-9-]{36}$' }, message: { type: 'string', minLength: 1, maxLength: 20000 } }, required: ['agentSessionId', 'message'], additionalProperties: false } },
];
export const REPOSITORY_TOOL_NAMES = ['read', 'edit', 'bash'];
export const MEMORY_TOOL_NAMES = ['memory_search', 'memory_update'];
export const BASIC_TOOL_NAMES = BASIC_TOOLS.map(tool => tool.name);
export function validateTools(value) {
  if (value === undefined) return [...BASIC_TOOL_NAMES];
  if (!Array.isArray(value)) throw new Error('Invalid allowed tools');
  // Migrate permissions persisted under the previous file-tool names.
  const migrated = value.map(name => ({ read_file: 'read', write_file: 'edit' })[name] ?? (['list_files', 'search_files'].includes(name) ? null : name)).filter(Boolean);
  if (migrated.some(name => !BASIC_TOOL_NAMES.includes(name)) || new Set(migrated).size !== migrated.length) throw new Error('Invalid allowed tools');
  return migrated;
}
export function makeTools(names) { return BASIC_TOOLS.filter(tool => names.includes(tool.name)).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })); }

export const isSensitiveRepositoryEntry = name => name === '.git' || name === '.ssh' || /^auth\.json(?:\.|$)/i.test(name) || /^\.env(?:\.|$)/i.test(name) || /credential|secret/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name);
const within = (base, path) => path === base || path.startsWith(base + sep);
function memoryFileName(title) {
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'note';
  const hash = createHash('sha256').update(title.normalize('NFKC').toLowerCase()).digest('hex').slice(0, 8);
  return `${slug}-${hash}.md`;
}
async function memoryRootInfo(memoryDir, create = false) {
  if (typeof memoryDir !== 'string' || !memoryDir) throw new Error('Shared memory is unavailable');
  if (create) await mkdir(memoryDir, { recursive: true, mode: 0o700 });
  const info = await lstat(memoryDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid shared memory directory');
  return resolve(memoryDir);
}
async function executeMemoryTool(name, args, memoryDir) {
  if (name === 'memory_search') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 300) throw new Error('Invalid memory search query');
    const root = await memoryRootInfo(memoryDir);
    const terms = [...new Set(args.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];
    if (!terms.length) throw new Error('Invalid memory search query');
    const matches = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const path = join(root, entry.name), handle = await open(path, constants.O_NOFOLLOW);
      let content;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 20000) continue;
        content = await handle.readFile('utf8');
      } finally { await handle.close(); }
      const lower = content.toLowerCase(), found = terms.filter(term => lower.includes(term));
      if (!found.length) continue;
      const position = Math.max(0, Math.min(...found.map(term => lower.indexOf(term))));
      const excerpt = content.slice(Math.max(0, position - 180), position + 900).trim();
      matches.push({ score: found.length, title: content.split('\n')[0].replace(/^#\s*/, ''), excerpt });
    }
    matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return matches.length ? matches.slice(0, 5).map(item => `## ${item.title}\n${item.excerpt}`).join('\n\n') : 'No shared notes matched that query.';
  }
  if (typeof args.title !== 'string' || !args.title.trim() || args.title.trim().length > 120 || typeof args.content !== 'string' || !args.content.trim() || args.content.length > 20000) throw new Error('Invalid shared memory note');
  const title = args.title.trim(), root = await memoryRootInfo(memoryDir, true);
  const path = join(root, memoryFileName(title)), temporary = join(root, `.${randomUUID()}.tmp`);
  const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Invalid shared memory note');
  try {
    await writeFile(temporary, `# ${title}\n\n${args.content.trim()}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  return `Shared note saved: ${title}`;
}
export async function executeTool(name, args, repositories, memoryDir, signal) {
  signal?.throwIfAborted();
  if (!BASIC_TOOL_NAMES.includes(name)) throw new Error('Unknown tool');
  if (name === 'whisper_to_agent') throw new Error('Tool must be handled by the chat server');
  args ||= {};
  if (MEMORY_TOOL_NAMES.includes(name)) return executeMemoryTool(name, args, memoryDir);
  if (!Array.isArray(repositories) || !repositories.length) throw new Error('No repositories are allowed for this session');
  const raw = args.path ?? '.';
  if (typeof raw !== 'string' || raw.includes('\\') || raw.startsWith('/') || raw.split('/').includes('..')) throw new Error('Invalid repository path');
  if (name === 'bash' && (typeof args.command !== 'string' || args.command.length > 10000 || (args.timeout !== undefined && (!Number.isInteger(args.timeout) || args.timeout < 1 || args.timeout > 300000)))) throw new Error('Invalid bash command or timeout');
  if (name === 'edit' && (typeof args.oldText !== 'string' || !args.oldText || typeof args.newText !== 'string' || args.newText.length > 50000)) throw new Error('Invalid edit arguments');
  async function rootInfo(root) {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid repository root');
    return { name: root.split(/[\\/]/).filter(Boolean).at(-1), base: resolve(root) };
  }
  const roots = await Promise.all(repositories.map(rootInfo));
  const slash = raw.indexOf('/');
  const repoName = slash < 0 ? raw : raw.slice(0, slash);
  const root = name === 'bash' && raw === '.' ? { base: resolve(dirname(roots[0].base)) } : roots.find(item => item.name === repoName);
  if (!root) throw new Error('Repository name is required');
  const parts = raw === '.' ? [] : slash < 0 ? [] : raw.slice(slash + 1).split('/');
  if (name !== 'bash' && parts.length === 0) throw new Error('A file path is required');
  let path = root.base;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part === '.') continue;
    if (isSensitiveRepositoryEntry(part)) throw new Error('Access to sensitive files is denied');
    path = join(path, part);
    try {
      const st = await lstat(path);
      if (st.isSymbolicLink()) throw new Error('Symlinks are denied');
      if (i < parts.length - 1 && !st.isDirectory()) throw new Error('Invalid repository path');
    } catch (error) {
      if (error.code !== 'ENOENT' || name !== 'edit' || i !== parts.length - 1) throw error;
    }
  }
  if (!within(root.base, path)) throw new Error('Path is outside allowed repositories');
  if (name === 'bash') {
    const cwd = path;
    const stat = await lstat(cwd);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid repository directory');
    try {
      const { stdout, stderr } = await execFileAsync('bash', ['-c', args.command], { cwd, maxBuffer: 50000, timeout: args.timeout ?? 30000, signal });
      return (stdout + stderr).slice(0, 50000);
    } catch (error) { return `${error.message}\n${error.stdout || ''}${error.stderr || ''}`.slice(0, 50000); }
  }
  if (name === 'read') {
    const handle = await open(path, constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 50000) throw new Error('File is too large or not a regular file'); return await handle.readFile('utf8'); } finally { await handle.close(); }
  }
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  // Revalidate parents created by mkdir before opening the target.
  let parent = root.base;
  for (const part of parts.slice(0, -1)) {
    if (!part || part === '.') continue;
    parent = join(parent, part);
    const stat = await lstat(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid repository path');
  }
  const handle = await open(path, constants.O_NOFOLLOW | constants.O_CREAT | constants.O_RDWR, 0o600);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file');
    const content = await handle.readFile('utf8');
    const first = content.indexOf(args.oldText);
    if (first < 0 || content.indexOf(args.oldText, first + args.oldText.length) >= 0) throw new Error('Old text must match exactly once');
    await handle.truncate(0);
    const updated = Buffer.from(content.slice(0, first) + args.newText + content.slice(first + args.oldText.length), 'utf8');
    let offset = 0;
    while (offset < updated.length) offset += (await handle.write(updated, offset, updated.length - offset, offset)).bytesWritten;
    return 'File edited';
  } finally { await handle.close(); }
}
