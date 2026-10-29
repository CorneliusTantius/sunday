import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { credentialEchoServer } from './fixtures/mcp-http.js';
import { connectMcp } from '../src/server/mcp.js';
import { BASIC_TOOL_NAMES, REPOSITORY_TOOL_NAMES, CONTEXT_TOOL_NAMES, validateTools, makeTools } from '../src/server/tools.js';

import { estimateContext, shouldCompact, measuredInput, compactionCut, isContextOverflow } from '../src/server/context.js';
import { buildSystemPrompt } from '../src/server/prompts.js';
import { retrieveMemory, memoryOverview, reviewMemory, memoryPrefix, MEMORY_REVIEW_PROMPT } from '../src/server/memory-lifecycle.js';
import { dispatchToolCalls } from '../src/server/tool-dispatch.js';
import { TOOL_OUTPUT_NAMES, TOOL_OUTPUT_TOOLS, TOOL_OUTPUT_INLINE_LIMIT } from '../src/server/tool-output-storage.js';
import { compactionMessageIndex } from '../src/server/compaction-position.js';

const source = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
function harness(streams, idle = 100, total = 1000, agents = [], contextWindow = 10000, { mcpTools = [], nativeOutput = 'ok', mcpOutput = 'MCP result', outputStorageError = null, contextOverrides = {} } = {}) {
  const events = [], prompts = [], options = [], delays = [], inputs = [], executions = [], contextSearches = [], outputs = [];
  let calls = 0;
  const outputStorage = {
    has: sessionId => outputs.some(output => output.sessionId === sessionId),
    store(sessionId, toolCallId, toolName, output) {
      if (outputStorageError) throw new Error(outputStorageError);
      const retained = { id: `10000000-0000-4000-8000-${String(outputs.length + 1).padStart(12, '0')}`, sessionId, toolCallId, toolName, output, characters: output.length, bytes: Buffer.byteLength(output) };
      outputs.push(retained);
      return retained;
    },
    search(sessionId, query, limit = 5) {
      return outputs.filter(output => output.sessionId === sessionId && output.output.includes(query)).slice(0, limit).map(output => ({ outputId: output.id, toolName: output.toolName, createdAt: 1, offset: output.output.indexOf(query), excerpt: output.output.slice(Math.max(0, output.output.indexOf(query) - 30), output.output.indexOf(query) + query.length + 30) }));
    },
    fetch(sessionId, outputId, offset = 0, limit = 8000) {
      const output = outputs.find(item => item.sessionId === sessionId && item.id === outputId);
      if (!output) throw new Error('Tool output not found for this session');
      return { outputId, toolName: output.toolName, createdAt: 1, totalCharacters: output.characters, offset, nextOffset: Math.min(offset + limit, output.characters), text: output.output.slice(offset, offset + limit) };
    },
  };
  const model = { id: 'test', api: 'test', provider: 'test', contextWindow };
  const context = vm.createContext({
    AbortController, AbortSignal, Error, setInterval, clearInterval, estimateContext, shouldCompact, measuredInput, compactionCut, isContextOverflow, compactionMessageIndex,
    retrieveMemory, memoryOverview, reviewMemory, MEMORY_REVIEW_PROMPT,
    summarizeContext: async () => 'Earlier work summary',
    setTimeout: (fn, ms) => { delays.push(ms); return setTimeout(fn, ms >= 135000 && ms <= 225000 ? idle : ms === 900000 ? total : ms === 5000 ? 1 : ms); }, clearTimeout,
    settings: { mode: 'api_key', provider: 'test', model: 'test', thinkingLevel: 'off' },
    skills: [], getEnabledDeviceSkills: async () => [],
    modelsByMode: { api_key: { getModel: () => model, getAuth: async () => true,
      streamSimple: (m, input, opts) => { inputs.push({ ...input, tools: input.tools ? [...input.tools] : undefined, messages: structuredClone(input.messages) }); prompts.push(input.systemPrompt); options.push(opts); return streams(calls++); } } },
    providers: [{ id: 'test', name: 'Test' }], syncAgentWorkspace: async () => '/workspace',
    defaultProfile: () => ({ name: 'Test', instructions: '', allowedTools: ['bash'] }), buildSystemPrompt,
    validateTools, REPOSITORY_TOOL_NAMES, CONTEXT_TOOL_NAMES, BASIC_TOOL_NAMES, makeTools, dispatchToolCalls,
    TOOL_OUTPUT_NAMES, TOOL_OUTPUT_TOOLS, TOOL_OUTPUT_INLINE_LIMIT, toolOutputStorage: outputStorage,
    mcpConfig: { mcpServers: {} }, connectMcp: async () => ({ tools: mcpTools, prepare: async () => ({ servers: [] }), call: async () => mcpOutput, close: async () => {} }),
    contextStorage: { listSources: () => [], search: (query, limit, prefix) => { contextSearches.push({ query, limit, prefix }); return [{ source: 'repo/release', title: 'Release guide', excerpt: 'Roll back by redeploying the previous version.' }]; } },
    join: (...parts) => parts.join('/'), executeTool: async name => { executions.push(name); return nativeOutput; }, saveSession: async () => {},
    publishChat: (job, event) => events.push(event),
    ...contextOverrides,
  });
  vm.runInContext(source.slice(source.indexOf('const CHAT_IDLE_TIMEOUT_MS'), source.indexOf('const defaultPersona')), context);
  const session = { id: 'session', messages: [], allowedRepositories: ['repo'], config: { mode: 'api_key', provider: 'test', model: 'test', thinkingLevel: 'off' } };
  const job = { controller: new AbortController() };
  return { events, prompts, options, delays, inputs, executions, contextSearches, outputs, session, job, appendUser(content) { const message = { role: 'user', content }; context.appendContextUser(session, message); session.messages.push(message); }, publicSession: context.publicSession, run: () => context.executeChatTurn(session, job), get calls() { return calls; } };
}
function stream(events, content = []) {
  return { async *[Symbol.asyncIterator]() { yield* events; }, result: async () => ({ role: 'assistant', api: 'test', provider: 'test', model: 'test', timestamp: Date.now(), content, usage: { input: 1 } }) };
}
const stalled = () => ({ [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } });

