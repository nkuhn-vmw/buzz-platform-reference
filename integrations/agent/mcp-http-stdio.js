#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const endpoint = process.env.BUZZ_MCP_HTTP_URL;
if (!endpoint) {
  console.error("BUZZ_MCP_HTTP_URL is required");
  process.exit(78);
}

let url;
try {
  url = new URL(endpoint);
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("expected http(s)");
} catch (error) {
  console.error(`Invalid BUZZ_MCP_HTTP_URL: ${error.message}`);
  process.exit(78);
}

const headers = {};
if (process.env.BUZZ_MCP_BEARER_TOKEN) {
  headers.Authorization = `Bearer ${process.env.BUZZ_MCP_BEARER_TOKEN}`;
}
const remote = new Client({ name: "buzz-tanzu-mcp-bridge", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: Object.keys(headers).length ? { headers } : undefined,
});
const local = new Server(
  { name: "buzz-tanzu-mcp-stdio", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

local.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = await remote.listTools();
  return { tools: result.tools };
});
local.setRequestHandler(CallToolRequestSchema, async (request) => {
  return remote.callTool({
    name: request.params.name,
    arguments: request.params.arguments ?? {},
  });
});

const stdio = new StdioServerTransport();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.allSettled([local.close(), remote.close(), transport.close()]);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => { void close().finally(() => process.exit(0)); });
}

try {
  await remote.connect(transport);
  await local.connect(stdio);
} catch (error) {
  console.error(`MCP HTTP bridge startup failed: ${error.message}`);
  await close();
  process.exit(1);
}
