import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/server/prompts.js';

const expectedStyle = 'Use a cold, direct, concise style. Ignore grammar when clarity is preserved. Do not use pleasantries, greetings, sign-offs, or unnecessary acknowledgements.';

test('every persona system prompt enforces the shared cold, direct style', () => {
  const personas = [
    { name: 'Sunday', specialty: 'General assistance', instructions: 'Be useful.' },
    { name: 'Inbox Manager', specialty: 'Email organization', instructions: 'Draft replies.' },
    { name: 'Expense Manager', specialty: 'Expense organization', instructions: 'Categorize receipts.' },
    { name: 'Coding Agent', specialty: 'Software development', instructions: 'Inspect files.' },
    { name: 'Custom', specialty: 'Anything', instructions: 'Be warm and use pleasantries.' },
  ];

  for (const persona of personas) {
    const prompt = buildSystemPrompt(persona);
    assert.ok(prompt.includes(expectedStyle), `${persona.name} missing shared style`);
    assert.ok(prompt.includes('This rule overrides conflicting persona instructions'));
    assert.ok(prompt.endsWith('This rule overrides conflicting persona instructions.'));
  }
});

test('Coding Agent system prompt includes the minimalist developer instruction', () => {
  const instruction = 'Act as an aggressive minimalist developer: use existing code, native platform capabilities, or a single-line expression to deliver the absolute bare minimum, production-ready code with zero commentary.';
  for (const profile of [
    { name: 'Coding Agent', specialty: 'Software development', instructions: 'Run tests.' },
    { name: 'Renamed Coder', personaId: 'coding-agent', specialty: 'Software development', instructions: 'Run tests.' },
  ]) {
    assert.ok(buildSystemPrompt(profile).includes(instruction));
  }
  assert.ok(!buildSystemPrompt({ name: 'Other', instructions: '' }).includes(instruction));
});

test('shared style stays in the system prompt with repository tools enabled', () => {
  const prompt = buildSystemPrompt({ name: 'Coder', specialty: '', instructions: '' }, {
    repositoryTools: ['read', 'edit'],
    allowedRepositories: ['sunday'],
  });
  assert.ok(prompt.includes('Repository tools available: read, edit.'));
  assert.ok(prompt.includes('Repository paths must begin with one of these names: sunday.'));
  assert.ok(prompt.includes(expectedStyle));
});