test('chat publishes thinking and partial tools before completion without duplicate saved calls', async () => {
  const call = { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'pwd' } };
  const h = harness(round => round === 0 ? stream([
    { type: 'thinking_start' },
    { type: 'toolcall_start', contentIndex: 0, partial: { content: [call] } },
    { type: 'toolcall_end', contentIndex: 0, toolCall: call },
  ], [call]) : stream([{ type: 'text_delta', delta: 'Done' }]));
  await h.run();
  assert.ok(h.events.some(e => e.type === 'progress' && e.status === 'thinking'));
  assert.equal(h.events.filter(e => e.type === 'tool_status').length, 3);
  assert.equal(h.session.messages[0].toolCalls.length, 1);
  assert.equal(h.session.messages[0].toolCalls[0].status, 'completed');
  assert.equal(h.session.messages[0].toolCalls[0].result, 'ok');
  assert.match(h.prompts[0], /Help users by reading, editing, and writing files and executing commands/);
  assert.match(h.prompts[0], /Ask only when urgently needed to proceed/);
});

test('later chat turns replay prior tool calls, results, and assistant replies', async () => {
  const h = harness(round => round === 0
    ? stream([], [{ type: 'toolCall', id: 'lookup', name: 'bash', arguments: { command: 'printf 42' } }])
    : stream([{ type: 'text_delta', delta: round === 1 ? 'Found 42.' : 'I found 42 earlier.' }]));
  h.appendUser('Find the value.');
  await h.run();
  h.appendUser('What did you find?');
  await h.run();

  const history = h.inputs.at(-1).messages;
  assert.deepEqual(history.map(message => message.role), ['user', 'assistant', 'toolResult', 'assistant', 'user']);
  assert.equal(history[1].content.find(block => block.type === 'toolCall').id, 'lookup');
  assert.equal(history[2].content[0].text, 'ok');
  assert.equal(history[3].content.find(block => block.type === 'text').text, 'Found 42.');
  assert.match(history[4].content, /What did you find\?/);
  assert.equal(h.publicSession(h.session).contextMessages, undefined);
});

