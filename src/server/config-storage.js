import { DatabaseSync } from 'node:sqlite';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const legacyFiles = ['settings.json', 'auth.json', 'mcp.json', 'personas.json'];

export function createConfigStorage(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_skill_preferences (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS config_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const getConfig = database.prepare('SELECT data FROM app_config WHERE key = ?');
  const setConfig = database.prepare(`
    INSERT INTO app_config (key, data) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET data = excluded.data
  `);
  const getCredentialStatement = database.prepare('SELECT data FROM credentials WHERE id = ?');
  const listCredentials = database.prepare('SELECT id, data FROM credentials ORDER BY id');
  const listSkillRows = database.prepare('SELECT data FROM skills ORDER BY id');
  const saveSkillStatement = database.prepare(`
    INSERT INTO skills (id, data) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `);
  const deleteSkillStatement = database.prepare('DELETE FROM skills WHERE id = ?');
  const listDeviceSkillPreferencesStatement = database.prepare('SELECT id, enabled FROM device_skill_preferences ORDER BY id');
  const saveDeviceSkillPreferenceStatement = database.prepare(`
    INSERT INTO device_skill_preferences (id, enabled) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled
  `);
  const setCredential = database.prepare(`
    INSERT INTO credentials (id, data) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `);
  const deleteCredential = database.prepare('DELETE FROM credentials WHERE id = ?');
  const listPersonaRows = database.prepare('SELECT data FROM personas ORDER BY rowid');
  const setPersona = database.prepare(`
    INSERT INTO personas (id, data) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `);
  const deletePersonas = database.prepare('DELETE FROM personas');

  async function migrateLegacyFiles(dataDir) {
    const marker = database.prepare("SELECT value FROM config_meta WHERE key = 'legacy_json_migrated'").get();
    if (marker) return;

    const legacy = {};
    for (const name of legacyFiles) {
      try {
        legacy[name] = JSON.parse(await readFile(join(dataDir, name), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      if (legacy['settings.json'] !== undefined && !getConfig.get('settings')) setConfig.run('settings', JSON.stringify(legacy['settings.json']));
      if (legacy['mcp.json'] !== undefined && !getConfig.get('mcp')) setConfig.run('mcp', JSON.stringify(legacy['mcp.json']));
      for (const [id, value] of Object.entries(legacy['auth.json'] ?? {})) {
        if (!getCredentialStatement.get(id)) setCredential.run(id, JSON.stringify(value));
      }
      for (const persona of legacy['personas.json'] ?? []) {
        if (!database.prepare('SELECT 1 FROM personas WHERE id = ?').get(persona.id)) setPersona.run(persona.id, JSON.stringify(persona));
      }
      if (Array.isArray(legacy['personas.json'])) database.prepare("INSERT INTO config_meta (key, value) VALUES ('personas_initialized', '1')").run();
      database.prepare("INSERT INTO config_meta (key, value) VALUES ('legacy_json_migrated', '1')").run();
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

    await Promise.all(legacyFiles.map(name => unlink(join(dataDir, name)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    })));
  }

  function getSetting(fallback) {
    const row = getConfig.get('settings');
    return row ? JSON.parse(row.data) : fallback;
  }
  function saveSetting(value) { setConfig.run('settings', JSON.stringify(value)); }
  function getMcpConfig(fallback) {
    const row = getConfig.get('mcp');
    return row ? JSON.parse(row.data) : fallback;
  }
  function saveMcpConfig(value) { setConfig.run('mcp', JSON.stringify(value)); }
  function getCredential(id) {
    const row = getCredentialStatement.get(id);
    return row ? JSON.parse(row.data) : undefined;
  }
  function listCredentialsData() {
    return listCredentials.all().map(row => [row.id, JSON.parse(row.data)]);
  }
  function saveCredential(id, value) { setCredential.run(id, JSON.stringify(value)); }
  function removeCredential(id) { deleteCredential.run(id); }
  function listPersonas() { return listPersonaRows.all().map(row => JSON.parse(row.data)); }
  function hasPersonas() { return Boolean(database.prepare("SELECT 1 FROM config_meta WHERE key = 'personas_initialized'").get()); }
  function savePersonas(values) {
    database.exec('BEGIN IMMEDIATE');
    try {
      deletePersonas.run();
      for (const persona of values) setPersona.run(persona.id, JSON.stringify(persona));
      database.prepare("INSERT INTO config_meta (key, value) VALUES ('personas_initialized', '1') ON CONFLICT(key) DO NOTHING").run();
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  function listSkills() { return listSkillRows.all().map(row => JSON.parse(row.data)); }
  function saveSkills(values, removeIds = []) {
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const id of removeIds) deleteSkillStatement.run(id);
      for (const skill of values) saveSkillStatement.run(skill.id, JSON.stringify(skill));
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  function saveSkill(skill) { saveSkills([skill]); }
  function removeSkill(id) { deleteSkillStatement.run(id); }
  function listDeviceSkillPreferences() { return listDeviceSkillPreferencesStatement.all().map(row => [row.id, Boolean(row.enabled)]); }
  function saveDeviceSkillPreference(id, enabled) { saveDeviceSkillPreferenceStatement.run(id, enabled ? 1 : 0); }

  return {
    migrateLegacyFiles,
    getSetting,
    saveSetting,
    getMcpConfig,
    saveMcpConfig,
    getCredential,
    listCredentials: listCredentialsData,
    saveCredential,
    removeCredential,
    listPersonas,
    hasPersonas,
    savePersonas,
    listSkills,
    saveSkill,
    saveSkills,
    removeSkill,
    listDeviceSkillPreferences,
    saveDeviceSkillPreference,
    close: () => database.close(),
  };
}
