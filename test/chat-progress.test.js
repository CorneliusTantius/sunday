import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BASIC_TOOL_NAMES, REPOSITORY_TOOL_NAMES, MEMORY_TOOL_NAMES, validateTools, makeTools } from '../src/server/tools.js';

import { estimateContext, shouldCompact, measuredInput } from '../src/server/context.js';

const source = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
function harness(streams, idle = 100, total = 1000, agents = []) {
  const events = [], prompts = [], options = [], delays = [], inputs = [], executions = [], whispers = [];
  let calls = 0;
  const model = { id: 'test', api: 'test', provider: 'test', contextWindow: 10000 };
  const context = vm.createContext({
    AbortController, AbortSignal, Error, setInterval, clearInterval, estimateContext, shouldCompact, measuredInput,
    setTimeout: (fn, ms) => { delays.push(ms); return setTimeout(fn, ms >= 135000 && ms <= 225000 ? idle : ms === 900000 ? total : ms === 5000 ? 1 : ms); }, clearTimeout,
    settings: { mode: 'api_key', provider: 'test', model: 'test', thinkingLevel: 'off' },
    modelsByMode: { api_key: { getModel: () => model, getAuth: async () => true,
      streamSimple: (m, input, opts) => { inputs.push(input); prompts.push(input.systemPrompt); options.push(opts); return streams(calls++); } } },
    providers: [{ id: 'test', name: 'Test' }], syncAgentWorkspace: async () => '/workspace',
    defaultProfile: () => ({ name: 'Test', instructions: '', allowedTools: ['bash'] }),
    validateTools, REPOSITORY_TOOL_NAMES, MEMORY_TOOL_NAMES, BASIC_TOOL_NAMES, makeTools,
    readdir: async () => agents.map(agent => `${agent.id}.json`), readSession: async id => agents.find(agent => agent.id === id), sessionsDir: '/sessions', sharedMemoryDir: '/memory',
    join: (...parts) => parts.join('/'), executeTool: async name => { executions.push(name); return 'ok'; }, saveSession: async () => {},
    whisperToAgent: async (sourceId, args) => { whispers.push(args); return 'Specialist result'; },
    publishChat: (job, event) => events.push(event),
  });
  vm.runInContext(source.slice(source.indexOf('const CHAT_IDLE_TIMEOUT_MS'), source.indexOf('async function whisperToAgent')), context);
  const session = { id: 'session', messages: [], allowedRepositories: ['repo'], config: { mode: 'api_key', provider: 'test', model: 'test', thinkingLevel: 'off' } };
  const job = { controller: new AbortController() };
  return { events, prompts, options, delays, inputs, executions, whispers, session, job, run: (allowWhisper = true) => context.executeChatTurn(session, job, allowWhisper), get calls() { return calls; } };
}
function stream(events, content = []) {
  return { async *[Symbol.asyncIterator]() { yield* events; }, result: async () => ({ content, usage: { input: 1 } }) };
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
  assert.match(h.prompts[0], /Execute clear user requests immediately/);
  assert.match(h.prompts[0], /missing fact genuinely blocks/);
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

test('total deadline bounds a provider continuously emitting reasoning', async () => {
  const h = harness(() => ({ async *[Symbol.asyncIterator]() {
    while (true) { await new Promise(resolve => setTimeout(resolve, 5)); yield { type: 'thinking_delta' }; }
  }, result: () => new Promise(() => {}) }), 100, 35);
  await assert.rejects(h.run(), /Agent turn timed out after 15 minutes/);
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

const specialist = { id: '00000000-0000-0000-0000-000000000001', title: 'Reviewer', profile: { specialty: 'Code review' } };

for (const name of ['memory_search', 'memory_update', 'agent_whisper', 'agent_list']) {
  for (const permitted of [false, true]) {
    test(`${name} is advertised and executed only when the profile permits it (${permitted})`, async () => {
      const args = name === 'agent_whisper' ? { agentSessionId: specialist.id, message: 'Review this' } : name === 'memory_search' ? { query: 'note' } : name === 'agent_list' ? {} : { title: 'Note', content: 'Useful information' };
      const h = harness(round => round === 0 ? stream([], [{ type: 'toolCall', id: 'test-call', name, arguments: args }]) : stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [specialist]);
      h.session.profile = { name: 'Test', instructions: '', allowedTools: permitted ? [name] : [] };
      await h.run();
      assert.deepEqual((h.inputs[0].tools || []).map(tool => tool.name), permitted ? [name] : []);
      assert.equal(h.session.messages[0].toolCalls[0].status, permitted ? 'completed' : 'failed');
      assert.equal(h.executions.length + h.whispers.length, permitted && name !== 'agent_list' ? 1 : 0);
      assert.equal(h.prompts[0].includes('Other available agents'), permitted && name === 'agent_whisper');
      assert.equal(h.prompts[0].includes('Shared memory tools available'), permitted && MEMORY_TOOL_NAMES.includes(name));
    });
  }
}

test('whisper permission cannot enable recursive delegation', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [specialist]);
  h.session.profile = { name: 'Test', allowedTools: ['agent_whisper'] };
  await h.run(false);
  assert.equal(h.inputs[0].tools, undefined);
  assert.equal(h.prompts[0].includes('Other available agents'), false);
});

test('no repositories disables repository tools but not explicitly permitted memory', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  h.session.allowedRepositories = [];
  h.session.profile = { name: 'Test', allowedTools: ['read', 'edit', 'bash', 'memory_search'] };
  await h.run();
  assert.deepEqual(h.inputs[0].tools.map(tool => tool.name), ['memory_search']);
});

test('agent_list discovers current targets, excludes itself, and returns only public metadata', async () => {
  const agents = [];
  const h = harness(round => {
    if (round === 0) {
      agents.push({ id: '00000000-0000-0000-0000-000000000002', title: 'Self' }, { ...specialist, messages: [{ content: 'Private message' }], allowedRepositories: ['private-repo'] });
      return stream([], [{ type: 'toolCall', id: 'list', name: 'agent_list', arguments: {} }]);
    }
    return stream([{ type: 'text_delta', delta: 'Done' }]);
  }, 100, 1000, agents);
  h.session.id = '00000000-0000-0000-0000-000000000002';
  h.session.profile = { name: 'Test', allowedTools: ['agent_list'] };
  await h.run();
  const result = h.inputs[1].messages.find(message => message.role === 'toolResult');
  assert.deepEqual(JSON.parse(result.content[0].text), [{ id: specialist.id, title: 'Reviewer', responsibility: 'Code review' }]);
});

test('agent_list returns an empty list when there are no other agents', async () => {
  const h = harness(round => round === 0 ? stream([], [{ type: 'toolCall', id: 'list', name: 'agent_list', arguments: {} }]) : stream([{ type: 'text_delta', delta: 'Done' }]));
  h.session.profile = { name: 'Test', allowedTools: ['agent_list'] };
  await h.run();
  const result = h.inputs[1].messages.find(message => message.role === 'toolResult');
  assert.equal(result.content[0].text, '[]');
});

test('agent_list rejects unexpected arguments', async () => {
  const h = harness(round => round === 0 ? stream([], [{ type: 'toolCall', id: 'list', name: 'agent_list', arguments: { sourceId: specialist.id } }]) : stream([{ type: 'text_delta', delta: 'Done' }]));
  h.session.profile = { name: 'Test', allowedTools: ['agent_list'] };
  await h.run();
  assert.equal(h.session.messages[0].toolCalls[0].status, 'failed');
});
