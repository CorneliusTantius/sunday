import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, open, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

test('pinned editor handles must retain their exact validated paths', async () => {
  const source = await readFile(new URL('../src/server/index.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('async function checkEditorLocation('), source.indexOf('async function fileEditor('));
  const paths = new Map([['/proc/self/fd/1', '/tmp/sunday'], ['/proc/self/fd/2', '/tmp/sunday/notes']]);
  const check = runInNewContext(`${helper}\ncheckEditorLocation`, { readlink: async path => paths.get(path) });
  const root = { fd: 1 }, handle = { fd: 2 };
  await check(root, handle, '/tmp/sunday', 'notes');
  for (const moved of ['/tmp/outside/notes', '/tmp/sunday/.ssh/notes', '/tmp/sunday/renamed', '/tmp/sunday/notes (deleted)']) {
    paths.set('/proc/self/fd/2', moved);
    await assert.rejects(check(root, handle, '/tmp/sunday', 'notes'), /moved outside/);
  }
  paths.set('/proc/self/fd/2', '/tmp/sunday/notes');
  paths.set('/proc/self/fd/1', '/tmp/renamed-sunday');
  await assert.rejects(check(root, handle, '/tmp/sunday', 'notes'), /moved outside/);
});

test('home editor confines existing UTF-8 files and uses API authorization', async t => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-editor-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const root = join(home, 'sunday');
  await mkdir(join(root, 'notes/nested'), { recursive: true });
  await mkdir(join(root, 'workspace/repos/demo/src'), { recursive: true });
  await writeFile(join(root, 'notes/a.txt'), 'hello 🌍\n');
  await writeFile(join(root, 'workspace/repos/demo/src/repository.txt'), 'repository\n');
  await writeFile(join(root, '.env'), 'private');
  await writeFile(join(root, 'auth.json'), '{}');
  await writeFile(join(root, 'auth.json.backup'), '{}');
  await writeFile(join(root, 'secret.txt'), 'private');
  await writeFile(join(root, 'binary'), Buffer.from([0, 1]));
  await writeFile(join(root, 'invalid'), Buffer.from([255]));
  await writeFile(join(root, 'large'), 'a'.repeat(256 * 1024 + 1));
  const outside = join(home, 'outside');
  await writeFile(outside, 'outside');
  await symlink(home, join(root, 'escape'));
  await symlink(outside, join(root, 'alias'));
  await link(outside, join(root, 'hardlink'));
  await symlink(join(root, 'notes'), join(root, 'linked'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server/index.js', import.meta.url)), '--production'], { env: { ...process.env, HOME: home, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out')), 10000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exited ${code}`)); });
    });
    async function api(endpoint, params = {}, body, headers = {}) {
      const response = await fetch(`http://127.0.0.1:${port}/api/${endpoint}?${new URLSearchParams(params)}`, body === undefined ? { headers } : { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch { result = text; }
      return { status: response.status, body: result };
    }
    const read = path => api('file', { path });
    const save = (path, content, originalContent = 'hello 🌍\n') => api('file', {}, { path, content, originalContent });
    const search = q => api('files/search', { q });

    await t.test('lists and edits HOME/sunday files outside repositories without a repo parameter', async () => {
      const listing = await api('files', { path: '' });
      assert.equal(listing.status, 200);
      assert.deepEqual(Object.keys(listing.body).sort(), ['entries', 'path', 'root']);
      assert.equal(listing.body.root, root);
      assert.equal(listing.body.path, '');
      assert.ok(listing.body.entries.some(entry => entry.name === 'notes' && entry.type === 'directory'));
      assert.ok(!listing.body.entries.some(entry => ['.env', 'auth.json', 'secret.txt', 'alias', 'escape', 'linked', 'hardlink'].includes(entry.name)));
      const notes = await api('files', { path: 'notes' });
      assert.equal(notes.status, 200);
      assert.equal(notes.body.path, 'notes');
      assert.ok(notes.body.entries.some(entry => entry.name === 'a.txt' && entry.type === 'file'));
      assert.deepEqual(await read('notes/a.txt'), { status: 200, body: { path: 'notes/a.txt', content: 'hello 🌍\n' } });
      const previous = await open(join(root, 'notes/a.txt'), 'r');
      try {
        assert.deepEqual(await save('notes/a.txt', 'updated'), { status: 200, body: { path: 'notes/a.txt', saved: true } });
        assert.equal(await previous.readFile('utf8'), 'hello 🌍\n', 'save replaces the file atomically rather than overwriting its inode');
      } finally { await previous.close(); }
      assert.equal(await readFile(join(root, 'notes/a.txt'), 'utf8'), 'updated');
      assert.deepEqual(await read('workspace/repos/demo/src/repository.txt'), { status: 200, body: { path: 'workspace/repos/demo/src/repository.txt', content: 'repository\n' } });
    });

    await t.test('supports absolute and tilde roots with confined search and saves', async () => {
      const custom = join(home, 'projects');
      await mkdir(join(custom, 'nested'), { recursive: true });
      await writeFile(join(custom, 'nested/custom.txt'), 'custom');
      for (const chosen of [custom, '~/projects', `${custom}/`]) {
        const listing = await api('files', { root: chosen });
        assert.equal(listing.status, 200);
        assert.equal(listing.body.root, custom);
        assert.deepEqual(await api('file', { root: chosen, path: 'nested/custom.txt' }), { status: 200, body: { path: 'nested/custom.txt', content: 'custom' } });
        assert.deepEqual(await api('files/search', { root: chosen, q: 'custom' }), { status: 200, body: { files: ['nested/custom.txt'], truncated: false } });
        assert.deepEqual(await api('files/search', { root: chosen, q: 'repository' }), { status: 200, body: { files: [], truncated: false } });
      }
      assert.equal((await api('files', { root: '~' })).body.root, home);
      assert.equal((await api('files', { root: '/' })).body.root, '/');
      assert.equal((await api('file', {}, { root: '~/projects', path: 'nested/custom.txt', content: 'saved', originalContent: 'custom' })).status, 200);
      assert.equal(await readFile(join(custom, 'nested/custom.txt'), 'utf8'), 'saved');
      for (const path of ['../outside', '/outside', 'nested/../../outside']) {
        assert.equal((await api('file', { root: custom, path })).status, 400);
        assert.equal((await api('file', {}, { root: custom, path, content: 'escape', originalContent: 'outside' })).status, 400);
      }
      await symlink(home, join(custom, 'escape'));
      await link(outside, join(custom, 'hardlink'));
      for (const path of ['escape/outside', 'hardlink']) assert.equal((await api('file', { root: custom, path })).status, 400);
      assert.equal(await readFile(outside, 'utf8'), 'outside');
    });

    await t.test('serializes saves to the same file through overlapping roots', async () => {
      const custom = join(home, 'projects');
      const results = await Promise.all([
        api('file', {}, { root: custom, path: 'nested/custom.txt', content: 'first', originalContent: 'saved' }),
        api('file', {}, { root: join(custom, 'nested'), path: 'custom.txt', content: 'second', originalContent: 'saved' }),
      ]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
      const successful = results[0].status === 200 ? 'first' : 'second';
      assert.equal(await readFile(join(custom, 'nested/custom.txt'), 'utf8'), successful);
    });

    await t.test('rejects malformed, sensitive and intermediate symlink roots', async () => {
      for (const sensitive of ['.ssh', '.git', '.env.local', 'credentials', 'secret-store', 'auth.json.backup', 'private.key']) {
        await mkdir(join(home, sensitive, 'nested'), { recursive: true });
        for (const endpoint of ['files', 'file', 'files/search']) {
          assert.equal((await api(endpoint, { root: join(home, sensitive, 'nested'), path: 'a.txt', q: 'a' })).status, 400);
        }
        assert.equal((await api('file', {}, { root: join(home, sensitive, 'nested'), path: 'a.txt', content: 'bad', originalContent: '' })).status, 400);
      }
      await symlink(home, join(home, 'home-link'));
      for (const chosen of ['', 'projects', '~other', '../projects', '~/../projects', `${home}/../projects`, `${home}/bad\\name`, `${home}/bad\0name`, 'a'.repeat(4097), join(home, '.ssh/nested'), join(home, 'home-link/projects'), join(root, 'linked'), join(home, 'outside')]) {
        for (const endpoint of ['files', 'file', 'files/search']) {
          assert.equal((await api(endpoint, { root: chosen, path: 'nested/custom.txt', q: 'custom' })).status, 400, `${endpoint}: ${JSON.stringify(chosen)}`);
        }
        assert.equal((await api('file', {}, { root: chosen, path: 'nested/custom.txt', content: 'bad', originalContent: 'saved' })).status, 400);
      }
      for (const chosen of [null, 1, {}, []]) assert.equal((await api('file', {}, { root: chosen, path: 'notes/a.txt', content: 'bad', originalContent: 'updated' })).status, 400);
    });

    await t.test('rejects unsafe paths, links, sensitive files, invalid text and unauthorized requests', async () => {
      for (const path of ['', '../outside', '/etc/passwd', 'notes/../../outside', 'notes\\a.txt', 'notes/./a.txt', 'notes//a.txt', 'notes/\0a.txt', '.env', 'auth.json', 'data/auth.json', 'auth.json.backup', '.git/config', 'secret.txt', 'escape/outside', 'alias', 'hardlink', 'linked/a.txt', 'binary', 'invalid', 'large', 'notes']) {
        assert.equal((await read(path)).status, 400, path);
        assert.equal((await save(path, 'changed')).status, 400, path);
      }
      for (const path of ['../outside', '/etc', 'notes/../../outside', 'notes\\nested', 'escape', 'linked', '.git']) {
        assert.equal((await api('files', { path })).status, 400, path);
      }
      assert.equal((await save('missing', 'new')).status, 404);
      assert.equal((await save('notes/a.txt', '\0', 'updated')).status, 400);
      for (const content of ['\ud800', '\udfff', 'before\ud800after']) {
        const result = await save('notes/a.txt', content, 'updated');
        assert.equal(result.status, 400);
        assert.match(result.body.error, /well-formed Unicode/);
      }
      assert.equal((await save('notes/a.txt', 'a'.repeat(256 * 1024 + 1), 'updated')).status, 400);
      assert.equal((await api('file', {}, { path: 'notes/a.txt', content: 'no version' })).status, 400);
      const headers = { Origin: 'https://evil.example' };
      assert.equal((await api('files', { path: '' }, undefined, headers)).status, 403);
      assert.equal((await api('files/search', { q: 'a.txt' }, undefined, headers)).status, 403);
      assert.equal((await api('file', { path: 'notes/a.txt' }, undefined, headers)).status, 403);
      assert.equal((await api('file', {}, { path: 'notes/a.txt', content: 'unauthorized', originalContent: 'updated' }, headers)).status, 403);
      assert.equal(await readFile(outside, 'utf8'), 'outside');
      assert.equal(await readFile(join(root, 'notes/a.txt'), 'utf8'), 'updated');
    });

    await t.test('round-trips exact-limit text including maximally JSON-escaped content', async () => {
      const path = 'notes/limit.txt';
      const content = '\u0001'.repeat(256 * 1024);
      await writeFile(join(root, path), content);
      assert.deepEqual(await read(path), { status: 200, body: { path, content } });
      assert.equal((await save(path, content, content)).status, 200);
      assert.equal(await readFile(join(root, path), 'utf8'), content);
      await rm(join(root, path));
    });

    await t.test('serializes concurrent saves and rejects stale versions without modifying the file', async () => {
      const saves = await Promise.all([
        save('notes/a.txt', 'first', 'updated'),
        save('notes/a.txt', 'second longer', 'updated'),
      ]);
      assert.deepEqual(saves.map(result => result.status).sort(), [200, 400]);
      const saved = await readFile(join(root, 'notes/a.txt'), 'utf8');
      assert.ok(['first', 'second longer'].includes(saved));
      assert.equal((await save('notes/a.txt', 'stale', 'updated')).status, 400);
      assert.equal(await readFile(join(root, 'notes/a.txt'), 'utf8'), saved);
    });

    await t.test('searches recursively by case-insensitive filename substring, not content or directory name', async () => {
      await writeFile(join(root, 'notes/nested/MyNeedle.TXT'), 'plain text');
      await writeFile(join(root, 'workspace/repos/demo/src/needle.js'), 'plain text');
      await writeFile(join(root, 'notes/content-only.txt'), 'needle');
      await mkdir(join(root, 'needle-directory'));
      await writeFile(join(root, 'needle-directory/unrelated.txt'), 'plain text');
      const result = await search('nEeDlE');
      assert.equal(result.status, 200);
      assert.deepEqual(Object.keys(result.body).sort(), ['files', 'truncated']);
      assert.deepEqual(result.body.files.slice().sort(), ['notes/nested/MyNeedle.TXT', 'workspace/repos/demo/src/needle.js']);
      assert.equal(result.body.truncated, false);
      assert.deepEqual(await search('no-such-filename'), { status: 200, body: { files: [], truncated: false } });
    });

    await t.test('search excludes symlinks, hardlinks, sensitive files, hidden directories and node_modules', async () => {
      for (const directory of ['.hidden', '.git', 'node_modules', 'notes/.hidden', 'notes/node_modules']) {
        await mkdir(join(root, directory), { recursive: true });
        await writeFile(join(root, directory, 'needle.txt'), 'private');
      }
      await symlink(join(root, 'notes/nested/MyNeedle.TXT'), join(root, 'needle-link.txt'));
      await symlink(join(root, 'notes/nested'), join(root, 'needle-linked-directory'));
      await link(outside, join(root, 'needle-hardlink.txt'));
      const result = await search('needle');
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.files.slice().sort(), ['notes/nested/MyNeedle.TXT', 'workspace/repos/demo/src/needle.js']);
      assert.equal(result.body.truncated, false);
      for (const query of ['auth.json', '.env', 'secret.txt', 'hardlink', 'alias']) {
        assert.deepEqual(await search(query), { status: 200, body: { files: [], truncated: false } }, query);
      }
    });

    await t.test('rejects missing, empty, invalid and overlong search queries', async () => {
      assert.equal((await api('files/search')).status, 400);
      for (const query of ['', '   ', '\0', 'a'.repeat(257)]) {
        assert.equal((await search(query)).status, 400, JSON.stringify(query));
      }
      assert.equal((await search('a'.repeat(256))).status, 200);
    });

    await t.test('removes the old repository editor endpoints', async () => {
      assert.equal((await api('repos/files', { repo: 'demo', path: '' })).status, 404);
      assert.equal((await api('repos/file', { repo: 'demo', path: 'src/repository.txt' })).status, 404);
      assert.equal((await api('repos/file', {}, { repo: 'demo', path: 'src/repository.txt', content: 'changed', originalContent: 'repository\n' })).status, 404);
      assert.equal(await readFile(join(root, 'workspace/repos/demo/src/repository.txt'), 'utf8'), 'repository\n');
    });

    await t.test('caps search results at 500 and reports truncation', async () => {
      const directory = join(root, 'result-limit');
      await mkdir(directory);
      try {
        await Promise.all(Array.from({ length: 501 }, (_, i) => writeFile(join(directory, `bounded-match-${i}.txt`), '')));
        const result = await search('bounded-match');
        assert.equal(result.status, 200);
        assert.equal(result.body.files.length, 500);
        assert.equal(new Set(result.body.files).size, 500);
        assert.ok(result.body.files.every(path => /^result-limit\/bounded-match-\d+\.txt$/.test(path)));
        assert.equal(result.body.truncated, true);
      } finally { await rm(directory, { recursive: true, force: true }); }
    });

    await t.test('bounds traversal at 10000 entries even when there are no matches', async () => {
      const directory = join(root, 'traversal-limit');
      await mkdir(directory);
      try {
        for (let start = 0; start < 10001; start += 100) {
          await Promise.all(Array.from({ length: Math.min(100, 10001 - start) }, (_, i) => writeFile(join(directory, `entry-${start + i}.txt`), '')));
        }
        const result = await search('no-such-filename');
        assert.deepEqual(result, { status: 200, body: { files: [], truncated: true } });
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await rm(home, { recursive: true, force: true });
  }
});
