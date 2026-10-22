import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigStorage } from './config-storage.js';

test('configuration storage migrates legacy JSON files and persists settings, credentials, MCP config, and personas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-config-storage-'));
  const dataDir = join(directory, 'data');
  const databasePath = join(dataDir, 'settings.sqlite');
  await mkdir(dataDir);
  const legacy = {
    'settings.json': { mode: 'api_key', model: 'legacy-model' },
    'auth.json': { 'openai:api_key': { type: 'api_key', key: 'secret' } },
    'mcp.json': { mcpServers: { example: { command: 'example' } } },
    'personas.json': [{ id: 'custom', name: 'Custom' }],
  };
  for (const [name, value] of Object.entries(legacy)) await writeFile(join(dataDir, name), JSON.stringify(value));

  try {
    let storage = createConfigStorage(databasePath);
    await storage.migrateLegacyFiles(dataDir);
    assert.deepEqual(storage.getSetting({}), legacy['settings.json']);
    assert.deepEqual(storage.getCredential('openai:api_key'), legacy['auth.json']['openai:api_key']);
    assert.deepEqual(storage.getMcpConfig({}), legacy['mcp.json']);
    assert.deepEqual(storage.listPersonas(), legacy['personas.json']);
    for (const name of Object.keys(legacy)) await assert.rejects(readFile(join(dataDir, name)), { code: 'ENOENT' });

    storage.saveSetting({ model: 'updated-model' });
    storage.saveCredential('openai:api_key', { type: 'api_key', key: 'updated-secret' });
    storage.removeCredential('missing');
    storage.saveMcpConfig({ mcpServers: {} });
    storage.savePersonas([{ id: 'next', name: 'Next' }]);
    assert.equal(storage.hasPersonas(), true);
    storage.close();

    storage = createConfigStorage(databasePath);
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ model: 'stale' }));
    await storage.migrateLegacyFiles(dataDir);
    assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')), { model: 'stale' });
    assert.deepEqual(storage.getSetting({}), { model: 'updated-model' });
    assert.deepEqual(storage.getCredential('openai:api_key'), { type: 'api_key', key: 'updated-secret' });
    assert.deepEqual(storage.listCredentials(), [['openai:api_key', { type: 'api_key', key: 'updated-secret' }]]);
    assert.deepEqual(storage.getMcpConfig({}), { mcpServers: {} });
    assert.deepEqual(storage.listPersonas(), [{ id: 'next', name: 'Next' }]);
    storage.savePersonas([]);
    storage.close();

    storage = createConfigStorage(databasePath);
    assert.deepEqual(storage.listPersonas(), []);
    assert.equal(storage.hasPersonas(), true);
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
