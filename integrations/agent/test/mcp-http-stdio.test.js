import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const bridgePath = new URL("../mcp-http-stdio.js", import.meta.url);
const mockPath = new URL("./mock-mcp-http.mjs", import.meta.url);

test("stdio bridge uses the MCP SDK to discover and call Gateway Streamable HTTP tools", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "buzz-mcp-bridge-"));
  const recordPath = join(tempDir, "requests.ndjson");
  const transport = new StdioClientTransport({ command: process.execPath, args: [bridgePath.pathname], env: {
    ...process.env,
    BUZZ_MCP_HTTP_URL: "https://gateway.invalid/backend/mcp",
    BUZZ_MCP_BEARER_TOKEN: "session-secret",
    BUZZ_TEST_MCP_RECORD_PATH: recordPath,
    NODE_OPTIONS: `--import=${mockPath.pathname}`,
  } });
  const client = new Client({ name: "bridge-test", version: "1" });
  t.after(async () => {
    await client.close().catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  });

  await client.connect(transport);
  const discovered = await client.listTools();
  assert.deepEqual(discovered.tools.map((tool) => tool.name), ["echo"]);
  const result = await client.callTool({ name: "echo", arguments: { text: "hello" } });
  assert.equal(result.content[0].text, "echo:hello");

  const until = Date.now() + 3000;
  let rows = [];
  while (Date.now() < until) {
    try { rows = (await readFile(recordPath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); } catch {}
    if (rows.some((row) => row.method === "tools/call")) break;
    await delay(10);
  }
  assert.ok(rows.some((row) => row.method === "tools/list"));
  assert.ok(rows.some((row) => row.method === "tools/call"));
  assert.ok(rows.every((row) => row.authorization === "Bearer session-secret"));
});
