import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupportedThinkingLevels, clampThinkingLevel } from '../src/server/thinking.js';

test('Off remains available when the SDK excludes it for a reasoning model', () => {
  const model = { reasoning: true, thinkingLevelMap: { off: null } };
  assert.equal(getSupportedThinkingLevels(model)[0], 'off');
  assert.equal(clampThinkingLevel(model, 'off'), 'off');
  assert.ok(getSupportedThinkingLevels(model).includes('high'));
  assert.equal(clampThinkingLevel(model, 'high'), 'high');
});

test('non-reasoning models have only one Off option', () => {
  const model = { reasoning: false };
  assert.deepEqual(getSupportedThinkingLevels(model), ['off']);
  assert.equal(clampThinkingLevel(model, 'high'), 'off');
});
