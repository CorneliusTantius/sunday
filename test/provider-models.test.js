import test from 'node:test';
import assert from 'node:assert/strict';
import { providers, credentialId, createModelsByMode } from '../src/server/provider-models.js';

test('provider modes keep API keys and OAuth credentials isolated', async () => {
  assert.deepEqual(providers.map(({ id, modes }) => [id, modes]), [['openai', ['api_key', 'oauth']], ['anthropic', ['api_key']], ['google', ['api_key']]]);
  assert.equal(credentialId('openai', 'oauth'), 'openai-chatgpt');
  assert.equal(credentialId('openai', 'api_key'), 'openai');
  const data = { openai: { type: 'api_key', key: 'key' }, 'openai-chatgpt': { type: 'oauth', access: 'token' } };
  const credentials = {
    async read(id) { return data[id]; },
    async modify(id, fn) { const value = await fn(data[id]); if (value) data[id] = value; return data[id]; },
    async delete(id) { delete data[id]; },
  };
  const models = createModelsByMode(credentials);
  assert.ok(await models.api_key.checkAuth('openai'));
  assert.ok(await models.oauth.checkAuth('openai'));
  await models.oauth.logout('openai');
  assert.equal(data.openai.key, 'key');
  assert.equal(data['openai-chatgpt'], undefined);
  await models.api_key.logout('openai');
  assert.equal(data.openai, undefined);
});
