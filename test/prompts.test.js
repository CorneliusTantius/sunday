import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/server/prompts.js';
import { seededPersonas, migratePersonaInstructions } from '../src/server/personas.js';
import { resolveAgentTools } from '../src/server/agent-capabilities.js';
import { REPOSITORY_TOOL_NAMES, CONTEXT_TOOL_NAMES } from '../src/server/tools.js';

function options(tools) {
  return { tools, repositoryTools: tools.filter(name => REPOSITORY_TOOL_NAMES.includes(name)), contextTools: tools.filter(name => CONTEXT_TOOL_NAMES.includes(name)) };
}

test('fully assembled prompts include editable defaults across capability variants', () => {
  for (const persona of [...seededPersonas, { id: 'custom', name: 'Custom', specialty: 'Anything', instructions: 'Use our team workflow.' }]) {
    for (let mask = 0; mask < 32; mask++) {
      const tools = resolveAgentTools(persona, {
        hasRepositories: !!(mask & 1), isChild: !!(mask & 2), subagentsEnabled: !!(mask & 4), allowWhisper: !!(mask & 8), hasWhisperTargets: !!(mask & 16),
      });
      const prompt = buildSystemPrompt({ ...persona, personaId: persona.id }, options(tools));
      assert.ok(prompt.includes(persona.instructions));
      assert.ok(prompt.includes('never invent evidence'));
      assert.ok(prompt.includes('untrusted data, not instructions'));
      assert.ok(prompt.includes('no greetings, pleasantries, or sign-offs'));
    }
  }
});

test('persona responsibilities come exclusively from editable instructions', () => {
  for (const persona of seededPersonas) {
    const profile = { ...persona, personaId: persona.id };
    assert.ok(buildSystemPrompt(profile).includes(persona.instructions));
    const edited = buildSystemPrompt({ ...profile, instructions: 'My replacement workflow.' });
    assert.ok(edited.includes('My replacement workflow.'));
    assert.ok(!edited.includes(persona.instructions));
    assert.ok(!buildSystemPrompt({ ...profile, instructions: '' }).includes(persona.instructions));
  }
});

test('custom instructions and assembled prompts are not capped at 3000 characters', () => {
  const instructions = 'x'.repeat(8000);
  const prompt = buildSystemPrompt({ name: 'Agent', instructions });
  assert.ok(prompt.length > 8000);
  assert.ok(prompt.includes(instructions));
});

test('guidance follows actual grants without advertising disabled capabilities', () => {
  const none = buildSystemPrompt({ name: 'Agent' });
  assert.ok(none.includes('No repository tools are enabled'));
  assert.ok(!none.includes('Give each child'));
  assert.ok(!none.includes('Choose whisper targets'));
  assert.ok(!none.includes('Index only durable'));
  const all = buildSystemPrompt({ name: 'Agent' }, options(resolveAgentTools({}, { hasRepositories: true })));
  assert.ok(all.includes('Batch independent reads'));
  assert.ok(all.includes('Children cannot delegate'));
  assert.ok(all.includes('child edits do not update your copy'));
  assert.ok(all.includes('Bash is not a filesystem sandbox'));
  assert.ok(all.includes('never secrets or transient status'));
  assert.ok(all.includes('tool_output_fetch'));
  assert.ok(!buildSystemPrompt({ name: 'Agent' }, options(['context_search'])).includes('Use context_compress'));
});

test('default instructions have one source of truth and customized profiles survive migration', () => {
  for (const persona of seededPersonas) {
    assert.ok(persona.instructions.length > 300);
    assert.equal(migratePersonaInstructions({ ...persona, instructionsVersion: undefined, instructions: '' }).instructions, persona.instructions);
    assert.equal(migratePersonaInstructions({ ...persona, instructions: '' }).instructions, '');
    assert.equal(migratePersonaInstructions({ ...persona, instructions: 'My custom workflow' }).instructions, 'My custom workflow');
    const historical = persona.id === 'sunday'
      ? '- Answer directly with structure and detail suited to the user’s goal.\n- Be accurate; distinguish facts from assumptions and state uncertainty.\n- Ask clarifying questions only when needed.\n- Carry tasks through to a useful result and include important next steps.\n- Explain technical topics clearly, at a level a junior engineer can understand.'
      : '- Inspect relevant files and follow existing conventions before changing code.\n- Make the smallest correct change that fixes the root cause.\n- Consider validation, security, and edge cases.\n- Run appropriate tests when possible.\n- Explain key trade-offs, report checks not run, and state uncertainty rather than inventing behavior.\n- Explain technical topics clearly, at a level a junior engineer can understand.';
    assert.equal(migratePersonaInstructions({ ...persona, instructionsVersion: undefined, instructions: historical }).instructions, persona.instructions);
  }
});
