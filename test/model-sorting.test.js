import test from 'node:test';
import assert from 'node:assert/strict';
import { sortModelsAlphabetically } from '../src/server/model-sorting.js';

test('sorts model names case-insensitively with natural numeric ordering without mutating input', () => {
  const models = [
    { id: 'ten', name: 'GPT-10' },
    { id: 'alpha', name: 'alpha' },
    { id: 'two', name: 'gPt-2' },
    { id: 'one', name: 'GPT-1' },
  ];
  const sorted = sortModelsAlphabetically(models);
  assert.deepEqual(sorted.map(model => model.id), ['alpha', 'one', 'two', 'ten']);
  assert.deepEqual(models.map(model => model.id), ['ten', 'alpha', 'two', 'one']);
});

test('uses provider, mode, and ID as stable alphabetical tie-breakers', () => {
  const sorted = sortModelsAlphabetically([
    { id: 'z', name: 'Same', providerName: 'OpenAI', mode: 'oauth' },
    { id: 'b', name: 'Same', providerName: 'Anthropic', mode: 'api_key' },
    { id: 'a', name: 'Same', providerName: 'Anthropic', mode: 'api_key' },
  ]);
  assert.deepEqual(sorted.map(model => model.id), ['a', 'b', 'z']);
});
