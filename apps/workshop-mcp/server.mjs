import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function boundTokens(vcap = process.env.VCAP_SERVICES) {
  const matches = Object.values(JSON.parse(vcap ?? '{}')).flat().filter(b => b.name === 'buzz-workshop-backend-keys');
  if (matches.length !== 1) throw new Error('Exactly one buzz-workshop-backend-keys binding is required');
  return { A: matches[0].credentials?.TOKEN_A, B: matches[0].credentials?.TOKEN_B };
}

export function createServer({ tokens = boundTokens(), log = console.info } = {}) {
  if (!tokens || Object.keys(tokens).sort().join(',') !== 'A,B' ||
      Object.values(tokens).some(t => typeof t !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(t)) || tokens.A === tokens.B) {
    throw new Error('Two distinct synthetic credentials, A and B, are required');
  }
  const digests = Object.entries(tokens).map(([label, token]) => [label, createHash('sha256').update(token).digest()]);
  return createHttpServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    if (req.url === '/healthz') {
      res.writeHead(req.method === 'GET' ? 200 : 405, {'content-type':'application/json'});
      res.end(req.method === 'GET' ? '{"status":"ok"}' : '{"error":"method_not_allowed"}');
      return;
    }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    const authCount = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'authorization').length;
    const bearer = authCount === 1 && /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
    const digest = createHash('sha256').update(bearer ? bearer[1] : '').digest();
    const labels = digests.filter(([, expected]) => timingSafeEqual(expected, digest)).map(([label]) => label);
    if (!bearer || labels.length !== 1) {
      res.writeHead(401, {'www-authenticate':'Bearer realm="workshop-synthetic"'}).end('Credential required');
      return;
    }
    // This label comes only from the validated backend credential, never model input.
    const principal = labels[0];
    const mcp = new McpServer({name:'workshop-credential-receipts',version:'0.1.0'});
    mcp.registerTool('workshop_credential_receipt', {
      description:'Return a synthetic A/B credential label and a fresh receipt. Never returns credentials or private user data.',
      inputSchema:{}, annotations:{readOnlyHint:true,openWorldHint:false},
    }, async () => {
      const receipt = {principal,nonce:randomUUID(),dataset:'synthetic'};
      log(JSON.stringify({tool:'workshop_credential_receipt',...receipt}));
      return {content:[{type:'text',text:JSON.stringify(receipt)}]};
    });
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
    const close = () => { void transport.close().catch(() => {}); void mcp.close().catch(() => {}); };
    try {
      await mcp.connect(transport);
      res.once('close', close);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500).end('MCP request failed'); else res.destroy();
      close();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().listen(Number(process.env.PORT ?? 8080),'0.0.0.0');
}
