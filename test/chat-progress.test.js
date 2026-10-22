import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BASIC_TOOL_NAMES, REPOSITORY_TOOL_NAMES, CONTEXT_TOOL_NAMES, validateTools, makeTools } from '../src/server/tools.js';

import { estimateContext, shouldCompact, measuredInput, compactionCut, isContextOverflow } from '../src/server/context.js';
import { buildSystemPrompt } from '../src/server/prompts.js';
import { dispatchToolCalls } from '../src/server/tool-dispatch.js';
import { resolveAgentTools } from '../src/server/agent-capabilities.js';
import { TOOL_OUTPUT_NAMES, TOOL_OUTPUT_TOOLS, TOOL_OUTPUT_INLINE_LIMIT } from '../src/server/tool-output-storage.js';

const source = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
function harness(streams, idle = 100, total = 1000, agents = [], contextWindow = 10000, { mcpTools = [], nativeOutput = 'ok', mcpOutput = 'MCP result', outputStorageError = null, contextOverrides = {} } = {}) {
  const events = [], prompts = [], options = [], delays = [], inputs = [], executions = [], whispers = [], contextSearches = [], outputs = [];
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
    AbortController, AbortSignal, Error, setInterval, clearInterval, estimateContext, shouldCompact, measuredInput, compactionCut, isContextOverflow,
    summarizeContext: async () => 'Earlier work summary',
    setTimeout: (fn, ms) => { delays.push(ms); return setTimeout(fn, ms >= 135000 && ms <= 225000 ? idle : ms === 900000 ? total : ms === 5000 ? 1 : ms); }, clearTimeout,
    settings: { mode: 'api_key', provider: 'test', model: 'test', thinkingLevel: 'off' },
    modelsByMode: { api_key: { getModel: () => model, getAuth: async () => true,
      streamSimple: (m, input, opts) => { inputs.push({ ...input, messages: structuredClone(input.messages) }); prompts.push(input.systemPrompt); options.push(opts); return streams(calls++); } } },
    providers: [{ id: 'test', name: 'Test' }], syncAgentWorkspace: async () => '/workspace',
    defaultProfile: () => ({ name: 'Test', instructions: '', allowedTools: ['bash'] }), buildSystemPrompt,
    validateTools, resolveAgentTools, REPOSITORY_TOOL_NAMES, CONTEXT_TOOL_NAMES, BASIC_TOOL_NAMES, makeTools, dispatchToolCalls,
    TOOL_OUTPUT_NAMES, TOOL_OUTPUT_TOOLS, TOOL_OUTPUT_INLINE_LIMIT, toolOutputStorage: outputStorage,
    mcpConfig: { mcpServers: {} }, connectMcp: async () => ({ tools: mcpTools, call: async () => mcpOutput, close: async () => {} }),
    sessionStorage: { listIds: () => agents.map(agent => agent.id) }, readSession: async id => agents.find(agent => agent.id === id),
    contextStorage: { search: (query, limit) => { contextSearches.push({ query, limit }); return [{ source: 'docs/release.md', title: 'Release guide', excerpt: 'Roll back by redeploying the previous version.' }]; } },
    join: (...parts) => parts.join('/'), executeTool: async name => { executions.push(name); return nativeOutput; }, saveSession: async () => {},
    whisperToAgent: async (sourceId, args) => { whispers.push(args); return 'Specialist result'; },
    publishChat: (job, event) => events.push(event),
    ...contextOverrides,
  });
  vm.runInContext(source.slice(source.indexOf('const CHAT_IDLE_TIMEOUT_MS'), source.indexOf('async function whisperToAgent')), context);
  const session = { id: 'session', messages: [], allowedRepositories: ['repo'], config: { mode: 'api_key', provider: 'test', model: 'test', thinkingLevel: 'off' } };
  const job = { controller: new AbortController() };
  return { events, prompts, options, delays, inputs, executions, whispers, contextSearches, outputs, session, job, run: (allowWhisper = true) => context.executeChatTurn(session, job, allowWhisper), get calls() { return calls; } };
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
  assert.match(h.prompts[0], /Act on clear, authorized requests/);
  assert.match(h.prompts[0], /missing fact blocks correctness/);
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

