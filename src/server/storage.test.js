import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonStorage } from './storage.js';

test('JSON storage loads fallback and persists formatted JSON with private permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-storage-'));
  try {
    const storage = createJsonStorage(directory);
    const fallback = { initial: true };
    assert.equal(await storage.load('missing.json', fallback), fallback);
    const value = { answer: 42, nested: ['ok'] };
    await storage.save('settings.json', value);
    assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), `${JSON.stringify(value, null, 2)}\n`);
    assert.equal((await stat(join(directory, 'settings.json'))).mode & 0o777, 0o600);
    assert.deepEqual(await storage.load('settings.json'), value);
    await storage.save('settings.json', { answer: 43 });
    assert.deepEqual(await storage.load('settings.json'), { answer: 43 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JSON storage propagates malformed JSON and filesystem errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-storage-'));
  try {
    await writeFile(join(directory, 'broken.json'), '{');
    const storage = createJsonStorage(directory);
    await assert.rejects(storage.load('broken.json', {}), SyntaxError);
    await assert.rejects(storage.load('.', {}), error => error.code === 'EISDIR');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
