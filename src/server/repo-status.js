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

export function repositoryStatus(cwd) {
  return new Promise(resolve => {
    execFile('git', ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], { cwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : parseGitStatus(stdout));
    });
  });
}