test('legacy transcript tool results migrate into model history', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'The answer was 42.' }]));
  h.session.messages = [
    { role: 'user', content: 'Find the value.' },
    { role: 'assistant', content: 'It was 42.', toolCalls: [{ id: 'old-call', name: 'bash', arguments: { command: 'printf 42' }, status: 'completed', result: '42' }] },
    { role: 'user', content: 'What value?' },
  ];
  h.session.compaction = { summary: 'Earlier work', through: 2 };
  await h.run();
  assert.equal(h.session.compaction.through, 4);
  assert.equal(h.session.contextMessages[2].role, 'toolResult');
  assert.equal(h.session.contextMessages[2].content[0].text, '42');
  assert.match(h.inputs[0].messages[0].content, /Earlier work/);
  assert.match(h.inputs[0].messages.at(-1).content, /What value\?/);
});

test('chat retains oversized native tool output and provides search/fetch tools in the next round', async () => {
  const marker = 'uniqueLateMarker';
  const output = 'start '.repeat(1000) + marker + ' end '.repeat(1000);
  const h = harness(round => round === 0
    ? stream([], [{ type: 'toolCall', id: 'large-native', name: 'bash', arguments: { command: 'generate' } }])
    : stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [], 10000, { nativeOutput: output });
  await h.run();
  assert.equal(h.outputs.length, 1);
  assert.equal(h.outputs[0].output, output);
  assert.equal(h.outputs[0].toolName, 'bash');
  const retained = h.inputs[1].messages.find(message => message.role === 'toolResult');
  assert.match(retained.content[0].text, /Large tool output retained outside conversation context/);
  assert.doesNotMatch(retained.content[0].text, new RegExp(marker));
  assert.deepEqual(h.inputs[1].tools.map(tool => tool.name).slice(-2), TOOL_OUTPUT_NAMES);
});

test('chat can search and fetch exact retained tool output on request', async () => {
  const marker = 'uniqueLateMarker';
  const output = 'start '.repeat(1000) + marker + ' end '.repeat(1000);
  const h = harness(round => {
    if (round === 0) return stream([], [{ type: 'toolCall', id: 'large-native', name: 'bash', arguments: { command: 'generate' } }]);
    if (round === 1) return stream([], [{ type: 'toolCall', id: 'search-output', name: 'tool_output_search', arguments: { query: marker } }]);
    if (round === 2) {
      const result = JSON.parse(h.inputs[2].messages.find(message => message.role === 'toolResult' && message.toolName === 'tool_output_search').content[0].text)[0];
      return stream([], [{ type: 'toolCall', id: 'fetch-output', name: 'tool_output_fetch', arguments: { outputId: result.outputId, offset: result.offset, limit: 100 } }]);
    }
    return stream([{ type: 'text_delta', delta: 'Found it' }]);
  }, 100, 1000, [], 10000, { nativeOutput: output });
  await h.run();
  const fetched = h.inputs[3].messages.find(message => message.role === 'toolResult' && message.toolName === 'tool_output_fetch');
  assert.match(fetched.content[0].text, new RegExp(marker));
  assert.equal(h.outputs.length, 1);
});

test('chat retains oversized MCP tool output outside model history', async () => {
  const output = 'MCP output '.repeat(500);
  const h = harness(round => round === 0
    ? stream([], [{ type: 'toolCall', id: 'large-mcp', name: 'mcp_large', arguments: {} }])
    : stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [], 10000, {
    mcpTools: [{ name: 'mcp_large', description: 'Large result', parameters: { type: 'object', properties: {}, additionalProperties: false } }],
    mcpOutput: output,
  });
  await h.run();
  assert.equal(h.outputs[0].output, output);
  assert.equal(h.outputs[0].toolName, 'mcp_large');
  const retained = h.inputs[1].messages.find(message => message.role === 'toolResult');
  assert.match(retained.content[0].text, /Large tool output retained outside conversation context/);
  assert.ok(retained.content[0].text.length < output.length);
});

