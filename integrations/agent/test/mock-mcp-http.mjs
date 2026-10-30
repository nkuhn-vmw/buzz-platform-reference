import { appendFileSync } from "node:fs";

globalThis.fetch = async (_url, init = {}) => {
  const request = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  if (process.env.BUZZ_TEST_MCP_RECORD_PATH) {
    appendFileSync(process.env.BUZZ_TEST_MCP_RECORD_PATH, `${JSON.stringify({
      method: request?.method,
      authorization: new Headers(init.headers).get("authorization"),
    })}\n`);
  }
  if (request?.method === "notifications/initialized") return new Response(null, { status: 202 });
  let result;
  if (request?.method === "initialize") {
    result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "test-gateway", version: "1" } };
  } else if (request?.method === "tools/list") {
    result = { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] };
  } else if (request?.method === "tools/call") {
    result = { content: [{ type: "text", text: `echo:${request.params.arguments.text}` }] };
  } else {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32601, message: "not found" } }), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": "test-session" },
    });
  }
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
    status: 200,
    headers: { "content-type": "application/json", "mcp-session-id": "test-session" },
  });
};
