import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitStatus, repositoryStatus } from '../src/server/repo-status.js';
test('counts clean and mixed worktrees including renamed paths', () => {
  assert.deepEqual(parseGitStatus(''), { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
  assert.deepEqual(parseGitStatus('M  staged\0 M unstaged\0MM both\0?? new\0UU conflict\0R  renamed\0old\0'), { staged: 3, unstaged: 2, untracked: 1, conflicted: 1 });
});
test('unavailable directories do not claim a clean worktree', async () => {
  assert.equal(await repositoryStatus('/nonexistent/sunday-test-repository'), null);
});
