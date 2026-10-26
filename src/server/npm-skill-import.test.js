import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadNpmSkills, validateNpmPackageSpec, parseSkillMarkdown } from './npm-skill-import.js';

const skillFiles = {
  'package/SKILL.md': `---\nname: Package review\ndescription: >-\n  Review changes\n  for correctness.\n---\n\nCheck edge cases.`,
  'package/skills/docs/SKILL.md': 'Document the public API.',
};

test('npm package specs accept package names and versions but reject local paths and command flags', () => {
  assert.equal(validateNpmPackageSpec('@acme/review-skill@1.2.3'), '@acme/review-skill@1.2.3');
  assert.equal(validateNpmPackageSpec('review-skill'), 'review-skill');
  assert.throws(() => validateNpmPackageSpec('--ignore-scripts'), /package name/);
  assert.throws(() => validateNpmPackageSpec('file:./skill'), /package name/);
  assert.throws(() => validateNpmPackageSpec('https://example.com/skill.tgz'), /package name/);
});

test('npm package import reads only SKILL.md files and never runs package scripts', async () => {
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'npm') {
      const destination = args.find(arg => arg.startsWith('--pack-destination=')).slice('--pack-destination='.length);
      await writeFile(join(destination, 'review-skill-1.0.0.tgz'), 'fake archive');
      return { stdout: JSON.stringify([{ filename: 'review-skill-1.0.0.tgz', name: '@acme/review-skill', description: 'Package fallback description.' }]) };
    }
    if (args[0] === '-tzf') return { stdout: [
      ...Object.keys(skillFiles), 'package/../outside/SKILL.md', '/tmp/evil/SKILL.md', 'package/scripts/install.js',
    ].join('\n') };
    const path = args.at(-1);
    return { stdout: skillFiles[path] };
  };
  const skills = await downloadNpmSkills('@acme/review-skill@1.0.0', { execute });
  assert.equal(skills.length, 2);
  assert.deepEqual(skills[0], {
    name: 'Package review', description: 'Review changes for correctness.', content: 'Check edge cases.',
    package: '@acme/review-skill@1.0.0', path: 'SKILL.md',
  });
  assert.equal(skills[1].name, 'docs');
  assert.equal(skills[1].description, 'Package fallback description.');
  assert.equal(skills[1].content, 'Document the public API.');
  assert.ok(calls.find(call => call.command === 'npm').args.includes('--ignore-scripts'));
  assert.equal(calls.filter(call => call.command === 'npm').length, 1);
});

test('skill markdown frontmatter is optional and only extracts the documented metadata', () => {
  assert.deepEqual(parseSkillMarkdown('Do this.', 'fallback', 'General instructions'), {
    name: 'fallback', description: 'General instructions', content: 'Do this.',
  });
});
