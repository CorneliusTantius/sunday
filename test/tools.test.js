import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir, stat } from 'node:fs/promises';
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
  const tool = makeTools(['whisper_to_agent'])[0];
  assert.equal(tool.name, 'whisper_to_agent');
  assert.deepEqual(tool.parameters.required, ['agentSessionId', 'message']);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.match(tool.parameters.properties.agentSessionId.pattern, /36/);
  await assert.rejects(executeTool('whisper_to_agent', { agentSessionId: '00000000-0000-0000-0000-000000000000', message: 'hello' }, [], ''));
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
  const tool = makeTools(['list_agents'])[0];
  assert.equal(tool.name, 'list_agents');
  assert.deepEqual(tool.parameters.properties, {});
  assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual(validateTools(['list_agents']), ['list_agents']);
  await assert.rejects(executeTool('list_agents', {}, [], ''), /Tool must be handled by the chat server/);
});
