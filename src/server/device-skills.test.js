import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverDeviceSkills } from './device-skills.js';

test('device skills are discovered as read-only records without following symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sunday-device-skills-'));
  const external = await mkdtemp(join(tmpdir(), 'sunday-outside-skills-'));
  try {
    const skillDir = join(root, 'review');
    await mkdir(skillDir);
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: Code review\ndescription: Review pull requests.\n---\n\nCheck tests and edge cases.');
    await writeFile(join(root, 'README.md'), 'not a skill');
    await writeFile(join(external, 'SKILL.md'), 'Do not load through a symlink.');
    await symlink(external, join(root, 'linked-skill'));

    const skills = await discoverDeviceSkills([{ path: root, label: 'test/skills' }]);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'Code review');
    assert.equal(skills[0].content, 'Check tests and edge cases.');
    assert.equal(skills[0].source.type, 'device');
    assert.equal(skills[0].source.location, 'test/skills/review');
    assert.equal(skills[0].enabled, false);
    assert.match(skills[0].id, /^device-[a-f0-9]{16}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
