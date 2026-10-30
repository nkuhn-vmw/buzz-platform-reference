import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { consumeAiSdkChatStream } from "../chat-stream.js";

function responseFromSse(lines) {
  return new Response(Readable.toWeb(Readable.from(lines.map((line) => Buffer.from(line)))), {
    headers: { "content-type": "text/event-stream" },
  });
}

test("streams assistant text, suppresses reasoning, and maps finish stop to ACP end_turn", async () => {
  const updates = [];
  const result = await consumeAiSdkChatStream(responseFromSse([
    'data: {"type":"start"}\n\n',
    'data: {"type":"reasoning-delta","delta":"private reasoning"}\n\n',
    'data: {"type":"text-start","id":"m1"}\n\n',
    'data: {"type":"text-delta","id":"m1","delta":"Hello "}\n\n',
    'data: {"type":"text-delta","id":"m1","delta":"world"}\n\n',
    'data: {"type":"finish","finishReason":"stop"}\n\n',
    'data: [DONE]\n\n',
  ]), { onText: (text) => updates.push(text) });
  assert.deepEqual(updates, ["Hello ", "world"]);
  assert.equal(result.text, "Hello world");
  assert.equal(result.stopReason, "end_turn");
});

test("maps AI SDK tool input/output events to ACP tool call lifecycle", async () => {
  const updates = [];
  await consumeAiSdkChatStream(responseFromSse([
    'data: {"type":"tool-input-start","toolCallId":"tc1","toolName":"buzz-docs-service-access_read_pilot_document"}\n\n',
    'data: {"type":"tool-input-delta","toolCallId":"tc1","inputTextDelta":"{\\"document\\":\\"architecture\\"}"}\n\n',
    'data: {"type":"tool-input-available","toolCallId":"tc1","toolName":"buzz-docs-service-access_read_pilot_document","input":{"document":"architecture"}}\n\n',
    'data: {"type":"tool-output-available","toolCallId":"tc1","output":{"content":[{"type":"text","text":"e45ab11e-02bb-4860-a69c-85b3fa7d5a16"}]}}\n\n',
    'data: {"type":"finish","finishReason":"stop"}\n\n',
    'data: [DONE]\n\n',
  ]), { onTool: (update) => updates.push(update) });
  assert.deepEqual(updates.map(({ sessionUpdate }) => sessionUpdate), ["tool_call", "tool_call_update", "tool_call_update"]);
  assert.equal(updates[0].toolCallId, "tc1");
  assert.deepEqual(updates[1].rawInput, { document: "architecture" });
  assert.equal(updates[2].status, "completed");
});

test("parses SSE events fragmented across network chunks", async () => {
  const chunks = [
    Buffer.from('data: {"type":"text-delta","delta":"chunked"}\n'),
    Buffer.from('\ndata: {"type":"finish","finishReason":"stop"}\n\n'),
    Buffer.from('data: [DONE]\n\n'),
  ];
  const response = new Response(Readable.toWeb(Readable.from(chunks)), {
    headers: { "content-type": "text/event-stream" },
  });
  const output = [];
  const result = await consumeAiSdkChatStream(response, { onText: (text) => output.push(text) });
  assert.deepEqual(output, ["chunked"]);
  assert.equal(result.stopReason, "end_turn");
});

test("rejects streams with no successful finish event", async () => {
  await assert.rejects(consumeAiSdkChatStream(responseFromSse([
    'data: {"type":"start"}\n\n',
    'data: [DONE]\n\n',
  ])), /finish event/);
});
