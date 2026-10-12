import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('production serves module-relative dist after changing to the workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday static-'));
  const app = join(directory, 'app with spaces');
  const port = 32000 + Math.floor(Math.random() * 20000);
  let child;
  try {
    await mkdir(join(app, 'src', 'server'), { recursive: true });
    await mkdir(join(app, 'dist', 'assets'), { recursive: true });
    await writeFile(join(app, 'package.json'), '{"type":"module"}');
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(app, 'node_modules'), 'dir');
    for (const name of ['index.js', 'tools.js', 'session-names.js']) {
      await copyFile(new URL(`../src/server/${name}`, import.meta.url), join(app, 'src', 'server', name));
    }
    const fixtures = [
      ['index.html', 'text/html', '<html>Sunday static fixture</html>'],
      ['assets/main.js', 'text/javascript', 'console.log("Sunday");'],
      ['assets/main.css', 'text/css', 'body { color: cyan; }'],
      ['assets/logo.svg', 'image/svg+xml', '<svg></svg>'],
    ];
    for (const [path, , content] of fixtures) await writeFile(join(app, 'dist', path), content);
    child = spawn(process.execPath, [join(app, 'src', 'server', 'index.js'), '--production'], {
      cwd: directory,
      env: { ...process.env, HOME: directory, PORT: String(port), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    const startup = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 10000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    });
    await startup;
    for (const [path, type, content] of fixtures) {
      const response = await fetch(`http://127.0.0.1:${port}/${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), type);
      assert.equal(await response.text(), content);
    }
    const root = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(root.status, 200);
    assert.equal(await root.text(), fixtures[0][2]);
    for (const path of ['/missing', '/src/server/index.js', '/assets/nested/main.js', '/assets/missing.js']) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 404);
    }
    const settings = await (await fetch(`http://127.0.0.1:${port}/api/settings`)).json();
    assert.equal(settings.workspaceDir, join(directory, 'sunday', 'workspace'));
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
