import test from 'node:test';
import { credentialEchoServer } from './fixtures/mcp-http.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectMcp, validateMcpConfig } from '../src/server/mcp.js';

test('validates stdio and HTTP MCP server configuration', () => {
  assert.deepEqual(validateMcpConfig({ mcpServers: { local: { command: 'node', args: ['server.js'], env: { TOKEN: 'x' } }, remote: { url: 'https://example.com/mcp', headers: { Authorization: 'x' } } } }).mcpServers.remote.url, 'https://example.com/mcp');
  for (const config of [{}, { mcpServers: { a: { command: '' } } }, { mcpServers: { a: { url: 'file:///etc/passwd' } } }, { mcpServers: { a: { command: 'x', enabled: 'yes' } } }]) assert.throws(() => validateMcpConfig(config));
});

const fixtureSource = readFileSync(new URL('./fixtures/mcp-server.txt', import.meta.url), 'utf8');
const fixtureServer = { command: process.execPath, args: ['--input-type=module', '-e', fixtureSource] };
function issuingMessage(name, args) {
  return { role: 'assistant', api: 'test', provider: 'test', model: 'test', stopReason: 'toolUse', timestamp: Date.now(), content: [{ type: 'toolCall', id: 'fixture-call', name, arguments: args }], usage: { input: 0, output: 0 } };
}
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-mcp-'));
  const controller = new AbortController();
  const log = join(dir, 'server.log');
  const client = await connectMcp({ mcpServers: { datadog: { ...fixtureServer, ...overrides, env: { FIXTURE_LOG: log, ...overrides.env } } } }, controller.signal, { agentDir: dir });
  t.after(async () => { await client.close(); await rm(dir, { recursive: true, force: true }); });
  const call = (name, args) => client.call(name, args, issuingMessage(name, args));
  return { client, controller, log, call };
}

test('real MCP discovery waits for startup and loads tools for subsequent calls', async t => {
  const { client, call } = await fixture(t, { env: { FIXTURE_DELAY: '300' } });
  assert.deepEqual(client.tools.map(tool => tool.name).sort(), ['codemode', 'tool_search']);
  const context = await client.prepare();
  assert.deepEqual(context.servers, ['datadog']);
  assert.match(context.discovery, /mcp__datadog/);
  assert.ok(!client.tools.some(tool => tool.name === 'read'));
  assert.match(await call('tool_search', { query: 'datadog' }), /mcp__datadog__get_metric/);
  assert.ok(client.tools.some(tool => tool.name === 'mcp__datadog__get_metric'));
  assert.match(await call('mcp__datadog__get_metric', {}), /fixture metric:42/);
  await assert.rejects(call('mcp__datadog__get_metric', { fail: true }), /MCP tool .* failed/);
  await assert.rejects(call('mcp__datadog__get_metric', { fail: 'invalid' }), /MCP tool .* failed/);
  await assert.rejects(call('read', { path: '/etc/passwd' }), /Unknown MCP tool/);
});

test('codemode uses the SDK nested tool pipeline without another model run or filesystem tools', async t => {
  const { call } = await fixture(t, { env: { FIXTURE_DELAY: '300' } });
  assert.match(await call('codemode', { code: 'console.log(await tools.mcp__datadog__get_metric({}));' }), /fixture metric:42/);
  await assert.rejects(call('codemode', { code: 'console.log(await tools.read({path:"/etc/passwd"}));' }), /MCP tool .* failed/);
});

test('direct and deferred MCP exposure are supported', async t => {
  for (const exposure of ['direct', 'deferred']) {
    await t.test(exposure, async t => {
      const { client, call } = await fixture(t, { exposure });
      await client.prepare();
      if (exposure === 'deferred') await call('tool_search', { query: 'datadog' });
      assert.ok(client.tools.some(tool => tool.name === 'mcp__datadog__get_metric'));
      assert.match(await call('mcp__datadog__get_metric', {}), /fixture metric:42/);
    });
  }
});

test('disabled MCP servers do not start transports or expose discovery tools', async t => {
  const { client, log } = await fixture(t, { enabled: false });
  assert.deepEqual(client.tools, []);
  assert.deepEqual((await client.prepare()).servers, []);
  await assert.rejects(readFile(log), { code: 'ENOENT' });
});

