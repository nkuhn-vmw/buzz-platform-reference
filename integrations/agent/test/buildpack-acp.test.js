import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const adapterPath = new URL("../buildpack-acp.js", import.meta.url);
const mockPath = new URL("./mock-fetch.mjs", import.meta.url);

async function waitFor(lines, predicate, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const index = lines.findIndex(predicate);
    if (index >= 0) return lines.splice(index, 1)[0];
    await delay(10);
  }
  throw new Error(`timed out waiting for adapter output; got ${JSON.stringify(lines)}`);
}

async function readRecorded(path, count) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    try {
      const rows = (await readFile(path, "utf8")).trim().split("\n").filter(Boolean);
      if (rows.length >= count) return rows.map((row) => JSON.parse(row));
    } catch {}
    await delay(10);
  }
  throw new Error(`timed out waiting for ${count} chat requests`);
}

test("ACP adapter preserves transcript, streams text, and resolves local cancellation", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "buzz-agent-acp-"));
  const recordPath = join(tempDir, "requests.ndjson");
  const child = spawn(process.execPath, [adapterPath.pathname], {
    env: {
      ...process.env,
      BUZZ_TANZU_AGENT_URL: "http://agent.invalid/api/chat",
      BUZZ_TANZU_AGENT_BEARER_TOKEN: "must-not-be-forwarded",
      BUZZ_TEST_RECORD_PATH: recordPath,
      NODE_OPTIONS: `--import=${mockPath.pathname}`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true });
  });
  let output = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  const lines = [];
  const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  reader.on("line", (line) => lines.push(JSON.parse(line)));
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 2 } });
  assert.equal((await waitFor(lines, (line) => line.id === 1)).result.protocolVersion, 2);
  send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { systemPrompt: "Be concise." } });
  const sessionId = (await waitFor(lines, (line) => line.id === 2)).result.sessionId;

  send({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: "first" }] } });
  assert.equal((await waitFor(lines, (line) => line.method === "session/update")).params.update.content.text, "Hello");
  assert.equal((await waitFor(lines, (line) => line.id === 3)).result.stopReason, "end_turn");
  send({ jsonrpc: "2.0", id: 4, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: "second" }] } });
  assert.equal((await waitFor(lines, (line) => line.method === "session/update")).params.update.content.text, "Again");
  assert.equal((await waitFor(lines, (line) => line.id === 4)).result.stopReason, "end_turn");
  const requests = await readRecorded(recordPath, 2);
  assert.equal(requests[0].body.id, sessionId);
  assert.deepEqual(requests[1].body.messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.equal(requests[0].authorization, null, "the adapter must not claim Bearer auth is supported");

  send({ jsonrpc: "2.0", id: 5, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: "cancel" }] } });
  await readRecorded(recordPath, 3);
  send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
  assert.equal((await waitFor(lines, (line) => line.id === 5)).result.stopReason, "cancelled");
  assert.equal(output, "");
});