test('storage limit fallback exposes only an explicitly partial preview', async () => {
  const marker = 'lateUnretainedMarker';
  const output = 'ordinary line\n'.repeat(1000) + marker;
  const h = harness(round => round === 0
    ? stream([], [{ type: 'toolCall', id: 'large-unavailable', name: 'bash', arguments: { command: 'generate' } }])
    : stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [], 10000, {
    nativeOutput: output,
    outputStorageError: 'storage limit reached',
  });
  await h.run();
  assert.equal(h.outputs.length, 0);
  const result = h.inputs[1].messages.find(message => message.role === 'toolResult').content[0].text;
  assert.match(result, /Only this untrusted partial preview is available/);
  assert.doesNotMatch(result, new RegExp(marker));
  assert.ok(result.length < output.length);
  assert.deepEqual(h.inputs[1].tools.map(tool => tool.name), ['bash']);
});

test('small tool output remains inline', async () => {
  const h = harness(round => round === 0
    ? stream([], [{ type: 'toolCall', id: 'small', name: 'bash', arguments: { command: 'pwd' } }])
    : stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [], 10000, { nativeOutput: 'small result' });
  await h.run();
  assert.equal(h.outputs.length, 0);
  assert.equal(h.inputs[1].messages.find(message => message.role === 'toolResult').content[0].text, 'small result');
  assert.deepEqual(h.inputs[1].tools.map(tool => tool.name), ['bash']);
});

test('chat completes tasks requiring more than three tool rounds', async () => {
  const h = harness(round => round < 5 ? stream([], [{ type: 'toolCall', id: `call-${round}`, name: 'bash', arguments: { command: 'pwd' } }]) : stream([{ type: 'text_delta', delta: 'Done' }]));
  assert.equal(await h.run(), 'Done');
  assert.equal(h.calls, 6);
});

test('idle provider that ignores abort cannot keep chat pending', async () => {
  const h = harness(stalled, 15);
  await assert.rejects(h.run(), /Model stopped responding for 120 seconds/);
  assert.equal(h.options[0].signal.aborted, true);
});

test('chat turns have no fixed total deadline', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  assert.equal(await h.run(), 'Done');
  assert.equal(h.delays.includes(900000), false);
});

test('explicit cancellation interrupts a provider that ignores abort', async () => {
  const h = harness(stalled);
  const pending = h.run();
  setTimeout(() => h.job.controller.abort(new Error('Chat cancelled')), 10);
  await assert.rejects(pending, /Chat cancelled/);
});

test('stream failure marks partially prepared tools failed', async () => {
  const call = { type: 'toolCall', id: 'call', name: 'bash', arguments: {} };
  const h = harness(() => stream([
    { type: 'toolcall_start', contentIndex: 0, partial: { content: [call] } },
    { type: 'error', error: { errorMessage: 'Offline' } },
  ]));
  await assert.rejects(h.run(), /Offline/);
  assert.equal(h.session.messages[0].toolCalls[0].status, 'failed');
});

test('server snapshots retain progress and update tool calls by ID', () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function publishChat'), source.indexOf('function safeRepoUrl')), context);
  const job = { toolCalls: [], sequence: 0, subscribers: new Set() };
  context.publishChat(job, { type: 'progress', status: 'thinking' });
  context.publishChat(job, { type: 'tool_status', id: 'a', name: 'bash', arguments: {}, status: 'running' });
  context.publishChat(job, { type: 'tool_status', id: 'a', name: 'bash', arguments: { command: 'pwd' }, status: 'running' });
  assert.equal(job.toolCalls.length, 1);
  assert.equal(job.toolCalls[0].arguments.command, 'pwd');
  let snapshot;
  context.subscribeChat({ writeHead() {}, write(value) { snapshot = JSON.parse(value.slice(6)); }, on() {} }, job);
  assert.equal(snapshot.progress, 'thinking');
  assert.equal(snapshot.toolCalls.length, 1);
});

