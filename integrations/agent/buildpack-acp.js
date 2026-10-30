#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { consumeAiSdkChatStream } from "./chat-stream.js";

const chatUrl = process.env.BUZZ_TANZU_AGENT_URL || `http://localhost:${process.env.PORT || 8080}/api/chat`;
let parsedUrl;
try {
  parsedUrl = new URL(chatUrl);
  if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) throw new Error("expected http(s)");
} catch (error) {
  console.error(`Invalid BUZZ_TANZU_AGENT_URL: ${error.message}`);
  process.exit(78);
}
const sessions = new Map();
const active = new Map();

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}
function notify(sessionId, update) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  });
}
function textPrompt(params) {
  if (!Array.isArray(params.prompt) || params.prompt.length === 0) {
    throw new Error("prompt must contain at least one text block");
  }
  const parts = params.prompt.map((block) => {
    if (block?.type !== "text" || typeof block.text !== "string") {
      throw new Error("only ACP text prompt blocks are supported");
    }
    return block.text;
  });
  return parts.join("\n");
}
function systemPrompt(params) {
  const value = params.systemPrompt ?? params._meta?.systemPrompt;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && typeof value.append === "string") return value.append;
  return undefined;
}

async function runPrompt(requestId, sessionId, prompt) {
  const state = sessions.get(sessionId);
  if (!state) return fail(requestId, -32001, "unknown session");
  if (active.has(sessionId)) return fail(requestId, -32002, "session already has a prompt in flight");

  const controller = new AbortController();
  active.set(sessionId, { controller, requestId });
  const messages = [...state.messages, {
    id: randomUUID(),
    role: "user",
    parts: [{ type: "text", text: prompt }],
  }];
  const headers = { "content-type": "application/json", accept: "text/event-stream" };

  try {
    const response = await fetch(parsedUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ trigger: "submit-message", id: sessionId, messages }),
      signal: controller.signal,
    });
    let output = "";
    const result = await consumeAiSdkChatStream(response, {
      onText: (delta) => {
        output += delta;
        notify(sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: delta },
        });
      },
      onTool: (update) => notify(sessionId, update),
    });
    state.messages = [...messages, {
      id: randomUUID(),
      role: "assistant",
      parts: [{ type: "text", text: output }],
    }];
    respond(requestId, { stopReason: result.stopReason });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      respond(requestId, { stopReason: "cancelled" });
    } else {
      fail(requestId, -32000, `Agent Buildpack chat failed: ${error.message}`);
    }
  } finally {
    if (active.get(sessionId)?.controller === controller) active.delete(sessionId);
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
  const hasId = Object.hasOwn(message, "id");
  const id = message.id;
  const params = message.params ?? {};
  try {
    switch (message.method) {
      case "initialize":
        respond(id, {
          protocolVersion: typeof params.protocolVersion === "number" ? params.protocolVersion : 2,
          agentCapabilities: {
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
          },
          agentInfo: { name: "buzz-tanzu-agent-buildpack", version: "0.1.0" },
        });
        break;
      case "session/new": {
        const sessionId = randomUUID();
        const initial = systemPrompt(params);
        sessions.set(sessionId, {
          messages: initial ? [{ id: randomUUID(), role: "system", parts: [{ type: "text", text: initial }] }] : [],
        });
        respond(id, { sessionId });
        break;
      }
      case "session/prompt": {
        const sessionId = params.sessionId;
        if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
          fail(id, -32001, "unknown session");
          break;
        }
        if (active.has(sessionId)) {
          fail(id, -32002, "session already has a prompt in flight");
          break;
        }
        const prompt = textPrompt(params);
        void runPrompt(id, sessionId, prompt);
        break;
      }
      case "session/cancel": {
        const running = active.get(params.sessionId);
        if (running) running.controller.abort();
        break;
      }
      case "session/close":
        sessions.delete(params.sessionId);
        active.get(params.sessionId)?.controller.abort();
        if (hasId) respond(id, {});
        break;
      default:
        if (hasId) fail(id, -32601, `method not supported: ${message.method}`);
    }
  } catch (error) {
    if (hasId) fail(id, -32602, error.message);
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  void handle(message);
});
input.on("close", () => {
  for (const { controller } of active.values()) controller.abort();
});
