import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitStatus, repositoryStatus, gitStatusError } from '../src/server/repo-status.js';
test('counts clean and mixed worktrees including renamed paths', () => {
  assert.deepEqual(parseGitStatus(''), { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
  assert.deepEqual(parseGitStatus('M  staged\0 M unstaged\0MM both\0?? new\0UU conflict\0R  renamed\0old\0'), { staged: 3, unstaged: 2, untracked: 1, conflicted: 1 });
});
test('unavailable directories do not claim a clean worktree', async () => {
  assert.equal(await repositoryStatus('/nonexistent/sunday-test-repository'), null);
});

test('status failures provide safe actionable explanations', () => {
  assert.match(gitStatusError({ stderr: 'fatal: detected dubious ownership' }), /ownership/);
  assert.match(gitStatusError({ stderr: 'fatal: not a git repository' }), /not a Git repository/);
  assert.match(gitStatusError({ code: 'ENOENT' }), /could not be found/);
  assert.match(gitStatusError({ killed: true }), /timed out/);
  assert.match(gitStatusError({ stderr: 'Permission denied' }), /Permission denied/);
  assert.equal(gitStatusError({ stderr: '/private/path/internal failure' }), 'Git status failed. Check server logs for details.');
});
