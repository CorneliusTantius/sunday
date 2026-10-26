import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('skill API manages Sunday skills and separately discovers read-only skills installed on device', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sunday-skills-api-'));
  const port = 33000 + Math.floor(Math.random() * 20000);
  const deviceSkillDir = join(home, 'sunday', '.agents', 'skills', 'device-review');
  await mkdir(deviceSkillDir, { recursive: true });
  await writeFile(join(deviceSkillDir, 'SKILL.md'), '---\nname: Device review\ndescription: Installed skill fixture.\n---\n\nReview changes carefully.');
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('../src/server/index.js', import.meta.url)), '--production'], {
      cwd: home,
      env: { ...process.env, HOME: home, PORT: String(port), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 15000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const call = async (path, method = 'GET', input) => {
      const response = await fetch(`${base}${path}`, {
        method,
        ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
      });
      return { response, data: response.status === 204 ? null : await response.json() };
    };

    const initial = await call('/api/skills');
    assert.equal(initial.response.status, 200);
    assert.deepEqual(initial.data.skills, []);

    const deviceList = await call('/api/skills/device');
    assert.equal(deviceList.response.status, 200);
    assert.equal(deviceList.data.skills.length, 1);
    const deviceSkill = deviceList.data.skills[0];
    assert.equal(deviceSkill.name, 'Device review');
    assert.equal(deviceSkill.enabled, false);
    assert.equal(deviceSkill.source.type, 'device');

    const created = await call('/api/skills', 'POST', {
      name: 'API Review', description: 'Review API changes.', content: 'Check inputs and error cases.',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.skill.id, 'api-review');
    assert.equal(created.data.skill.source.type, 'sunday');
    assert.equal(created.data.skill.enabled, false);

    const duplicate = await call('/api/skills', 'POST', {
      name: 'API Review', description: 'Duplicate.', content: 'Duplicate instructions.',
    });
    assert.equal(duplicate.response.status, 400);

    const enabled = await call('/api/skills/api-review', 'PUT', { enabled: true });
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.data.skill.enabled, true);

    const renamed = await call('/api/skills/api-review', 'PUT', {
      name: 'API Review Updated', description: 'Review API changes safely.', content: 'Check all input boundaries.',
    });
    assert.equal(renamed.response.status, 200);
    assert.equal(renamed.data.skill.id, 'api-review-updated');
    assert.equal((await call('/api/skills/api-review')).response.status, 404);

    const enabledDevice = await call(`/api/skills/device/${deviceSkill.id}`, 'PUT', { enabled: true });
    assert.equal(enabledDevice.response.status, 200);
    assert.equal(enabledDevice.data.skill.enabled, true);
    assert.equal((await call('/api/skills/device')).data.skills[0].enabled, true);

    const invalidPackage = await call('/api/skills/npm', 'POST', { package: 'file:./malicious' });
    assert.equal(invalidPackage.response.status, 400);

    const deleted = await call('/api/skills/api-review-updated', 'DELETE');
    assert.equal(deleted.response.status, 200);
    assert.deepEqual((await call('/api/skills')).data.skills, []);
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(home, { recursive: true, force: true });
  }
});