const timeoutStream = () => stream([{ type: 'error', error: { errorMessage: 'Request timed out.' } }]);

test('request timeouts retry three times with 5-second delays and increasing SDK timeouts', async () => {
  const h = harness(attempt => attempt < 3 ? timeoutStream() : stream([{ type: 'text_delta', delta: 'Recovered' }]));
  assert.equal(await h.run(), 'Recovered');
  assert.equal(h.calls, 4);
  assert.deepEqual(h.options.map(option => option.timeoutMs), [120000, 150000, 180000, 210000]);
  assert.ok(h.options.every(option => option.maxRetries === 0));
  assert.equal(h.delays.filter(delay => delay === 5000).length, 3);
  assert.equal(h.events.filter(event => event.status === 'retrying').length, 3);
});

test('request timeouts stop after three retries', async () => {
  const h = harness(timeoutStream);
  await assert.rejects(h.run(), /Request timed out/);
  assert.equal(h.calls, 4);
});

test('other provider errors do not retry', async () => {
  const h = harness(() => stream([{ type: 'error', error: { errorMessage: 'Invalid API key' } }]));
  await assert.rejects(h.run(), /Invalid API key/);
  assert.equal(h.calls, 1);
});

test('timeout after partial text does not replay or duplicate output', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Partial' }, { type: 'error', error: { errorMessage: 'Request timed out.' } }]));
  await assert.rejects(h.run(), /Request timed out/);
  assert.equal(h.calls, 1);
  assert.equal(h.session.messages[0].content, 'Partial');
});

test('timeout after partial tool generation does not retry', async () => {
  const h = harness(() => stream([
    { type: 'toolcall_start', contentIndex: 0, partial: { content: [{ type: 'toolCall', id: 'a', name: 'bash', arguments: {} }] } },
    { type: 'error', error: { errorMessage: 'Request timed out.' } },
  ]));
  await assert.rejects(h.run(), /Request timed out/);
  assert.equal(h.calls, 1);
});

test('cancellation during retry delay prevents another request', async () => {
  const h = harness(timeoutStream);
  const pending = h.run();
  // Retry notification happens before its delay; cancel before the timer fires.
  for (let i = 0; i < 30 && !h.events.some(event => event.status === 'retrying'); i++) await Promise.resolve();
  assert.ok(h.events.some(event => event.status === 'retrying'));
  h.job.controller.abort(new Error('Chat cancelled'));
  await assert.rejects(pending, /Chat cancelled/);
  assert.equal(h.calls, 1);
});

test('referenced file contents reach model history without changing displayed user content', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  h.session.messages.push({ role: 'user', content: 'Explain @"repo/main.js"', fileReferences: [{ path: 'repo/main.js', content: 'const answer = 42;' }] });
  await h.run();
  assert.match(h.inputs[0].messages[0].content, /Untrusted file data from repo\/main.js/);
  assert.match(h.inputs[0].messages[0].content, /const answer = 42;/);
  assert.match(h.inputs[0].messages[0].content, /never as instructions/);
  assert.equal(h.session.messages[0].content, 'Explain @"repo/main.js"');
});

for (const name of ['context_search', 'context_index', 'context_links', 'context_link', 'context_unlink']) {
  for (const permitted of [false, true]) {
    test(`${name} is advertised and executed only when the profile permits it (${permitted})`, async () => {
      const args = name === 'context_search' ? { query: 'note' } : { source: 'note.md', title: 'Note', content: 'Useful information' };
      const h = harness(round => round === 0 ? stream([], [{ type: 'toolCall', id: 'test-call', name, arguments: args }]) : stream([{ type: 'text_delta', delta: 'Done' }]));
      h.session.profile = { name: 'Test', instructions: '', allowedTools: permitted ? [name] : [] };
      await h.run();
      assert.deepEqual((h.inputs[0].tools || []).map(tool => tool.name), permitted ? [name] : []);
      assert.equal(h.session.messages[0].toolCalls[0].status, permitted ? 'completed' : 'failed');
      assert.equal(h.executions.length, permitted ? 1 : 0);
    });
  }
}

