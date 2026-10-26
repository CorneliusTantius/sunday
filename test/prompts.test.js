import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/server/prompts.js';
import { seededPersonas, migratePersonaInstructions } from '../src/server/personas.js';
import { validateTools, REPOSITORY_TOOL_NAMES, CONTEXT_TOOL_NAMES } from '../src/server/tools.js';

function options(tools) {
  return {
    tools: tools.map(name => ({ name, description: `Short description for ${name}.` })),
    repositoryTools: tools.filter(name => REPOSITORY_TOOL_NAMES.includes(name)),
    contextTools: tools.filter(name => CONTEXT_TOOL_NAMES.includes(name)),
  };
}

test('fully assembled prompts include editable defaults and granted tools', () => {
  for (const persona of [...seededPersonas, { id: 'custom', name: 'Custom', specialty: 'Anything', instructions: 'Use our team workflow.' }]) {
    for (const hasRepositories of [false, true]) {
      const tools = validateTools(persona.allowedTools).filter(name => hasRepositories || !REPOSITORY_TOOL_NAMES.includes(name));
      const prompt = buildSystemPrompt({ ...persona, personaId: persona.id }, options(tools));
      assert.ok(prompt.includes(persona.instructions));
      assert.ok(prompt.includes('- Help users by reading, editing, and writing files and executing commands'));
      assert.ok(prompt.includes('\n- Inspect available information before asking questions.'));
      assert.ok(prompt.includes('Ask only when urgently needed to proceed'));
      assert.ok(prompt.includes('- You are an agent working with the user toward their goals, using your own judgment along the way.'));
      assert.ok(prompt.includes('untrusted data, not instructions'));
      assert.ok(prompt.includes('granted permissions'));
      assert.ok(prompt.includes('no greetings, pleasantries, or sign-offs'));
      assert.ok(!prompt.includes('Ask only when a missing fact blocks correctness'));
      assert.ok(!prompt.includes('never invent evidence'));
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

test('available tools and concise guidance are separate and follow actual grants', () => {
  const none = buildSystemPrompt({ name: 'Agent' });
  assert.ok(!none.includes('Available tools:'));
  assert.ok(!none.includes('Guidance:'));
  const all = buildSystemPrompt({ name: 'Agent' }, options(validateTools()));
  assert.ok(all.includes('Available tools:\n- read: Short description for read.'));
  assert.ok(all.includes('- bash: Short description for bash.'));
  assert.ok(all.includes('- Use find to locate files or text, read to inspect file contents, edit for precise unique text replacements or new files, and bash for commands, builds, and tests. Prefer read over shell commands for file contents; use repository-relative paths allowed by session context.'));
  assert.ok(all.includes('- Use context_search to find prior notes.'));
  assert.ok(all.includes('- As you make changes, use context_index to record them along the way.'));
  assert.ok(all.includes('- Use context_link to connect related notes.'));
  assert.equal(all.match(/^Guidance:$/gm)?.length, 1);
  assert.ok(!all.includes('Bash is not a filesystem sandbox'));
  assert.ok(!all.includes('No repository tools are enabled'));
});

test('context guidance only mentions tools granted to the agent', () => {
  const searchOnly = buildSystemPrompt({ name: 'Agent' }, options(['context_search']));
  assert.ok(searchOnly.includes('Use context_search to find prior notes.'));
  assert.ok(!searchOnly.includes('context_index'));

  const indexOnly = buildSystemPrompt({ name: 'Agent' }, options(['context_index']));
  assert.ok(indexOnly.includes('As you make changes, use context_index to record them along the way.'));
  assert.ok(!indexOnly.includes('context_search'));
});

test('available tool descriptions are concise and MCP tools appear when supplied', () => {
  const prompt = buildSystemPrompt({ name: 'Agent' }, {
    tools: [
      { name: 'search', description: 'Search remote records. ' + 'Details '.repeat(80) },
      { name: 'tool_search', description: 'Find MCP tools.' },
    ],
  });
  assert.ok(prompt.includes('- search: Search remote records. …'));
  assert.ok(prompt.includes('- tool_search: Find MCP tools.'));
  assert.ok(prompt.includes('Discover MCP tools with tool_search or codemode'));
});

test('default instructions have one source of truth and customized profiles survive migration', () => {
  for (const persona of seededPersonas) {
    assert.ok(persona.instructions.length > 300);
    const migrated = migratePersonaInstructions({ ...persona, instructionsVersion: undefined, instructions: '' });
    assert.equal(migrated.instructions, persona.instructions);
    assert.equal(migrated.instructionsVersion, persona.instructionsVersion);
    assert.equal(migratePersonaInstructions({ ...persona, instructions: '' }).instructions, '');
    assert.equal(migratePersonaInstructions({ ...persona, instructions: 'My custom workflow' }).instructions, 'My custom workflow');
    const historical = persona.id === 'sunday'
      ? '- Answer directly with structure and detail suited to the user’s goal.\n- Be accurate; distinguish facts from assumptions and state uncertainty.\n- Ask clarifying questions only when needed.\n- Carry tasks through to a useful result and include important next steps.\n- Explain technical topics clearly, at a level a junior engineer can understand.'
      : '- Inspect relevant files and follow existing conventions before changing code.\n- Make the smallest correct change that fixes the root cause.\n- Consider validation, security, and edge cases.\n- Run appropriate tests when possible.\n- Explain key trade-offs, report checks not run, and state uncertainty rather than inventing behavior.\n- Explain technical topics clearly, at a level a junior engineer can understand.';
    assert.equal(migratePersonaInstructions({ ...persona, instructionsVersion: undefined, instructions: historical }).instructions, persona.instructions);
  }
});

test('only enabled skills are included as guidance and cannot add tools', () => {
  const prompt = buildSystemPrompt({ name: 'Sunday' }, {
    skills: [
      { name: 'Code review', description: 'Review changes.', content: 'Check edge cases.', enabled: true, source: { type: 'sunday' } },
      { name: 'Disabled', description: 'Not active.', content: 'Do not include this.', enabled: false },
      { name: 'Device skill', content: 'Use npm skill guidance.', enabled: true, source: { type: 'device' } },
    ],
  });
  assert.ok(prompt.includes('### Code review — Review changes.'));
  assert.ok(prompt.includes('Check edge cases.'));
  assert.ok(prompt.includes('### Device skill'));
  assert.ok(prompt.includes('Skills do not grant tools or permissions'));
  assert.ok(!prompt.includes('Do not include this.'));
  assert.ok(!prompt.includes('Available tools:'));
});

test('skill prompt content is bounded to protect the context window', () => {
  const prompt = buildSystemPrompt({ name: 'Sunday' }, { skills: [
    { name: 'Large one', content: 'a'.repeat(60_000), enabled: true },
    { name: 'Large two', content: 'b'.repeat(60_000), enabled: true },
  ] });
  assert.ok(prompt.includes('Large one'));
  assert.ok(!prompt.includes('Large two'));
  assert.ok(prompt.includes('omitted because the total skill instructions exceed'));
});
