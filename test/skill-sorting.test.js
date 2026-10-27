import test from 'node:test';
import assert from 'node:assert/strict';
import { sortSkillsAlphabetically } from '../src/web/skill-sorting.js';

test('skills sort alphabetically by name without mutating the source list', () => {
  const skills = [
    { id: '10', name: 'Skill 10' },
    { id: 'zebra', name: 'zebra' },
    { id: '2', name: 'Skill 2' },
    { id: 'alpha', name: 'Alpha' },
  ];
  const sorted = sortSkillsAlphabetically(skills);
  assert.deepEqual(sorted.map(skill => skill.name), ['Alpha', 'Skill 2', 'Skill 10', 'zebra']);
  assert.deepEqual(skills.map(skill => skill.name), ['Skill 10', 'zebra', 'Skill 2', 'Alpha']);
});
