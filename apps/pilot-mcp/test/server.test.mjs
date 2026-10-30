import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { boundBearerToken, createServer } from '../server.mjs';

const token = 'pilot-test-token-7b1a';

test('loads the bearer secret from the named CF binding and fails closed when absent', () => {
  const vcap = JSON.stringify({ credhub: [{
    name: 'buzz-mcp-secret',
    credentials: { MCP_BEARER_TOKEN: token },
  }] });
  assert.equal(boundBearerToken(vcap), token);
  assert.throws(() => boundBearerToken('{}'), /Missing buzz-mcp-secret binding/);
});

async function withServer(run) {
  const logs = [];
  const server = createServer({ token, log: (line) => logs.push(line) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, logs);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('requires the bound bearer token and serves only the allowlisted architecture document over MCP', async () => {
  await withServer(async (baseUrl, logs) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const url = `${baseUrl}/mcp`;
    const unauthenticated = await fetch(url, { method: 'POST', body: '{}' });
    assert.equal(unauthenticated.status, 401);

    const wrongToken = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-token' },
      body: '{}',
    });
    assert.equal(wrongToken.status, 401);

    const client = new Client({ name: 'pilot-mcp-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map(({ name }) => name), ['read_pilot_document']);

      const result = await client.callTool({
        name: 'read_pilot_document',
        arguments: { document: 'architecture' },
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /Buzz|Cloud Foundry/);
      const nonce = result.content[0].text.match(/Request nonce: ([a-f0-9-]+)/)?.[1];
      assert.ok(nonce);
      assert.deepEqual(logs.map((line) => JSON.parse(line)), [{
        tool: 'read_pilot_document',
        nonce,
      }]);

      const rejected = await client.callTool({
        name: 'read_pilot_document',
        arguments: { document: '../../etc/passwd' },
      });
      assert.equal(rejected.isError, true);
      assert.doesNotMatch(rejected.content[0].text, /root:/);
    } finally {
      await client.close();
    }
  });
});
