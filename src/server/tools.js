import { open, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const BASIC_TOOLS = [
  { name: 'subagent_create', description: 'Create a persistent child session (maximum three). Optionally assign its first prompt and wait for the response. Children have isolated repository copies.', parameters: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 20000 } }, additionalProperties: false } },
  { name: 'subagent_send_prompt', description: 'Send work to an idle child session and wait for its response.', parameters: { type: 'object', properties: { sessionId: { type: 'string' }, prompt: { type: 'string', minLength: 1, maxLength: 20000 } }, required: ['sessionId', 'prompt'], additionalProperties: false } },
  { name: 'subagent_list', description: 'List your child sessions, running state, and latest assistant message.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read', description: "Prefer this over shell scripts for reading text files up to 200000 bytes; optional 1-based offset and limit select lines from files up to 5 MB. Output exceeding 200000 bytes requires a smaller line range using '<repo-name>/relative-path'.", parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 10000 } }, required: ['path'], additionalProperties: false } },
  { name: 'find', description: "Find files or literal text under a repository path. query is a case-sensitive substring; mode defaults to path, content returns path:line:text. Skips sensitive files, symlinks, node_modules, dist, build, and vendor. Bounded results report truncation; narrow path/query if needed.", parameters: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string', maxLength: 1000 }, mode: { type: 'string', enum: ['path', 'content'] }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['path'], additionalProperties: false } },
  { name: 'edit', description: "Prefer this over shell scripts for edits. Replace text that occurs exactly once using '<repo-name>/relative-path'. Use empty oldText to write a new or empty file; nonempty files are never overwritten in this mode.", parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'], additionalProperties: false } },
  { name: 'bash', description: 'Run a bash command from the agent workspace by default, or use path to start in an allowed repository or subdirectory. Commands may change directories. Optional timeout is in milliseconds (default 30000, maximum 300000).', parameters: { type: 'object', properties: { command: { type: 'string' }, path: { type: 'string' }, timeout: { type: 'integer', minimum: 1, maximum: 300000 } }, required: ['command'], additionalProperties: false } },
  { name: 'context_search', description: 'Search indexed context for relevant source passages. Use a short keyword or phrase query.', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 300 } }, required: ['query'], additionalProperties: false } },
  { name: 'context_index', description: 'Index selected text or a durable note for future retrieval. Re-indexing the same source replaces its content. Never index secrets or private user data.', parameters: { type: 'object', properties: { source: { type: 'string', minLength: 1, maxLength: 300 }, title: { type: 'string', minLength: 1, maxLength: 120 }, content: { type: 'string', minLength: 1, maxLength: 200000 } }, required: ['source', 'title', 'content'], additionalProperties: false } },
  { name: 'context_links', description: 'List incoming and outgoing links and related note titles for an indexed context source.', parameters: { type: 'object', properties: { source: { type: 'string', minLength: 1, maxLength: 300 } }, required: ['source'], additionalProperties: false } },
  { name: 'context_link', description: 'Create or update a directed link between indexed context sources.', parameters: { type: 'object', properties: { source: { type: 'string', minLength: 1, maxLength: 300 }, target: { type: 'string', minLength: 1, maxLength: 300 }, relation: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['source', 'target'], additionalProperties: false } },
  { name: 'context_unlink', description: 'Remove a directed link between indexed context sources.', parameters: { type: 'object', properties: { source: { type: 'string', minLength: 1, maxLength: 300 }, target: { type: 'string', minLength: 1, maxLength: 300 } }, required: ['source', 'target'], additionalProperties: false } },
  { name: 'context_compress', description: 'Summarize older conversation history to reduce context for the rest of this response. The original transcript is retained. Use only for long conversations.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agent_list', description: 'List other agent sessions with their exact session IDs, names, and responsibilities. Use this to discover delegation targets before whispering.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agent_whisper', description: 'Send a prompt to another existing agent session and wait for its answer. Choose the target from the available agent sessions or agent_list; agents cannot whisper recursively.', parameters: { type: 'object', properties: { agentSessionId: { type: 'string', pattern: '^[a-f0-9-]{36}$' }, message: { type: 'string', minLength: 1, maxLength: 20000 } }, required: ['agentSessionId', 'message'], additionalProperties: false } },
];
export const REPOSITORY_TOOL_NAMES = ['read', 'find', 'edit', 'bash'];
export const CONTEXT_TOOL_NAMES = ['context_search', 'context_index', 'context_links', 'context_link', 'context_unlink', 'context_compress'];
export const BASIC_TOOL_NAMES = BASIC_TOOLS.map(tool => tool.name);
export function validateTools(value) {
  if (value === undefined) return [...BASIC_TOOL_NAMES];
  if (!Array.isArray(value)) throw new Error('Invalid allowed tools');
  // Migrate persisted tool names to their current implementations.
  const migrated = value.map(name => ({ read_file: 'read', write_file: 'edit', create_subagent: 'subagent_create', send_subagent_prompt: 'subagent_send_prompt', list_subagents: 'subagent_list', list_agents: 'agent_list', whisper_to_agent: 'agent_whisper', memory_search: 'context_search', memory_update: 'context_index' })[name] ?? (['list_files', 'search_files'].includes(name) ? null : name)).filter(Boolean);
  if (migrated.some(name => !BASIC_TOOL_NAMES.includes(name)) || new Set(migrated).size !== migrated.length) throw new Error('Invalid allowed tools');
  // Existing unrestricted profiles predate orchestration tools; preserve custom restrictions.
  const orchestration = ['subagent_create', 'subagent_send_prompt', 'subagent_list'];
  const linkTools = ['context_links', 'context_link', 'context_unlink'];
  const legacyUnrestrictedTools = BASIC_TOOL_NAMES.filter(name => name !== 'find' && name !== 'context_compress' && !orchestration.includes(name) && !linkTools.includes(name));
  if (legacyUnrestrictedTools.every(name => migrated.includes(name))) {
    for (const name of [...orchestration, 'find', 'context_compress', ...linkTools]) if (!migrated.includes(name)) migrated.push(name);
  }
  return migrated;
}
export function makeTools(names) { return BASIC_TOOLS.filter(tool => names.includes(tool.name)).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })); }

