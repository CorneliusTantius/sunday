import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');

test('Context and Skills remain separate top-level destinations', () => {
  const app = read('App.jsx');
  assert.match(app, /id="skills-link" href="#context\/skills" aria-current=\{page === 'skills' \? 'page' : undefined\}/);
  assert.match(app, /id="context-link" href="#context"/);
  assert.match(app, /id="scheduled-job-link"/);
});

test('Context graph nodes remain keyboard-operable buttons', () => {
  const memory = read('components/Memory.jsx');
  assert.match(memory, /data-graph-node=\{sourceKey\}[^>]*role="button" tabIndex="0"/);
  assert.match(memory, /onKeyDown={event => \{ if \(event\.key === 'Enter' \|\| event\.key === ' '\)/);
});

test('skill builder and npm import forms remain in a native modal dialog', () => {
  const skills = read('components/Skills.jsx');
  assert.match(skills, /<dialog ref=\{dialog\}/);
  assert.match(skills, /onSubmit=\{installNpmSkill\}/);
  assert.match(skills, /onSubmit=\{saveSkill\}/);
  assert.match(skills, /element\.showModal\(\)/);
});
