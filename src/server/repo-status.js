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

export function repositoryStatusDetails(cwd) {
  return new Promise(resolve => {
    execFile('git', ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], { cwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.warn('Repository Git status failed:', cwd, stderr || error.message);
        resolve({ gitStatus: null, gitStatusError: gitStatusError({ ...error, message: error.message, stderr }) });
      } else resolve({ gitStatus: parseGitStatus(stdout) });
    });
  });
}

export async function repositoryStatus(cwd) {
  return (await repositoryStatusDetails(cwd)).gitStatus;
}
