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

test('every agent prompt uses a compact coordination format without constraining user-facing replies', () => {
  const prompt = buildSystemPrompt({ name: 'Agent' });
  assert.ok(prompt.includes('Agent-to-agent and delegated-work only: terse fields; grammar and English optional, clarity mandatory.'));
  assert.ok(prompt.includes('`TASK|GOAL:...|MODE:edit/read-only|SCOPE:...|LIMIT:...|VERIFY:...|RETURN:...`'));
  assert.ok(prompt.includes('`RESULT|STATUS:done/partial/blocked|FILES:...|EVIDENCE:...|CHECKS:...|BLOCKERS:...`'));
  assert.ok(prompt.includes('Omit empty fields; no prose.'));
  assert.ok(prompt.includes('User-facing replies stay natural.'));
});

test('delegation prioritizes small concurrent assignments on every round', () => {
  const prompt = buildSystemPrompt({ name: 'Agent' });
  assert.ok(prompt.includes('prioritize concurrent assignments on every round, not just initial creation'));
  assert.ok(prompt.includes('one small, bounded task with a narrow file scope and one verification target'));
  assert.ok(prompt.includes('Reuse idle children for follow-up work'));
  assert.ok(prompt.includes('Calls wait for the whole batch'));
});

test('Coding Agent system prompt requires scoped root-cause changes and verified reporting', () => {
  const profile = { name: 'Renamed Coder', personaId: 'coding-agent', specialty: 'Software development', instructions: 'Preserve our team-specific workflow.' };
  const prompt = buildSystemPrompt(profile);
  assert.ok(prompt.includes('trace the root cause. Make the smallest complete change that follows existing patterns'));
  assert.ok(prompt.includes('Preserve correctness, security, validation, and accessibility'));
  assert.ok(prompt.includes('Preserve our team-specific workflow.'));
  assert.ok(prompt.includes('Report only verified results, including checks not run or blockers'));
  assert.ok(!buildSystemPrompt({ name: 'Coding Agent', instructions: 'Custom persona.' }).includes('Coding Agent instructions:'));
  assert.ok(!buildSystemPrompt({ name: 'Coding Agent', personaId: 'custom-coder', instructions: 'Custom persona.' }).includes('Coding Agent instructions:'));
});

test('Sunday system prompt owns outcomes and coordinates bounded parallel work', () => {
  const prompt = buildSystemPrompt({ name: 'Sunday', personaId: 'sunday', instructions: 'Use my customized voice.' });
  assert.ok(prompt.includes('Own the user’s objective from clarification through a verified outcome'));
  assert.ok(prompt.includes('distinguish facts from assumptions'));
  assert.ok(prompt.includes('Delegate substantial independent work as bounded concurrent tasks'));
  assert.ok(prompt.includes('synthesize their evidence, and verify the result against the user’s goal'));
  assert.ok(prompt.includes('Use my customized voice.'));
  assert.ok(!buildSystemPrompt({ name: 'Sunday', personaId: 'my-custom-persona', instructions: '' }).includes('Sunday chief instructions:'));
});

test('Sunday and Coding Agent system prompts explain technical topics in junior engineer language', () => {
  const explanation = 'Explain technical topics in clear, plain language a junior engineer can follow. Briefly define unfamiliar terms, explain why key steps matter, and avoid unexplained jargon.';
  for (const personaId of ['sunday', 'coding-agent']) {
    const prompt = buildSystemPrompt({ name: personaId, personaId, instructions: 'Custom instructions.' });
    assert.ok(prompt.includes(explanation), `${personaId} missing junior engineer explanation guidance`);
  }
  assert.ok(!buildSystemPrompt({ name: 'Other', personaId: 'custom' }).includes(explanation));
});

test('repository prompts prioritize independent read batches without requiring concurrency', () => {
  const instruction = 'Prioritize batching independent read-only tool calls (especially read, find, and searches) together for concurrent execution when supported, rather than issuing them one at a time.';
  const prompt = buildSystemPrompt({ name: 'Agent' }, { repositoryTools: ['read', 'find'] });
  assert.ok(prompt.includes(instruction));
  assert.ok(prompt.includes('Wait for results when later calls depend on them; keep state-changing calls sequential.'));
  assert.ok(!buildSystemPrompt({ name: 'Agent' }).includes(instruction));
});

test('agents actively search memory, follow useful graph links, and save durable discoveries', () => {
  const prompt = buildSystemPrompt({ name: 'Agent' }, {
    contextTools: ['context_search', 'context_index', 'context_links', 'context_link', 'context_unlink'],
  });
  assert.ok(prompt.includes('At the start of a task that may benefit from prior knowledge, search context'));
  assert.ok(prompt.includes('inspect context_links and follow useful connections by searching linked notes'));
  assert.ok(prompt.includes('save or update it with context_index'));
  assert.ok(prompt.includes('Do not save transient status, unverified speculation, secrets, or sensitive personal data.'));
  assert.ok(prompt.includes('Use context_links to inspect incoming and outgoing links for a relevant indexed note.'));
  assert.ok(prompt.includes('Use context_link to connect a newly indexed or updated note to relevant existing notes.'));
  assert.ok(prompt.includes('Use context_unlink to remove a directed link between indexed notes.'));
  assert.equal(prompt.match(/Use context_unlink to remove a directed link/g)?.length, 1);
  assert.ok(!buildSystemPrompt({ name: 'Agent' }, { contextTools: ['context_search'] }).includes('Use context_link'));
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
