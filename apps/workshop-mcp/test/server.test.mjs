import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { boundTokens, createServer } from '../server.mjs';

test('backend requires one binding with distinct synthetic identities', () => {
  assert.throws(() => boundTokens('{}'), /Exactly one/);
  const entry = {name:'buzz-workshop-backend-keys',credentials:{TOKEN_A:'a'.repeat(43),TOKEN_B:'b'.repeat(43)}};
  assert.deepEqual(boundTokens(JSON.stringify({credhub:[entry]})), {A:entry.credentials.TOKEN_A,B:entry.credentials.TOKEN_B});
  assert.throws(() => boundTokens(JSON.stringify({credhub:[entry,entry]})), /Exactly one/);
  assert.throws(() => createServer({tokens:{A:entry.credentials.TOKEN_A,B:entry.credentials.TOKEN_A}}), /distinct/);
});

test('real MCP clients receive only their credential label, with no secret in replies or logs', async t => {
  const tokens = {A:randomBytes(32).toString('base64url'),B:randomBytes(32).toString('base64url')};
  const logs=[];
  const server=createServer({tokens,log:line=>logs.push(line)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/healthz`)).status,200);
  for(const header of ['', 'Bearer invalid', `Basic ${tokens.A}`]) {
    assert.equal((await fetch(`${base}/mcp`,{method:'POST',headers:{authorization:header},body:'{}'})).status,401);
  }
  const receipts=[];
  for(const principal of ['A','B']) {
    const client=new Client({name:`workshop-${principal}`,version:'1.0.0'});
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`),{requestInit:{headers:{authorization:`Bearer ${tokens[principal]}`}}}));
      assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['workshop_credential_receipt']);
      // A claimed identity in tool input cannot select the other credential's label.
      const result=await client.callTool({name:'workshop_credential_receipt',arguments:{principal:principal==='A'?'B':'A'}});
      const receipt=JSON.parse(result.content[0].text);
      assert.equal(receipt.principal,principal);
      assert.equal(receipt.dataset,'synthetic');
      assert.match(receipt.nonce,/^[a-f0-9-]{36}$/);
      receipts.push(receipt);
    } finally { await client.close(); }
  }
  assert.notEqual(receipts[0].nonce,receipts[1].nonce);
  assert.deepEqual(logs.map(line=>JSON.parse(line).principal),['A','B']);
  for(const token of Object.values(tokens)) assert.ok(!JSON.stringify({receipts,logs}).includes(token));
});