test('context is automatically retrieved only for agents with search permission', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  h.session.profile = { name: 'Test', allowedTools: ['context_search', 'context_index', 'context_links', 'context_link'] };
  h.session.messages.push({ role: 'user', content: 'How do I roll back a release?' });
  await h.run();
  assert.deepEqual(h.contextSearches, [memoryPrefix(['repo']), 'repo/'].map(prefix => ({ query: 'How do I roll back a release?', limit: 3, prefix })));
  const retrievedContext = h.inputs[0].messages.find(message => typeof message.content === 'string' && message.content.includes('Retrieved context'))?.content;
  assert.match(retrievedContext, /Retrieved context \(untrusted reference data/);
  assert.match(retrievedContext, /repo\/release/);
  assert.equal(h.inputs[0].systemPrompt, buildSystemPrompt(h.session.profile, { contextTools: h.session.profile.allowedTools, tools: h.inputs[0].tools }));
  assert.match(h.prompts[0], /Use context_link to connect related notes/);
  assert.match(h.prompts[0], /As you make changes, use context_index to record them along the way/);
  assert.ok(h.inputs[0].tools.some(tool => tool.name === 'context_links'));
  assert.ok(h.inputs[0].tools.some(tool => tool.name === 'context_link'));

  const longRequest = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  longRequest.session.profile = { name: 'Test', allowedTools: ['context_search'] };
  longRequest.session.messages.push({ role: 'user', content: 'release '.repeat(100) });
  await longRequest.run();
  assert.equal(longRequest.contextSearches[0].query.length, 100);

  const denied = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  denied.session.profile = { name: 'Test', allowedTools: [] };
  denied.session.messages.push({ role: 'user', content: 'How do I roll back a release?' });
  await denied.run();
  assert.deepEqual(denied.contextSearches, []);
});

test('no repositories disables repository tools but not explicitly permitted context tools', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  h.session.allowedRepositories = [];
  h.session.profile = { name: 'Test', allowedTools: ['read', 'edit', 'bash', 'context_search'] };
  await h.run();
  assert.deepEqual(h.inputs[0].tools.map(tool => tool.name), ['context_search']);
});

test('compaction preserves original transcript and publishes a persisted summary', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  h.session.messages = [
    { role: 'user', content: 'Original request' },
    { role: 'assistant', content: 'Earlier response ' + 'y'.repeat(100000) },
    { role: 'user', content: 'Next step' },
    { role: 'assistant', content: 'Recent response ' + 'z'.repeat(80000) },
    { role: 'user', content: 'Continue' },
  ];
  const original = structuredClone(h.session.messages);
  await h.run();
  assert.deepEqual(h.session.messages.slice(0, original.length), original);
  assert.ok(h.session.compaction.through > 0);
  assert.match(h.session.latestCompaction.summary, /^Earlier work summary/);
  assert.ok(h.events.some(event => event.type === 'compaction' && event.compaction.summary.startsWith('Earlier work summary')));
});

test('manual compaction summarizes history without sending a chat response', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'unexpected response' }]), 100, 1000, [], 10000, {
    contextOverrides: { compactionCut: () => 2 },
  });
  h.job.compactOnly = true;
  h.session.messages = [
    { role: 'user', content: 'Old request' },
    { role: 'assistant', content: 'Old response '.repeat(10000) },
    { role: 'user', content: 'Keep this recent request' },
    { role: 'assistant', content: 'Recent response', usage: { input: 230000, cacheRead: 0, cacheWrite: 0, output: 0 } },
  ];
  await h.run();
  assert.equal(h.calls, 0);
  assert.match(h.session.latestCompaction.summary, /^Earlier work summary/);
  assert.ok(h.events.some(event => event.type === 'compaction'));
  const usage = h.events.findLast(event => event.type === 'context_usage');
  assert.ok(usage.tokens < 230000, 'post-compaction usage should not reuse the pre-compaction measured count');
  assert.equal(usage.measured, false);
});