test('independent subagent assignments overlap end-to-end and duplicate prompts respect busy locks', async () => {
  const sessions = new Map(), sessionLocks = new Map();
  let queue = Promise.resolve(), activeChildren = 0, maximumActiveChildren = 0, releaseChildren;
  const childrenMayFinish = new Promise(resolve => { releaseChildren = resolve; });
  const fallback = setTimeout(releaseChildren, 250);
  const existingChildId = '00000000-0000-4000-8000-999999999999';
  const assignments = [
    { type: 'toolCall', id: 'delegate-a', name: 'subagent_create', arguments: { prompt: 'Inspect alpha independently.' } },
    { type: 'toolCall', id: 'delegate-b', name: 'subagent_create', arguments: { prompt: 'Inspect beta independently.' } },
    { type: 'toolCall', id: 'delegate-c', name: 'subagent_send_prompt', arguments: { sessionId: existingChildId, prompt: 'Inspect gamma independently.' } },
    { type: 'toolCall', id: 'delegate-d', name: 'subagent_send_prompt', arguments: { sessionId: existingChildId, prompt: 'Duplicate gamma assignment.' } },
  ];
  const childStream = () => ({
    async *[Symbol.asyncIterator]() {
      activeChildren++;
      maximumActiveChildren = Math.max(maximumActiveChildren, activeChildren);
      if (activeChildren === 3) { clearTimeout(fallback); releaseChildren(); }
      await childrenMayFinish;
      activeChildren--;
      yield { type: 'text_delta', delta: 'Child work complete.' };
    },
    result: async () => ({ content: [{ type: 'text', text: 'Child work complete.' }], usage: { input: 1 } }),
  });
  const h = harness(round => round === 0 ? stream([], assignments) : round < 4 ? childStream() : stream([{ type: 'text_delta', delta: 'All work complete.' }]), 1000, 5000, [], 10000, {
    contextOverrides: {
      structuredClone,
      validSessionId: id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id),
      activeChats: new Map(),
      sessionLocks,
      withSessionLock: (id, fn) => {
        const previous = sessionLocks.get(id) || Promise.resolve();
        const current = previous.catch(() => {}).then(fn);
        sessionLocks.set(id, current);
        return current.finally(() => { if (sessionLocks.get(id) === current) sessionLocks.delete(id); });
      },
      settings: { mode: 'api_key', provider: 'test', model: 'test', thinkingLevel: 'off', subagents: { enabled: true, maxChildren: 3 } },
      sessionStorage: {
        listIds: parentId => [...sessions.values()].filter(session => session.parentSessionId === parentId).map(session => session.id),
        save: session => sessions.set(session.id, session),
      },
      readSession: async id => sessions.get(id) || null,
      persistSession: session => sessions.set(session.id, session),
      saveSession: async session => sessions.set(session.id, session),
      syncAgentWorkspace: async session => `/workspace/${session.id}`,
      serialize: fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; },
      personas: [],
      BIRD_NAMES: ['Wren', 'Robin', 'Finch'],
      uniqueSessionName: (used, names) => names.find(name => !used.includes(name)) || `Agent ${used.length + 1}`,
      clampThinkingLevel: (_model, level) => level,
      randomUUID: (() => { let id = 0; return () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`; })(),
    },
  });
  h.session.profile = { name: 'Sunday', specialty: 'Chief', instructions: 'Delegate independent work.', allowedTools: ['subagent_create', 'subagent_send_prompt'] };
  h.session.allowedRepositories = [];
  h.session.messages.push({ role: 'user', content: 'Investigate independent areas.' });
  sessions.set(h.session.id, h.session);
  sessions.set(existingChildId, {
    id: existingChildId, parentSessionId: h.session.id, title: 'Existing child', titleEdited: true, createdAt: 1, updatedAt: 1,
    messages: [], profile: structuredClone(h.session.profile), config: structuredClone(h.session.config), allowedRepositories: [],
  });

  try {
    assert.equal(await h.run(), 'All work complete.');
  } finally {
    clearTimeout(fallback);
    releaseChildren();
  }
  assert.equal(maximumActiveChildren, 3);
  assert.deepEqual([...sessions.values()].filter(session => session.parentSessionId === h.session.id).map(session => session.messages.find(message => message.role === 'user')?.content).sort(), [
    'Inspect alpha independently.', 'Inspect beta independently.', 'Inspect gamma independently.',
  ].sort());
  const parentCalls = h.session.messages.findLast(message => message.role === 'assistant' && message.toolCalls)?.toolCalls;
  assert.ok(parentCalls.some(call => call.name === 'subagent_send_prompt' && call.status === 'failed' && call.result.includes('Subagent is busy')));
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

for (const name of ['context_search', 'context_index', 'context_links', 'context_link', 'context_unlink', 'agent_whisper', 'agent_list']) {
  for (const permitted of [false, true]) {
    test(`${name} is advertised and executed only when the profile permits it (${permitted})`, async () => {
      const args = name === 'agent_whisper' ? { agentSessionId: specialist.id, message: 'Review this' } : name === 'context_search' ? { query: 'note' } : name === 'agent_list' ? {} : { source: 'note.md', title: 'Note', content: 'Useful information' };
      const h = harness(round => round === 0 ? stream([], [{ type: 'toolCall', id: 'test-call', name, arguments: args }]) : stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [specialist]);
      h.session.profile = { name: 'Test', instructions: '', allowedTools: permitted ? [name] : [] };
      await h.run();
      assert.deepEqual((h.inputs[0].tools || []).map(tool => tool.name), permitted ? [name] : []);
      assert.equal(h.session.messages[0].toolCalls[0].status, permitted ? 'completed' : 'failed');
      assert.equal(h.executions.length + h.whispers.length, permitted && name !== 'agent_list' ? 1 : 0);
      assert.equal(h.prompts[0].includes('Choose whisper targets'), permitted && name === 'agent_whisper');
    });
  }
}

test('agent list excludes subagents from whisper targets', async () => {
  const root = { id: '00000000-0000-0000-0000-000000000002', title: 'Root', profile: { specialty: 'Research' } };
  const child = { id: '00000000-0000-0000-0000-000000000003', parentSessionId: root.id, title: 'Child', profile: { specialty: 'Research' } };
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [specialist, root, child]);
  h.session.profile = { name: 'Test', allowedTools: ['agent_whisper'] };
  h.session.messages.push({ role: 'user', content: 'Find a reviewer.' });
  await h.run();
  const context = h.inputs[0].messages.find(message => message.content.includes('Session context')).content;
  assert.match(context, new RegExp(specialist.id));
  assert.match(context, new RegExp(root.id));
  assert.doesNotMatch(context, new RegExp(child.id));
  assert.doesNotMatch(h.prompts[0], new RegExp(specialist.id));
  assert.equal(h.session.messages[0].content, 'Find a reviewer.');
});

test('whisper handler rejects a subagent target even when called directly', async () => {
  const child = { id: specialist.id, parentSessionId: '00000000-0000-0000-0000-000000000002' };
  const lock = async (_id, fn) => fn();
  const context = vm.createContext({
    validSessionId: id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id),
    activeChats: new Map(), sessionLocks: new Map(), withSessionLock: lock,
    readSession: async id => id === child.id ? child : null,
  });
  const start = source.indexOf('async function whisperToAgent');
  const end = source.indexOf('const defaultPersona', start);
  vm.runInContext(source.slice(start, end), context);
  await assert.rejects(
    vm.runInContext('whisperToAgent("00000000-0000-0000-0000-000000000004", { agentSessionId: "' + child.id + '", message: "hello" }, { aborted: false })', context),
    /Cannot whisper to a subagent/
  );
});

test('whisper permission cannot enable recursive delegation', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [specialist]);
  h.session.profile = { name: 'Test', allowedTools: ['agent_whisper'] };
  await h.run(false);
  assert.equal(h.inputs[0].tools, undefined);
  assert.equal(h.prompts[0].includes('Other available agents'), false);
});

test('context is automatically retrieved only for agents with search permission', async () => {
  const h = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  h.session.profile = { name: 'Test', allowedTools: ['context_search', 'context_index', 'context_links', 'context_link'] };
  h.session.messages.push({ role: 'user', content: 'How do I roll back a release?' });
  await h.run();
  assert.deepEqual(h.contextSearches, [{ query: 'How do I roll back a release?', limit: 3 }]);
  const retrievedContext = h.inputs[0].messages.find(message => typeof message.content === 'string' && message.content.includes('Retrieved context'))?.content;
  assert.match(retrievedContext, /Retrieved context \(untrusted reference data/);
  assert.match(retrievedContext, /docs\/release\.md/);
  assert.match(h.prompts[0], /follow useful note links when available/);
  assert.match(h.prompts[0], /Index only durable, verified, non-sensitive knowledge/);
  assert.ok(h.inputs[0].tools.some(tool => tool.name === 'context_links'));
  assert.ok(h.inputs[0].tools.some(tool => tool.name === 'context_link'));

  const longRequest = harness(() => stream([{ type: 'text_delta', delta: 'Done' }]));
  longRequest.session.profile = { name: 'Test', allowedTools: ['context_search'] };
  longRequest.session.messages.push({ role: 'user', content: 'release '.repeat(100) });
  await longRequest.run();
  assert.equal(longRequest.contextSearches[0].query.length, 300);

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


test('context_compress is permission-gated and summarizes older turns for the current response', async () => {
  const call = { type: 'toolCall', id: 'compress', name: 'context_compress', arguments: {} };
  const h = harness(round => round === 0 ? stream([], [call]) : stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [], 1000000);
  h.session.profile = { name: 'Test', allowedTools: ['context_compress'] };
  h.session.messages = [
    { role: 'user', content: 'Old request' },
    { role: 'assistant', content: 'Old response '.repeat(15000) },
    { role: 'user', content: 'Another old request' },
    { role: 'assistant', content: 'Another old response '.repeat(15000) },
    { role: 'user', content: 'Continue with the current task.' },
  ];
  const original = structuredClone(h.session.messages);
  await h.run();
  assert.deepEqual(h.inputs[0].tools.map(tool => tool.name), ['context_compress']);
  assert.ok(estimateContext('', h.inputs[1].messages, h.inputs[1].tools) < estimateContext('', h.inputs[0].messages, h.inputs[0].tools));
  assert.ok(h.inputs[1].messages.some(message => typeof message.content === 'string' && message.content.includes('Earlier conversation summary')));
  const result = h.inputs[1].messages.find(message => message.role === 'toolResult' && message.toolName === 'context_compress');
  assert.match(result.content[0].text, /original transcript is retained/i);
  const storedCall = h.session.messages.find(message => message.toolCalls?.length).toolCalls[0];
  assert.equal(storedCall.result, result.content[0].text);
  assert.ok(h.events.some(event => event.type === 'tool_complete' && event.id === 'compress' && event.result === result.content[0].text));
  assert.deepEqual(h.session.messages.slice(0, original.length), original);
  assert.equal(h.session.compaction, undefined);
  assert.equal(h.session.latestCompaction.summary, 'Earlier work summary');

  const denied = harness(round => round === 0 ? stream([], [call]) : stream([{ type: 'text_delta', delta: 'Done' }]), 100, 1000, [], 1000000);
  denied.session.profile = { name: 'Test', allowedTools: [] };
  denied.session.messages.push({ role: 'user', content: 'A short conversation.' });
  await denied.run();
  assert.deepEqual(denied.inputs[0].tools ?? [], []);
  assert.equal(denied.session.messages.at(-1).toolCalls[0].status, 'failed');
  assert.equal(denied.session.latestCompaction, undefined);
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
  assert.equal(h.session.latestCompaction.summary, 'Earlier work summary');
  assert.ok(h.events.some(event => event.type === 'compaction' && event.compaction.summary === 'Earlier work summary'));
});
