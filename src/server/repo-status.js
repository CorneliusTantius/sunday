import { execFile } from 'node:child_process';

export function parseGitStatus(output) {
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const code = record.slice(0, 2);
    if (code === '??') { counts.untracked++; continue; }
    if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code)) counts.conflicted++;
    else {
      if (code[0] !== ' ') counts.staged++;
      if (code[1] !== ' ') counts.unstaged++;
    }
    // Porcelain -z includes a second path for renames/copies.
    if (/[RC]/.test(code)) i++;
  }
  return counts;
}

export function gitStatusError(error) {
  const stderr = String(error.stderr ?? error.message ?? '');
  if (stderr.includes('dubious ownership')) return 'Git rejected repository ownership. Check its owner and Git safe.directory configuration.';
  if (stderr.includes('not a git repository')) return 'This folder is not a Git repository.';
  if (error.code === 'ENOENT') return 'Git or the repository directory could not be found.';
  if (error.killed) return 'Git status timed out. Try again after other Git operations finish.';
  if (error.code === 'EACCES' || /permission denied/i.test(stderr)) return 'Permission denied while reading this repository.';
  return 'Git status failed. Check server logs for details.';
}

function runGit(args, cwd, { timeout = 5000, maxBuffer = 1024 * 1024, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer, env }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

export async function repositoryBranchDetails(cwd) {
  try {
    const { stdout } = await runGit(['branch', '--show-current'], cwd);
    const branch = stdout.trim();
    return branch ? { branch } : { branch: null, branchError: 'Detached HEAD' };
  } catch (error) {
    console.warn('Repository Git branch lookup failed:', cwd, error.stderr || error.message);
    return { branch: null, branchError: 'Branch unavailable' };
  }
}

export async function repositoryStatusDetails(cwd) {
  const [status, branch] = await Promise.all([
    new Promise(resolve => {
      execFile('git', ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], { cwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          console.warn('Repository Git status failed:', cwd, stderr || error.message);
          resolve({ gitStatus: null, gitStatusError: gitStatusError({ ...error, message: error.message, stderr }) });
        } else resolve({ gitStatus: parseGitStatus(stdout) });
      });
    }),
    repositoryBranchDetails(cwd),
  ]);
  return { ...status, ...branch };
}

export async function pullRepository(cwd) {
  const status = await runGit(['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], cwd);
  if (Object.values(parseGitStatus(status.stdout)).some(Boolean)) throw new Error('Commit, stash, or discard local changes before pulling.');
  const { branch } = await repositoryBranchDetails(cwd);
  if (!branch) throw new Error('Cannot pull while HEAD is detached or the current branch is unavailable.');
  try {
    const result = await runGit(['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', 'pull', '--ff-only', '--no-recurse-submodules'], cwd, {
      timeout: 120000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https' },
    });
    return { output: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || 'Already up to date.' };
  } catch (error) {
    const stderr = String(error.stderr || '');
    console.warn('Repository Git pull failed:', cwd, stderr || error.message);
    if (/no tracking information/i.test(stderr)) throw new Error('This branch has no upstream branch to pull from.');
    if (/not possible to fast-forward|divergent branches/i.test(stderr)) throw new Error('Local and remote branches have diverged; pull manually to preserve local commits.');
    if (/authentication failed|could not read Username|terminal prompts disabled/i.test(stderr)) throw new Error('Remote authentication failed. Check the repository credentials.');
    if (/could not resolve host|failed to connect|network is unreachable/i.test(stderr)) throw new Error('Could not reach the repository remote. Check the network connection.');
    throw new Error('Git pull failed. Check the repository remote and server logs.');
  }
}

export async function repositoryStatus(cwd) {
  return (await repositoryStatusDetails(cwd)).gitStatus;
}
