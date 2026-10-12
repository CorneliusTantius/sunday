import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool, validateTools, BASIC_TOOL_NAMES } from '../src/server/tools.js';

test('basic tools restrict paths and sensitive files to allowed repositories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-tools-'));
  try {
    const repo = join(dir, 'repo'); await mkdir(repo);
    await writeFile(join(repo, 'a.txt'), 'hello');
    await writeFile(join(repo, '.env'), 'secret');
    await symlink(dir, join(repo, 'escape'));
    assert.deepEqual(validateTools(), BASIC_TOOL_NAMES);
    assert.throws(() => validateTools(['shell']));
    assert.equal(await executeTool('read_file', { path: 'repo/a.txt' }, [repo]), 'hello');
    await executeTool('write_file', { path: 'repo/b.txt', content: 'world' }, [repo]);
    assert.equal(await executeTool('read_file', { path: 'repo/b.txt' }, [repo]), 'world');
    for (const path of ['repo/../a.txt', '/etc/passwd', 'other/a.txt', 'repo/.env', 'repo/escape/a.txt']) {
      await assert.rejects(executeTool('read_file', { path }, [repo]));
    }
    await assert.rejects(executeTool('list_files', {}, []));
    await assert.rejects(executeTool('write_file', { path: 'repo/escape/file', content: 'bad' }, [repo]));
    await assert.rejects(executeTool('list_files', {}, [join(repo, 'escape')]));
    assert.equal(await executeTool('search_files', { query: 'secret' }, [repo]), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