export const isSensitiveRepositoryEntry = name => name === '.git' || name === '.ssh' || /^auth\.json(?:\.|$)/i.test(name) || /^\.env(?:\.|$)/i.test(name) || /credential|secret/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name);
const within = (base, path) => path === base || path.startsWith(base + sep);
async function executeContextTool(name, args, contextStore) {
  if (!contextStore) throw new Error('Context storage is unavailable');
  if (name === 'context_search') {
    const matches = contextStore.search(args.query, 5);
    if (!matches.length) return 'No indexed context matched that query.';
    return matches.map(item => `## ${item.title}\nSource: ${item.source}\n${item.excerpt}`).join('\n\n');
  }
  if (name === 'context_links') return JSON.stringify(contextStore.links(args.source));
  if (name === 'context_link') return JSON.stringify(contextStore.linkSources(args.source, args.target, args.relation));
  if (name === 'context_unlink') return JSON.stringify({ source: args.source, target: args.target, deleted: contextStore.unlinkSources(args.source, args.target) });
  if (typeof args.source !== 'string' || !args.source.trim() || args.source.trim().length > 300 ||
      typeof args.title !== 'string' || !args.title.trim() || args.title.trim().length > 120 ||
      typeof args.content !== 'string' || !args.content.trim() || args.content.length > 200000) {
    throw new Error('Invalid context source');
  }
  const result = contextStore.index(args.source, args.title, args.content);
  return result.indexed ? `Indexed ${result.source} (${result.added} new, ${result.updated} changed, ${result.reused} unchanged chunks).` : `No changes to ${result.source} (${result.chunks} chunks).`;
}
export async function executeTool(name, args, repositories, contextStore, signal) {
  signal?.throwIfAborted();
  if (!BASIC_TOOL_NAMES.includes(name)) throw new Error('Unknown tool');
  if (name === 'agent_whisper' || name === 'agent_list' || name === 'context_compress') throw new Error('Tool must be handled by the chat server');
  args ||= {};
  if (CONTEXT_TOOL_NAMES.includes(name)) return executeContextTool(name, args, contextStore);
  if (!Array.isArray(repositories) || !repositories.length) throw new Error('No repositories are allowed for this session');
  const raw = args.path ?? '.';
  if (typeof raw !== 'string' || raw.includes('\\') || raw.startsWith('/') || raw.split('/').includes('..')) throw new Error('Invalid repository path');
  if (name === 'bash' && (typeof args.command !== 'string' || args.command.length > 10000 || (args.timeout !== undefined && (!Number.isInteger(args.timeout) || args.timeout < 1 || args.timeout > 300000)))) throw new Error('Invalid bash command or timeout');
  if (name === 'edit' && (typeof args.oldText !== 'string' || typeof args.newText !== 'string' || args.newText.length > 50000)) throw new Error('Invalid edit arguments');
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
  if (!['bash', 'find'].includes(name) && parts.length === 0) throw new Error('A file path is required');
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
      const { stdout, stderr } = await execFileAsync('bash', ['-c', args.command], { cwd, maxBuffer: 10 * 1024 * 1024, timeout: args.timeout ?? 30000, signal });
      return stdout + stderr;
    } catch (error) {
      const output = `${error.message}\n${error.stdout || ''}${error.stderr || ''}`;
      return error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? `${output}\n[Output truncated: bash exceeded the 10 MB per-stream capture limit.]` : output;
    }
  }
  if (name === 'find') {
    const { query = '', mode = 'path', limit = 100 } = args;
    if (typeof query !== 'string' || query.length > 1000 || !['path', 'content'].includes(mode) || (mode === 'content' && !query) || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid find arguments');
    const matches = [];
    let visited = 0, bytes = 0, truncated = false;
    async function visit(target, relative) {
      signal?.throwIfAborted();
      if (++visited > 20000 || matches.length >= limit || bytes >= 190000) { truncated = true; return; }
      const info = await lstat(target);
      if (info.isSymbolicLink()) return;
      if (info.isDirectory()) {
        for (const entry of await readdir(target, { withFileTypes: true })) {
          if (isSensitiveRepositoryEntry(entry.name) || ['node_modules', 'dist', 'build', 'vendor'].includes(entry.name)) continue;
          await visit(join(target, entry.name), `${relative}/${entry.name}`);
          if (truncated) break;
        }
      } else if (info.isFile()) {
        if (mode === 'path') { if (relative.includes(query)) { matches.push(relative); bytes += Buffer.byteLength(relative); } return; }
        if (info.size > 1000000) return;
        const handle = await open(target, constants.O_NOFOLLOW);
        let text;
        try { text = await handle.readFile('utf8'); } finally { await handle.close(); }
        if (text.includes('\0')) return;
        for (const [index, line] of text.split('\n').entries()) if (line.includes(query)) {
          const match = `${relative}:${index + 1}:${line.slice(0, 1000)}`;
          matches.push(match); bytes += Buffer.byteLength(match);
          if (matches.length >= limit || bytes >= 190000) { truncated = true; break; }
        }
      }
    }
    await visit(path, raw.replace(/\/$/, ''));
    return JSON.stringify({ matches, truncated });
  }
  if (name === 'read') {
    const { offset = 1, limit } = args;
    if (!Number.isInteger(offset) || offset < 1 || (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 10000))) throw new Error('Invalid read range');
    const handle = await open(path, constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 5000000) throw new Error('File exceeds 5 MB or is not a regular file');
      const text = await handle.readFile('utf8');
      if (text.includes('\0')) throw new Error('Binary files are not supported');
      const result = offset === 1 && limit === undefined ? text : text.split('\n').slice(offset - 1, limit === undefined ? undefined : offset - 1 + limit).join('\n');
      if (Buffer.byteLength(result) > 200000) throw new Error('Output exceeds 200000 bytes; use offset and limit to read a smaller line range');
      return result;
    } finally { await handle.close(); }
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
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 5000000) throw new Error('File exceeds 5 MB or is not a regular file');
    const original = await handle.readFile();
    const content = original.toString('utf8');
    if (content.includes('\0') || !Buffer.from(content, 'utf8').equals(original)) throw new Error('Binary or invalid UTF-8 files are not supported');
    const first = content.indexOf(args.oldText);
    if (args.oldText === '' ? content.length > 0 : first < 0 || content.indexOf(args.oldText, first + 1) >= 0) throw new Error('Old text must match exactly once');
    await handle.truncate(0);
    const updated = Buffer.from(content.slice(0, first) + args.newText + content.slice(first + args.oldText.length), 'utf8');
    let offset = 0;
    while (offset < updated.length) offset += (await handle.write(updated, offset, updated.length - offset, offset)).bytesWritten;
    return 'File edited';
  } finally { await handle.close(); }
}
