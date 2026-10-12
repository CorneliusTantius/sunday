import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GREEK_DEITY_NAMES, uniqueSessionName } from '../src/server/session-names.js';

test('Greek names are unique and allocation uses the remaining unused deity', () => {
  assert.ok(GREEK_DEITY_NAMES.length >= 100);
  assert.equal(new Set(GREEK_DEITY_NAMES).size, GREEK_DEITY_NAMES.length);
  const remaining = GREEK_DEITY_NAMES.at(-1);
  assert.equal(uniqueSessionName(GREEK_DEITY_NAMES.slice(0, -1)), remaining);
});

test('exhaustion skips occupied suffixes and continues without duplicates', () => {
  const titles = [...GREEK_DEITY_NAMES, ...GREEK_DEITY_NAMES.map(name => `${name} 2`)];
  for (let i = 0; i < 300; i++) {
    const name = uniqueSessionName(titles);
    assert.ok(!titles.includes(name));
    assert.match(name, / \d+$/);
    titles.push(name);
  }
});