test('MCP failures produce actionable diagnostics without transport secrets', async t => {
  const secret = 'DO_NOT_EXPOSE_TRANSPORT_SECRET';
  const { client, call } = await fixture(t, { command: `/missing/${secret}`, args: [] });
  await call('tool_search', { query: 'datadog' });
  const context = await client.prepare();
  assert.ok(context.diagnostics.length);
  assert.match(context.diagnostics.join(' '), /Settings → MCP/);
  assert.doesNotMatch(JSON.stringify(context), new RegExp(secret));
});

test('MCP abort closes its transport, close is idempotent, and closed sessions reject calls', async t => {
  const { client, controller, call, log } = await fixture(t);
  await call('tool_search', { query: 'datadog' });
  const pid = Number((await readFile(log, 'utf8')).match(/start:(\d+)/)[1]);
  controller.abort(new Error('Fixture cancelled'));
  await client.close();
  await client.close();
  await assert.rejects(call('tool_search', { query: 'datadog' }), /Fixture cancelled/);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('MCP authentication failures distinguish needs-sign-in from stored credentials', async t => {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Unauthorized' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'sunday-mcp-auth-'));
  const client = await connectMcp({ mcpServers: { authRequired: { url: `http://127.0.0.1:${server.address().port}/mcp` } } }, AbortSignal.timeout(10000), { agentDir: dir });
  t.after(async () => { await client.close(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  await client.call('tool_search', { query: 'metrics' }, issuingMessage('tool_search', { query: 'metrics' }));
  assert.match((await client.prepare()).diagnostics.join(' '), /Sign in again in Settings → MCP/);
});

test('aborting discovery while a transport starts settles the call and releases the subprocess', async t => {
  const { client, controller, call, log } = await fixture(t, { env: { FIXTURE_DELAY: '2000' } });
  const pending = call('tool_search', { query: 'datadog' });
  // The fixture writes before delaying its initialize response.
  let contents;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { contents = await readFile(log, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (contents?.includes('initialize')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.match(contents, /initialize/);
  const pid = Number(contents.match(/start:(\d+)/)[1]);
  controller.abort(new Error('Discovery cancelled'));
  await assert.rejects(pending);
  await client.close();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('MCP discovery state is isolated between concurrent agent sessions', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  await first.call('tool_search', { query: 'datadog' });
  assert.ok(first.client.tools.some(tool => tool.name === 'mcp__datadog__get_metric'));
  assert.ok(!second.client.tools.some(tool => tool.name === 'mcp__datadog__get_metric'));
  await first.client.close();
  await assert.rejects(first.call('tool_search', { query: 'datadog' }), /MCP connection is closed/);
  await second.call('tool_search', { query: 'datadog' });
  assert.match(await second.call('mcp__datadog__get_metric', {}), /fixture metric:42/);
});


test('execution, nested codemode errors, and reconnect failures never expose HTTP credentials', async t => {
  const server = await credentialEchoServer(t);
  const dir = await mkdtemp(join(tmpdir(), 'sunday-mcp-secrets-'));
  const client = await connectMcp(server.config, AbortSignal.timeout(15000), { agentDir: dir });
  t.after(async () => { await client.close(); await rm(dir, { recursive: true, force: true }); });
  const call = (name, args) => client.call(name, args, issuingMessage(name, args));
  await call('tool_search', { query: 'metric' });
  const observed = [];
  await assert.rejects(call('mcp__echo__get_metric', {}), error => {
    observed.push(error.message);
    return /Settings → MCP/.test(error.message);
  });
  observed.push(await call('codemode', { code: 'try { await tools.mcp__echo__get_metric({}); } catch (error) { console.log(error.message); }' }));
  server.failReconnect();
  await assert.rejects(call('mcp__echo__get_metric', {}), error => {
    observed.push(error.message);
    return /Settings → MCP/.test(error.message);
  });
  assert.ok(server.initializations >= 2, 'expired sessions must attempt a new initialize handshake');
  observed.push(JSON.stringify(await client.prepare()));
  observed.push(JSON.stringify(client.tools));
  for (const output of observed) {
    assert.ok(!output.includes(server.token));
    assert.ok(!output.includes(server.querySecret));
  }
});


test('successful responses redact resolved environment headers and URL query credentials', async t => {
  const server = await credentialEchoServer(t);
  const previous = process.env.SUNDAY_MCP_TEST_TOKEN;
  process.env.SUNDAY_MCP_TEST_TOKEN = server.token;
  t.after(() => { if (previous === undefined) delete process.env.SUNDAY_MCP_TEST_TOKEN; else process.env.SUNDAY_MCP_TEST_TOKEN = previous; });
  server.config.mcpServers.echo.headers.Authorization = 'Bearer ${SUNDAY_MCP_TEST_TOKEN}';
  const client = await connectMcp(server.config, AbortSignal.timeout(10000));
  t.after(() => client.close());
  await client.call('tool_search', { query: 'metric' }, issuingMessage('tool_search', { query: 'metric' }));
  const output = await client.call('mcp__echo__get_metric', { echo: true }, issuingMessage('mcp__echo__get_metric', { echo: true }));
  assert.equal(server.receivedAuthorization, `Bearer ${server.token}`);
  assert.ok(!output.includes(server.token));
  assert.ok(!output.includes(server.querySecret));
  assert.match(output, /REDACTED/);
  assert.ok(JSON.parse(output).structuredContent);
});

test('successful responses redact stored and rotated OAuth access tokens', async t => {
  const server = await credentialEchoServer(t);
  delete server.config.mcpServers.echo.headers;
  const dir = await mkdtemp(join(tmpdir(), 'sunday-oauth-redaction-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const saveToken = token => writeFile(join(dir, 'mcp-auth.json'), JSON.stringify({
    [server.config.mcpServers.echo.url]: { tokens: { access_token: token, token_type: 'Bearer' } },
  }));
  await saveToken(server.token);
  const client = await connectMcp(server.config, AbortSignal.timeout(10000), { agentDir: dir });
  t.after(() => client.close());
  await client.call('tool_search', { query: 'metric' }, issuingMessage('tool_search', { query: 'metric' }));
  for (const token of [server.token, 'synthetic-rotated-oauth-token']) {
    await saveToken(token);
    const output = await client.call('mcp__echo__get_metric', { echo: true }, issuingMessage('mcp__echo__get_metric', { echo: true }));
    assert.equal(server.receivedAuthorization, `Bearer ${token}`);
    assert.ok(!output.includes(token));
    assert.match(output, /REDACTED/);
  }
});


test('server notifications cannot persist configured or stored OAuth credentials in SDK logs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sunday-mcp-log-safety-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const configured = 'synthetic-notification-configured-secret';
  const access = 'synthetic-notification-oauth-access';
  const refresh = 'synthetic-notification-oauth-refresh';
  const authPath = join(dir, 'mcp-auth.json');
  const notificationLog = join(dir, 'fixture-lifecycle.log');
  const sdkLog = join(dir, 'mcp.log');
  await writeFile(authPath, JSON.stringify({ fixture: { tokens: { access_token: access, refresh_token: refresh } } }));
  await writeFile(sdkLog, 'existing log remains unchanged\n');
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const client = await connectMcp({ mcpServers: { datadog: { ...fixtureServer, env: {
    API_TOKEN: configured, FIXTURE_AUTH_PATH: authPath, FIXTURE_LOG: notificationLog,
  } } } }, AbortSignal.timeout(10000), { agentDir: dir });
  t.after(() => client.close());
  const output = await client.call('tool_search', { query: 'datadog' }, issuingMessage('tool_search', { query: 'datadog' }));
  assert.match(await readFile(notificationLog, 'utf8'), /notifications-sent/);
  await client.close();
  const log = await readFile(sdkLog, 'utf8');
  assert.equal(log, 'existing log remains unchanged\n');
  await assert.rejects(readFile(`${sdkLog}.1`), { code: 'ENOENT' });
  for (const secret of [configured, access, refresh]) {
    assert.ok(!log.includes(secret));
    assert.ok(!output.includes(secret));
  }
});