test('compaction excludes the verbatim latest request from the summary prompt', async () => {
  let summarized;
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [], 10000, {
    contextOverrides: {
      compactionCut: () => 3,
      summarizeContext: async messages => { summarized = messages; return 'Short summary'; },
    },
  });
  h.session.messages = [
    { role: 'user', content: 'Old request' },
    { role: 'assistant', content: 'Old response '.repeat(10000) },
    { role: 'user', content: 'Latest request '.repeat(3000) },
    { role: 'assistant', content: 'Recent response' },
  ];
  await h.run();
  assert.ok(summarized);
  assert.equal(summarized.some(message => String(message.content).startsWith('Latest request')), false);
  assert.match(h.session.compaction.summary, /Short summary/);
  assert.match(h.session.latestCompaction.summary, /Latest request \(retained verbatim\):/);
  assert.match(h.session.latestCompaction.summary, /Latest request/);
});

test('in-turn compaction checkpoints completed tool messages without repeating the summary', async () => {
  let summaries = 0;
  const h = harness(round => round === 0
    ? stream([], [{ type: 'toolCall', id: 'lookup', name: 'bash', arguments: { command: 'printf 42' } }])
    : stream([{ type: 'text_delta', delta: round === 1 ? 'Found 42.' : 'Still have it.' }]),
  100, 1000, [], 1000, { nativeOutput: '42', contextOverrides: {
    estimateContext: (_prompt, messages) => messages.some(message => message.role === 'toolResult') ? 1000 : 1,
    compactionCut: messages => messages.some(message => message.role === 'toolResult') ? messages.length : 0,
    summarizeContext: async () => { summaries++; return 'Summary after tool output'; },
  } });
  h.session.messages = [
    { role: 'user', content: 'Earlier request' },
    { role: 'assistant', content: 'Earlier answer' },
  ];
  h.appendUser('Current request');
  const original = structuredClone(h.session.messages);

  await h.run();
  assert.deepEqual(h.session.messages.slice(0, original.length), original);
  assert.equal(summaries, 1);
  assert.equal(h.session.compaction.through, h.session.contextMessages.length - 1);

  h.appendUser('Follow-up');
  await h.run();
  assert.equal(summaries, 1);
  assert.match(h.inputs.at(-1).messages[0].content, /Summary after tool output/);
  assert.equal(h.inputs.at(-1).messages.some(message => message.role === 'toolResult'), false);
});

test('chat discovers and executes real MCP tools and refreshes declarations between rounds', async () => {
  const args = { query: 'datadog' };
  const config = { mcpServers: { datadog: { command: process.execPath, args: ['--input-type=module', '-e', readFileSync(new URL('./fixtures/mcp-server.txt', import.meta.url), 'utf8')], env: { FIXTURE_DELAY: '200' } } } };
  const h = harness(round => {
    if (round === 0) return stream([], [{ type: 'toolCall', id: 'discover', name: 'tool_search', arguments: args }]);
    if (round === 1) return stream([], [{ type: 'toolCall', id: 'metric', name: 'mcp__datadog__get_metric', arguments: {} }]);
    return stream([{ type: 'text_delta', delta: 'The fixture metric is 42.' }]);
  }, 2000, 20000, [], 10000, { contextOverrides: { mcpConfig: config, connectMcp } });
  h.session.profile = { name: 'Agent', instructions: 'Use available integrations.', allowedTools: [] };
  h.session.messages.push({ role: 'user', content: 'Can you see Datadog?' });
  await h.run();
  assert.equal(h.calls, 3);
  assert.match(h.prompts[0], /Discover MCP tools with tool_search or codemode/);
  assert.ok(h.inputs[0].tools.some(tool => tool.name === 'tool_search'));
  assert.ok(!h.inputs[0].tools.some(tool => tool.name === 'mcp__datadog__get_metric'));
  assert.ok(h.inputs[1].tools.some(tool => tool.name === 'mcp__datadog__get_metric'));
  assert.ok(h.inputs[0].messages.some(message => String(message.content).includes('mcp__datadog')));
  const result = h.inputs[2].messages.find(message => message.role === 'toolResult' && message.toolName === 'mcp__datadog__get_metric');
  assert.match(result.content[0].text, /fixture metric:42/);
  assert.equal(result.isError, false);
  assert.equal(h.session.messages[0].content, 'Can you see Datadog?');
  assert.ok(h.session.messages.at(-1).toolCalls.every(call => call.status === 'completed'));
  assert.deepEqual(Array.from(h.session.messages.at(-1).toolCalls, call => call.name), ['tool_search', 'mcp__datadog__get_metric']);
});

