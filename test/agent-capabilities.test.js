import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentTools } from '../src/server/agent-capabilities.js';
import { BASIC_TOOL_NAMES, REPOSITORY_TOOL_NAMES } from '../src/server/tools.js';

const delegation = ['subagent_create', 'subagent_send_prompt', 'subagent_list'];

test('unrestricted agents receive all tools only when runtime prerequisites exist', () => {
  assert.deepEqual(resolveAgentTools({}, { hasRepositories: true }), BASIC_TOOL_NAMES);
  const noRepositories = resolveAgentTools({});
  for (const name of REPOSITORY_TOOL_NAMES) assert.ok(!noRepositories.includes(name));
  assert.ok(noRepositories.includes('context_search'));
});

test('child and disabled delegation capabilities are not advertised or executable', () => {
  for (const config of [{ isChild: true }, { subagentsEnabled: false }]) {
    const tools = resolveAgentTools({}, config);
    for (const name of delegation) assert.ok(!tools.includes(name));
  }
  assert.ok(!resolveAgentTools({}, { isChild: true }).includes('agent_whisper'));
});

test('whisper is withheld without targets or during whispered execution', () => {
  for (const config of [{ hasWhisperTargets: false }, { allowWhisper: false }]) {
    assert.ok(!resolveAgentTools({}, config).includes('agent_whisper'));
  }
});

test('runtime capability resolution never expands explicit profile permissions', () => {
  const profile = { allowedTools: ['read', 'context_search'] };
  assert.deepEqual(resolveAgentTools(profile, { hasRepositories: true }), profile.allowedTools);
  assert.deepEqual(resolveAgentTools(profile), ['context_search']);
  assert.deepEqual(resolveAgentTools({ allowedTools: [] }, { hasRepositories: true }), []);
  assert.deepEqual(profile.allowedTools, ['read', 'context_search']);
});
