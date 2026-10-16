import test from 'node:test';
import assert from 'node:assert/strict';
import { BASIC_TOOLS, BASIC_TOOL_NAMES, validateTools } from '../src/server/tools.js';
test('subagent tools use a common prefix, migrate saved permissions, and document synchronous prompting', () => {
  for (const name of ['subagent_create', 'subagent_send_prompt', 'subagent_list']) assert.ok(BASIC_TOOL_NAMES.includes(name));
  assert.deepEqual(validateTools(['create_subagent', 'send_subagent_prompt', 'list_subagents']), ['subagent_create', 'subagent_send_prompt', 'subagent_list']);
  assert.deepEqual(validateTools([]), []);
});
