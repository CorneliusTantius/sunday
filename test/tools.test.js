import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool, validateTools, BASIC_TOOL_NAMES, CONTEXT_TOOL_NAMES, makeTools, isSensitiveRepositoryEntry } from '../src/server/tools.js';
import { createContextStorage } from '../src/server/context-storage.js';

test('file access policy protects authentication files and temporary copies', () => {
  for (const name of ['auth.json', 'auth.json.backup', 'auth.json.123.tmp', '.env', 'secret.txt']) {
    assert.equal(isSensitiveRepositoryEntry(name), true, name);
  }
  assert.equal(isSensitiveRepositoryEntry('notes.md'), false);
});

test('context tools index and search selected sources without repository access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-context-'));
  const store = createContextStorage(join(dir, 'context.sqlite'));
  try {
    assert.deepEqual(makeTools(CONTEXT_TOOL_NAMES).map(tool => tool.name), CONTEXT_TOOL_NAMES);
    const indexDescription = makeTools(CONTEXT_TOOL_NAMES).find(tool => tool.name === 'context_index').description;
    assert.match(indexDescription, /standardized Markdown/);
    assert.match(indexDescription, /Do not force this format onto source documents/);
    assert.deepEqual(validateTools(['memory_search', 'memory_update']), ['context_search', 'context_index']);
    const legacyUnrestricted = [...BASIC_TOOL_NAMES.filter(name => !['find', 'context_links', 'context_link', 'context_unlink'].includes(name)), 'subagent_create', 'agent_list', 'context_compress']
      .map(name => ({ context_search: 'memory_search', context_index: 'memory_update' })[name] ?? name);
    const upgradedUnrestricted = validateTools(legacyUnrestricted);
    assert.ok(!upgradedUnrestricted.includes('context_compress'));
    assert.ok(upgradedUnrestricted.includes('find'));
    assert.ok(upgradedUnrestricted.includes('context_links'));
    assert.deepEqual(validateTools(['context_search']), ['context_search']);
    assert.match(await executeTool('context_index', { source: 'release.md', title: 'Build and deployment', content: 'Production deployments use the stable branch. Roll back by redeploying the previous release.' }, [], store), /Indexed release\.md/);
    const result = await executeTool('context_search', { query: 'deployment rollback' }, [], store);
    assert.match(result, /Build and deployment/);
    assert.match(result, /previous release/);
    await executeTool('context_index', { source: 'release.md', title: 'Build and deployment', content: 'The release checklist now requires a health check.' }, [], store);
    const updated = await executeTool('context_search', { query: 'health check' }, [], store);
    assert.match(updated, /\[health\] \[check\]/);
    assert.doesNotMatch(updated, /previous release/);
    await executeTool('context_index', { source: 'architecture.md', title: 'Architecture', content: 'Services communicate through events.' }, [], store);
    assert.deepEqual(JSON.parse(await executeTool('context_link', { source: 'release.md', target: 'architecture.md', relation: 'documents' }, [], store)), { source: 'release.md', target: 'architecture.md', relation: 'documents' });
    const graphLinks = JSON.parse(await executeTool('context_links', { source: 'release.md' }, [], store));
    assert.deepEqual(graphLinks, {
      nodes: [{ source: 'architecture.md', title: 'Architecture' }],
      links: [{ source: 'release.md', target: 'architecture.md', relation: 'documents' }],
    });
    assert.match(await executeTool('context_search', { query: graphLinks.nodes[0].title }, [], store), /Architecture/);
    assert.deepEqual(JSON.parse(await executeTool('context_unlink', { source: 'release.md', target: 'architecture.md' }, [], store)), { source: 'release.md', target: 'architecture.md', deleted: true });
    await assert.rejects(executeTool('context_search', { query: '  ' }, [], store));
    assert.ok(!BASIC_TOOL_NAMES.includes('context_compress'));
    assert.deepEqual(validateTools(['context_compress', 'read']), ['read']);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
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
    assert.deepEqual(validateTools(['list_agents', 'whisper_to_agent', 'subagent_create', 'agent_list']), []);
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

test('edit creates files with empty oldText without overwriting existing content', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'sunday-create-'));
  const path = `${repo.split('/').at(-1)}/new.txt`;
  try {
    assert.equal(await executeTool('edit', { path, oldText: '', newText: 'hello' }, [repo]), 'File edited');
    await assert.rejects(executeTool('edit', { path, oldText: '', newText: 'replacement' }, [repo]));
    assert.equal(await executeTool('read', { path }, [repo]), 'hello');
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('edit validates multiple unique non-overlapping replacements before modifying the file', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'sunday-multi-edit-'));
  const path = `${repo.split('/').at(-1)}/sample.txt`;
  try {
    await writeFile(join(repo, 'sample.txt'), 'alpha beta gamma');
    assert.equal(await executeTool('edit', { path, edits: [
      { oldText: 'alpha', newText: 'A' },
      { oldText: 'gamma', newText: 'G' },
    ] }, [repo]), 'File edited');
    assert.equal(await executeTool('read', { path }, [repo]), 'A beta G');

    await assert.rejects(executeTool('edit', { path, edits: [
      { oldText: 'beta', newText: 'B' },
      { oldText: 'missing', newText: 'M' },
    ] }, [repo]));
    assert.equal(await executeTool('read', { path }, [repo]), 'A beta G');
    await assert.rejects(executeTool('edit', { path, edits: [
      { oldText: 'beta', newText: 'B' },
      { oldText: 'beta G', newText: 'X' },
    ] }, [repo]), /overlap/);
    assert.equal(await executeTool('read', { path }, [repo]), 'A beta G');
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
    assert.equal(await executeTool('read', { path, offset: 5, endLine: 10 }, [repo]), 'hello\nhello\nhello\nhello\nhello\nhello');
    assert.equal(makeTools(['read'])[0].parameters.properties.endLine.minimum, 1);
    await assert.rejects(executeTool('read', { path, offset: 10, endLine: 5 }, [repo]), /Invalid read range/);
    await assert.rejects(executeTool('read', { path, offset: 5, limit: 6, endLine: 10 }, [repo]), /Invalid read range/);
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
