import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod/v4';

const documents = {
  architecture: new URL('./documents/architecture.md', import.meta.url),
  research: new URL('./documents/research.md', import.meta.url),
};

export function boundBearerToken(vcap = process.env.VCAP_SERVICES) {
  const services = JSON.parse(vcap ?? '{}');
  for (const bindings of Object.values(services)) {
    const binding = bindings.find((entry) => entry.name === 'buzz-mcp-secret');
    const token = binding?.credentials?.MCP_BEARER_TOKEN;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  throw new Error('Missing buzz-mcp-secret binding or MCP_BEARER_TOKEN');
}

function tokenMatches(header, expected) {
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? '');
  if (!match) return false;
  const presented = createHash('sha256').update(match[1]).digest();
  const bound = createHash('sha256').update(expected).digest();
  return timingSafeEqual(presented, bound);
}

function createMcpServer(log) {
  const mcp = new McpServer({ name: 'buzz-pilot-docs', version: '0.1.0' });
  mcp.registerTool('read_pilot_document', {
    title: 'Read pilot document',
    description: 'Read one approved Buzz pilot architecture or research document.',
    inputSchema: { document: z.enum(['architecture', 'research']) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ document }) => {
    const nonce = randomUUID();
    log(JSON.stringify({ tool: 'read_pilot_document', nonce }));
    const text = await readFile(documents[document], 'utf8');
    return { content: [{ type: 'text', text: `Request nonce: ${nonce}\n\n${text}` }] };
  });
  return mcp;
}

export function createServer({ token = boundBearerToken(), log = console.info } = {}) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('MCP bearer token is required');
  return createHttpServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(req.method === 'GET' ? 200 : 405, { 'content-type': 'application/json' });
      res.end(req.method === 'GET' ? '{"status":"ok"}' : '{"error":"method not allowed"}');
      return;
    }
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (!tokenMatches(req.headers.authorization, token)) {
      res.writeHead(401, { 'www-authenticate': 'Bearer', 'content-type': 'text/plain' }).end('Unauthorized');
      return;
    }
    const mcp = createMcpServer(log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await mcp.connect(transport);
      res.once('close', () => {
        void transport.close().catch(() => {});
        void mcp.close().catch(() => {});
      });
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('MCP request failed');
      else res.destroy();
      void transport.close().catch(() => {});
      void mcp.close().catch(() => {});
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}
