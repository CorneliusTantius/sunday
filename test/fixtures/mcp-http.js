import { createServer } from 'node:http';

export async function credentialEchoServer(t) {
  const token = 'synthetic-mcp-bearer-secret';
  const querySecret = 'synthetic-mcp-url-secret';
  let reconnectFails = false;
  let receivedAuthorization;
  let initializations = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    const message = JSON.parse(body);
    if (!('id' in message)) { response.writeHead(202).end(); return; }
    if (message.method === 'initialize') initializations++;
    receivedAuthorization = request.headers.authorization;
    if (reconnectFails && message.method === 'tools/call') { response.writeHead(404).end('Session not found'); return; }
    const echo = `Transport failure: ${request.headers.authorization}; URL ${request.url}`;
    if (message.method === 'tools/call' && message.params.arguments?.echo) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: echo }], structuredContent: { echo } } }));
      return;
    }
    if (message.method === 'tools/call' || reconnectFails) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end(echo);
      return;
    }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'credential-fixture', version: '1' } }
      : { tools: [{ name: 'get_metric', description: 'Read fixture metrics', inputSchema: { type: 'object', properties: { echo: { type: 'boolean' } } } }] };
    response.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'fixture-session' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    token, querySecret,
    get initializations() { return initializations; },
    get receivedAuthorization() { return receivedAuthorization; },
    config: { mcpServers: { echo: { url: `http://127.0.0.1:${server.address().port}/mcp?key=${querySecret}`, headers: { Authorization: `Bearer ${token}` } } } },
    failReconnect() { reconnectFails = true; },
  };
}
