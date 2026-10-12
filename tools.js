import { open, lstat, readdir, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const BASIC_TOOLS = [
  { name: 'read_file', description: "Read a text file using '<repo-name>/relative-path'.", parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'list_files', description: "List '<repo-name>/relative-path'; use '.' to list allowed repository names.", parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'search_files', description: "Search '<repo-name>/relative-path'; use '.' to search all allowed repositories.", parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'write_file', description: "Write a text file using '<repo-name>/relative-path'.", parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
];
export const BASIC_TOOL_NAMES = BASIC_TOOLS.map(tool => tool.name);
export function validateTools(value) {
  if (value === undefined) return [...BASIC_TOOL_NAMES];
  if (!Array.isArray(value) || value.length > BASIC_TOOL_NAMES.length || value.some(name => !BASIC_TOOL_NAMES.includes(name)) || new Set(value).size !== value.length) throw new Error('Invalid allowed tools');
  return [...value];
}
export function makeTools(names) { return BASIC_TOOLS.filter(tool => names.includes(tool.name)).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })); }

const sensitive = name => name === '.git' || name === '.ssh' || /^\.env(?:\.|$)/i.test(name) || /credential|secret/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name);
const within = (base, path) => path === base || path.startsWith(base + sep);
export async function executeTool(name, args, repositories) {
  if (!BASIC_TOOL_NAMES.includes(name)) throw new Error('Unknown tool');
  if (!Array.isArray(repositories) || !repositories.length) throw new Error('No repositories are allowed for this session');
  args ||= {};
  const raw = args.path ?? '.';
  if (typeof raw !== 'string' || raw.includes('\\') || raw.startsWith('/') || raw.split('/').includes('..')) throw new Error('Invalid repository path');
  if (name === 'write_file' && (typeof args.content !== 'string' || args.content.length > 50000)) throw new Error('Invalid file content');
  if (name === 'search_files' && (typeof args.query !== 'string' || !args.query)) throw new Error('Search query required');
  async function rootInfo(root) {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid repository root');
    return { name: root.split(/[\\/]/).filter(Boolean).at(-1), base: resolve(root) };
  }
  const roots = await Promise.all(repositories.map(rootInfo));
  async function safePath(root, parts, creating = false) {
    let current = root.base;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part === '.') continue;
      if (sensitive(part)) throw new Error('Access to sensitive files is denied');
      current = join(current, part);
      try {
        const st = await lstat(current);
        if (st.isSymbolicLink()) throw new Error('Symlinks are denied');
        if (i < parts.length - 1 && !st.isDirectory()) throw new Error('Invalid repository path');
      } catch (e) {
        if (e.code !== 'ENOENT' || !creating || i !== parts.length - 1) throw e;
      }
    }
    if (!within(root.base, current)) throw new Error('Path is outside allowed repositories');
    return current;
  }
  if (raw === '.' && name === 'list_files') return roots.map(x => x.name).join('\n');
  let selected, parts;
  if (raw === '.') {
    if (name === 'read_file' || name === 'write_file') throw new Error('A repository path is required');
  } else {
    const slash = raw.indexOf('/');
    const repoName = slash < 0 ? raw : raw.slice(0, slash);
    selected = roots.find(root => root.name === repoName);
    if (!selected) throw new Error('Repository name is required');
    parts = slash < 0 ? [] : raw.slice(slash + 1).split('/');
  }
  const targets = selected ? [selected] : roots;
  const results = [];
  for (const root of targets) {
    const path = await safePath(root, selected ? parts : [], name === 'write_file');
    if (name === 'list_files') return (await readdir(path)).filter(item => !sensitive(item)).join('\n');
    if (name === 'read_file') {
      const handle = await open(path, constants.O_NOFOLLOW); // O_NOFOLLOW
      try { const st = await handle.stat(); if (!st.isFile() || st.size > 50000) throw new Error('File is too large or not a regular file'); return await handle.readFile('utf8'); } finally { await handle.close(); }
    }
    if (name === 'write_file') {
      await mkdir(dirname(path), { recursive: true });
      // Revalidate created parents before opening without following the final symlink.
      await safePath(root, parts.slice(0, -1));
      const handle = await open(path, constants.O_NOFOLLOW | constants.O_CREAT | constants.O_WRONLY, 0o600);
      try { if (!(await handle.stat()).isFile()) throw new Error('Not a regular file'); await handle.truncate(0); await handle.writeFile(args.content, 'utf8'); } finally { await handle.close(); }
      return 'File written';
    }
    const resultsForRoot = [];
    async function walk(dir, depth) {
      if (depth > 12 || resultsForRoot.length >= 100) return;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries.slice(0, 1000)) {
        if (entry.isSymbolicLink() || sensitive(entry.name) || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const file = join(dir, entry.name);
        if (entry.isDirectory()) await walk(file, depth + 1);
        else if (entry.isFile()) try {
          const handle = await open(file, constants.O_NOFOLLOW);
          let text;
          try { if ((await handle.stat()).size > 50000) continue; text = await handle.readFile('utf8'); } finally { await handle.close(); }
          if (text.includes(args.query)) resultsForRoot.push(`${relative(path, file)}: ${text.split('\n').filter(line => line.includes(args.query)).slice(0, 5).join('\n')}`);
        } catch {}
        if (resultsForRoot.length >= 100) break;
      }
    }
    await walk(path, 0);
    results.push(...resultsForRoot.map(result => `${root.name}/${result}`));
  }
  return results.join('\n').slice(0, 20000);
}
