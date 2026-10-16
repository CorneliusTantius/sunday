import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool, validateTools, BASIC_TOOL_NAMES, MEMORY_TOOL_NAMES, makeTools, isSensitiveRepositoryEntry } from '../src/server/tools.js';

test('file access policy protects authentication files and temporary copies', () => {
  for (const name of ['auth.json', 'auth.json.backup', 'auth.json.123.tmp', '.env', 'secret.txt']) {
    assert.equal(isSensitiveRepositoryEntry(name), true, name);
  }
  assert.equal(isSensitiveRepositoryEntry('notes.md'), false);
});

test('whisper tool schema requires an existing session ID and message and is server-only', async () => {
  const tool = makeTools(['agent_whisper'])[0];
  assert.equal(tool.name, 'agent_whisper');
  assert.deepEqual(tool.parameters.required, ['agentSessionId', 'message']);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.match(tool.parameters.properties.agentSessionId.pattern, /36/);
  await assert.rejects(executeTool('agent_whisper', { agentSessionId: '00000000-0000-0000-0000-000000000000', message: 'hello' }, [], ''));
});

test('shared memory tools read and update notes without repository access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-memory-'));
  try {
    assert.deepEqual(makeTools(MEMORY_TOOL_NAMES).map(tool => tool.name), MEMORY_TOOL_NAMES);
    assert.match(await executeTool('memory_update', { title: 'Build and deployment', content: 'Production deploys use the stable branch. Roll back by redeploying the previous release.' }, [], dir), /shared note saved/i);
    const result = await executeTool('memory_search', { query: 'deployment rollback' }, [], dir);
    assert.match(result, /Build and deployment/);
    assert.match(result, /previous release/);
    await executeTool('memory_update', { title: 'Build and deployment', content: 'The release checklist now requires a health check.' }, [], dir);
    const updated = await executeTool('memory_search', { query: 'health check' }, [], dir);
    assert.match(updated, /health check/);
    assert.doesNotMatch(updated, /previous release/);
    await assert.rejects(executeTool('memory_search', { query: '  ' }, [], dir));
    const escapedName = dir.split(/[\\/]/).at(-1);
    await executeTool('memory_update', { title: `../${escapedName}`, content: 'safe title' }, [], dir);
    const entries = await readdir(dir, { withFileTypes: true });
    assert.equal(entries.length, 2);
    assert.ok(entries.every(entry => entry.isFile() && !entry.name.includes('/')));
    await assert.rejects(stat(join(tmpdir(), `${escapedName}.md`)), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('basic tools restrict paths and sensitive files to allowed repositories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-tools-'));
  try {
    const repo = join(dir, 'repo'); await mkdir(repo);
    await writeFile(join(repo, 'a.txt'), 'hello');
    await writeFile(join(repo, '.env'), 'secret');
    await symlink(dir, join(repo, 'escape'));
    assert.deepEqual(validateTools(), BASIC_TOOL_NAMES);
    assert.deepEqual(validateTools(['read_file', 'list_files', 'search_files', 'write_file']), ['read', 'edit']);
    assert.deepEqual(validateTools(['list_agents', 'whisper_to_agent']), ['agent_list', 'agent_whisper']);
    assert.throws(() => validateTools(['shell']));
    assert.equal(await executeTool('read', { path: 'repo/a.txt' }, [repo]), 'hello');
    assert.equal(await executeTool('edit', { path: 'repo/a.txt', oldText: 'hello', newText: 'world' }, [repo]), 'File edited');
    assert.equal(await executeTool('read', { path: 'repo/a.txt' }, [repo]), 'world');
    await assert.rejects(executeTool('edit', { path: 'repo/a.txt', oldText: 'missing', newText: 'x' }, [repo]));
    for (const path of ['repo/../a.txt', '/etc/passwd', 'other/a.txt', 'repo/.env', 'repo/escape/a.txt']) {
      await assert.rejects(executeTool('read', { path }, [repo]));
    }
    await assert.rejects(executeTool('read', {}, []));
    await assert.rejects(executeTool('edit', { path: 'repo/escape/file', oldText: 'x', newText: 'bad' }, [repo]));
    assert.equal((await executeTool('bash', { command: 'pwd' }, [repo])).trim(), dir);
    assert.equal((await executeTool('bash', { command: 'pwd', path: 'repo' }, [repo])).trim(), repo);
    assert.match(await executeTool('bash', { command: 'sleep 0.1; echo finished', timeout: 1000 }, [repo]), /finished/);
    assert.match(await executeTool('bash', { command: 'sleep 1', timeout: 10 }, [repo]), /Command failed/);
    await assert.rejects(executeTool('bash', { command: 'true', timeout: 300001 }, [repo]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('agent discovery is a registered, whitelisted, server-only tool', async () => {
  const tool = makeTools(['agent_list'])[0];
  assert.equal(tool.name, 'agent_list');
  assert.deepEqual(tool.parameters.properties, {});
  assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual(validateTools(['agent_list']), ['agent_list']);
  await assert.rejects(executeTool('agent_list', {}, [], ''), /Tool must be handled by the chat server/);
});

test('edit creates files with empty oldText without overwriting existing content', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'sunday-create-'));
  const path = `${repo.split('/').at(-1)}/new.txt`;
  try {
    assert.equal(await executeTool('edit', { path, oldText: '', newText: 'hello' }, [repo]), 'File edited');
    await assert.rejects(executeTool('edit', { path, oldText: '', newText: 'replacement' }, [repo]));
    assert.equal(await executeTool('read', { path }, [repo]), 'hello');
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('find searches paths and literal content without exposing sensitive or linked files', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'sunday-find-'));
  const path = repo.split('/').at(-1);
  try {
    await writeFile(join(repo, 'sample.txt'), 'first\nneedle\nneedle');
    await writeFile(join(repo, '.env'), 'needle');
    await symlink(join(repo, 'sample.txt'), join(repo, 'linked.txt'));
    await mkdir(join(repo, 'node_modules'));
    await writeFile(join(repo, 'node_modules', 'hidden.txt'), 'needle');
    const files = JSON.parse(await executeTool('find', { path, query: '.txt' }, [repo]));
    assert.deepEqual(files.matches, [`${path}/sample.txt`]);
    const hits = JSON.parse(await executeTool('find', { path, query: 'needle', mode: 'content', limit: 1 }, [repo]));
    assert.deepEqual(hits.matches, [`${path}/sample.txt:2:needle`]);
    assert.equal(hits.truncated, true);
    await assert.rejects(executeTool('find', { path: `${path}/../`, query: '' }, [repo]));
    await assert.rejects(executeTool('find', { path, mode: 'content' }, [repo]));
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('read supports larger files and precise bounded line ranges', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'sunday-read-'));
  const path = `${repo.split('/').at(-1)}/large.txt`;
  try {
    await writeFile(join(repo, 'large.txt'), 'hello\n'.repeat(20000));
    assert.equal((await executeTool('read', { path }, [repo])).length, 120000);
    assert.equal(await executeTool('read', { path, offset: 2, limit: 2 }, [repo]), 'hello\nhello');
    await writeFile(join(repo, 'large.txt'), 'hello\n'.repeat(40000));
    await assert.rejects(executeTool('read', { path }, [repo]), /smaller line range/);
    assert.equal(await executeTool('read', { path, offset: 30000, limit: 1 }, [repo]), 'hello');
    await assert.rejects(executeTool('read', { path, offset: 0 }, [repo]));
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('edit rejects overlapping matches and unsafe text without changing bytes', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'sunday-edit-safe-'));
  const path = `${repo.split('/').at(-1)}/sample.txt`;
  try {
    for (const content of [Buffer.from('aaa'), Buffer.from([0xff, 0x61]), Buffer.from('a\0b'), Buffer.alloc(5000001, 97)]) {
      await writeFile(join(repo, 'sample.txt'), content);
      await assert.rejects(executeTool('edit', { path, oldText: content.length === 3 && content[0] === 97 && content[1] === 97 ? 'aa' : 'a', newText: 'x' }, [repo]));
      assert.deepEqual(await readFile(join(repo, 'sample.txt')), content);
    }
  } finally { await rm(repo, { recursive: true, force: true }); }
});
