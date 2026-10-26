import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkill, createImportedSkill, updateSkill, SkillError } from './skill-library.js';

const draft = { name: 'Code review', description: 'Review changes for correctness.', content: 'Check edge cases and tests.' };

test('Sunday skills are validated, normalized, isolated from npm skills, and disabled by default', () => {
  const skill = createSkill(draft, [], 100);
  assert.deepEqual(skill, {
    id: 'code-review', name: draft.name, description: draft.description, content: draft.content,
    source: { type: 'sunday' }, enabled: false, createdAt: 100, updatedAt: 100,
  });
  assert.throws(() => createSkill(draft, [skill]), SkillError);
  assert.throws(() => createSkill({ ...draft, content: '' }), /instructions/);
  assert.throws(() => createSkill({ ...draft, name: 'x'.repeat(81) }), /name/);
  assert.throws(() => createSkill({ ...draft, description: 'x'.repeat(501) }), /description/);

  const imported = createImportedSkill({ ...draft, package: '@acme/review-skill@1.0.0', path: 'skills/review/SKILL.md' }, [skill], 200);
  assert.match(imported.id, /^npm-code-review-[a-f0-9]{10}$/);
  assert.deepEqual(imported.source, { type: 'npm', package: '@acme/review-skill@1.0.0', path: 'skills/review/SKILL.md' });
  assert.equal(imported.enabled, false);
  assert.equal(imported.id === skill.id, false);
});

test('skills can be reviewed, renamed and enabled with stable source metadata', () => {
  const current = createSkill(draft, [], 10);
  const updated = updateSkill(current, { name: 'Code review v2', content: 'Review all boundary conditions.', enabled: true }, [current], 20);
  assert.equal(updated.id, 'code-review-v2');
  assert.equal(updated.enabled, true);
  assert.equal(updated.description, draft.description);
  assert.deepEqual(updated.source, { type: 'sunday' });
  assert.equal(updated.updatedAt, 20);

  const imported = createImportedSkill({ ...draft, package: 'review-skill', path: 'SKILL.md' }, [], 10);
  const npmUpdate = updateSkill(imported, { description: 'Reviewed package skill.', enabled: true }, [imported], 30);
  assert.equal(npmUpdate.id, imported.id);
  assert.deepEqual(npmUpdate.source, imported.source);
  assert.equal(npmUpdate.enabled, true);
  assert.throws(() => updateSkill(imported, { enabled: 'yes' }, [imported]), /true or false/);
});

test('enabling skills enforces a shared prompt-size limit', () => {
  const first = createSkill({ ...draft, content: 'a'.repeat(50_000) });
  const second = createSkill({ ...draft, name: 'Another skill', content: 'b'.repeat(50_000) }, [first]);
  const third = createSkill({ ...draft, name: 'One more', content: 'c'.repeat(1) }, [first, second]);
  const enabledFirst = updateSkill(first, { enabled: true }, [first, second, third]);
  const enabledSecond = updateSkill(second, { enabled: true }, [enabledFirst, second, third]);
  assert.equal(enabledSecond.enabled, true);
  assert.throws(() => updateSkill(third, { enabled: true }, [enabledFirst, enabledSecond, third]), /100,000 characters/);
});