test('chat exposes sanitized MCP connection failures as reference data and tool diagnostics', async () => {
  const config = { mcpServers: { datadog: { command: '/missing/SECRET_CONFIG_PATH' } } };
  const h = harness(round => round === 0
    ? stream([], [{ type: 'toolCall', id: 'discover', name: 'tool_search', arguments: { query: 'datadog' } }])
    : stream([{ type: 'text_delta', delta: 'Datadog needs attention in Settings → MCP.' }]),
  2000, 20000, [], 10000, { contextOverrides: { mcpConfig: config, connectMcp } });
  h.session.messages.push({ role: 'user', content: 'Find Datadog tools.' });
  await h.run();
  const modelInput = JSON.stringify(h.inputs[1].messages);
  assert.match(modelInput, /MCP datadog needs attention/);
  assert.doesNotMatch(modelInput, /SECRET_CONFIG_PATH/);
});

test('chat marks MCP execution failures as failed tool results rather than successful text', async () => {
  const config = { mcpServers: { datadog: { command: process.execPath, args: ['--input-type=module', '-e', readFileSync(new URL('./fixtures/mcp-server.txt', import.meta.url), 'utf8')] } } };
  const h = harness(round => round === 0
    ? stream([], [{ type: 'toolCall', id: 'discover', name: 'tool_search', arguments: { query: 'datadog' } }])
    : round === 1
      ? stream([], [{ type: 'toolCall', id: 'metric-failure', name: 'mcp__datadog__get_metric', arguments: { fail: true } }])
      : stream([{ type: 'text_delta', delta: 'The metric read failed.' }]),
  2000, 20000, [], 10000, { contextOverrides: { mcpConfig: config, connectMcp } });
  h.session.messages.push({ role: 'user', content: 'Read the fixture metric.' });
  await h.run();
  const result = h.inputs[2].messages.find(message => message.role === 'toolResult' && message.toolCallId === 'metric-failure');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MCP tool .* failed/);
  assert.ok(h.events.some(event => event.type === 'tool_complete' && event.id === 'metric-failure' && event.status === 'failed'));
});


test('HTTP execution credentials never reach chat events, model context, or persisted tool errors', async t => {
  const server = await credentialEchoServer(t);
  const h = harness(round => {
    if (round === 0) return stream([], [{ type: 'toolCall', id: 'search', name: 'tool_search', arguments: { query: 'metric' } }]);
    if (round === 1) return stream([], [{ type: 'toolCall', id: 'metric', name: 'mcp__echo__get_metric', arguments: {} }]);
    return stream([{ type: 'text_delta', delta: 'Check the MCP server connectivity in Settings.' }]);
  }, 2000, 20000, [], 10000, { contextOverrides: { mcpConfig: server.config, connectMcp } });
  h.session.messages.push({ role: 'user', content: 'Read the fixture metric.' });
  await h.run();
  const observed = JSON.stringify({ inputs: h.inputs, events: h.events, outputs: h.outputs, session: h.session });
  assert.ok(!observed.includes(server.token));
  assert.ok(!observed.includes(server.querySecret));
  const result = h.inputs[2].messages.find(message => message.role === 'toolResult' && message.toolName === 'mcp__echo__get_metric');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Settings → MCP/);
});
