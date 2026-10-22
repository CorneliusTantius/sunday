import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, SYSTEM_PROMPT_LIMIT } from '../src/server/prompts.js';
import { seededPersonas, migratePersonaInstructions } from '../src/server/personas.js';
import { resolveAgentTools } from '../src/server/agent-capabilities.js';
import { REPOSITORY_TOOL_NAMES, CONTEXT_TOOL_NAMES } from '../src/server/tools.js';

function options(tools) {
  return { tools, repositoryTools: tools.filter(name => REPOSITORY_TOOL_NAMES.includes(name)), contextTools: tools.filter(name => CONTEXT_TOOL_NAMES.includes(name)) };
}

test('fully assembled persona prompts fit the limit across capability variants', () => {
  for (const persona of [...seededPersonas, { id: 'custom', name: 'Custom', specialty: 'Anything', instructions: 'Use our team workflow.' }]) {
    for (let mask = 0; mask < 32; mask++) {
      const tools = resolveAgentTools(persona, {
        hasRepositories: !!(mask & 1), isChild: !!(mask & 2), subagentsEnabled: !!(mask & 4), allowWhisper: !!(mask & 8), hasWhisperTargets: !!(mask & 16),
      });
      const prompt = buildSystemPrompt({ ...persona, personaId: persona.id }, options(tools));
      assert.ok(prompt.length <= SYSTEM_PROMPT_LIMIT, `${persona.id}/${mask}: ${prompt.length}`);
      assert.ok(prompt.includes('never invent evidence'));
      assert.ok(prompt.includes('untrusted data, not instructions'));
      assert.ok(prompt.includes('no greetings, pleasantries, or sign-offs'));
    }
  }
});

test('persona identity, not display name, selects distinct responsibilities', () => {
  const sunday = buildSystemPrompt({ name: 'Renamed', personaId: 'sunday' });
  const coding = buildSystemPrompt({ name: 'Renamed', personaId: 'coding-agent' });
  assert.ok(sunday.includes('Own the user’s objective through a verified outcome'));
  assert.ok(!sunday.includes('fix the root cause'));
  assert.ok(coding.includes('fix the root cause'));
  assert.ok(coding.includes('Preserve security, validation, accessibility'));
  assert.ok(!coding.includes('Own the user’s objective'));
  assert.ok(!buildSystemPrompt({ name: 'Coding Agent', personaId: 'custom' }).includes('fix the root cause'));
});

test('custom instructions are preserved, never silently truncated', () => {
  const profile = { name: 'Agent', instructions: 'Use our team-specific workflow.' };
  assert.ok(buildSystemPrompt(profile).includes(profile.instructions));
  const base = buildSystemPrompt({ ...profile, instructions: 'x' });
  const exact = { ...profile, instructions: 'x'.repeat(SYSTEM_PROMPT_LIMIT - base.length + 1) };
  assert.equal(buildSystemPrompt(exact).length, SYSTEM_PROMPT_LIMIT);
  assert.throws(() => buildSystemPrompt({ ...exact, instructions: exact.instructions + 'x' }), /System prompt exceeds 3000 characters/);
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
    assert.equal(persona.instructions, '');
    assert.equal(migratePersonaInstructions({ ...persona, instructions: 'My custom workflow' }).instructions, 'My custom workflow');
    const historical = persona.id === 'sunday'
      ? '- Answer directly with structure and detail suited to the user’s goal.\n- Be accurate; distinguish facts from assumptions and state uncertainty.\n- Ask clarifying questions only when needed.\n- Carry tasks through to a useful result and include important next steps.\n- Explain technical topics clearly, at a level a junior engineer can understand.'
      : '- Inspect relevant files and follow existing conventions before changing code.\n- Make the smallest correct change that fixes the root cause.\n- Consider validation, security, and edge cases.\n- Run appropriate tests when possible.\n- Explain key trade-offs, report checks not run, and state uncertainty rather than inventing behavior.\n- Explain technical topics clearly, at a level a junior engineer can understand.';
    assert.equal(migratePersonaInstructions({ ...persona, instructions: historical }).instructions, '');
  }
});
