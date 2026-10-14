import test from 'node:test';
import assert from 'node:assert/strict';
import { composerToken, fileReferences } from '../src/web/composer.js';

test('suggestions detect slash commands only at the start and file mentions at the caret', () => {
  assert.deepEqual(composerToken('/ne', 3), { type: 'command', query: 'ne', start: 0, end: 3 });
  assert.equal(composerToken('some /ne', 8), null);
  assert.equal(composerToken('/new ', 5), null);
  assert.deepEqual(composerToken('Read @repo/src more', 14), { type: 'file', query: 'repo/src', start: 5, end: 14 });
  assert.equal(composerToken('a@b.com', 7), null);
  assert.equal(composerToken('@"repo/file name.txt" ', 22), null);
});

test('file references support quoted paths, deduplicate, and ignore ordinary mentions', () => {
  assert.deepEqual(fileReferences('Read @repo/a.js and @"repo/file name.txt" then @repo/a.js @person user@example.com'), ['repo/a.js', 'repo/file name.txt']);
  assert.deepEqual(fileReferences('@"repo/quote\\\"file.txt"'), ['repo/quote"file.txt']);
  assert.throws(() => fileReferences('@"repo/invalid\\q"'));
});
