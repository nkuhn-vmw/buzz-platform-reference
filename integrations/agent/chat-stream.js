/** Consume the observed Vercel AI SDK data stream used by Agent Buildpack. */
export async function consumeAiSdkChatStream(response, { onText = () => {}, onTool = () => {} } = {}) {
  if (!response?.ok) {
    throw new Error(`Agent Buildpack chat returned HTTP ${response?.status ?? "error"}`);
  }
  if (!response.body) throw new Error("Agent Buildpack chat response has no stream body");

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let text = "";
  let stopReason;
  let doneMarker = false;
  let dataLines = [];
  const tools = new Map();

  const consumeEvent = (data) => {
    if (data === "[DONE]") {
      doneMarker = true;
      return;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("Agent Buildpack emitted malformed SSE data");
    }
    switch (event.type) {
      case "text-delta":
        if (typeof event.delta === "string" && event.delta) {
          text += event.delta;
          onText(event.delta);
        }
        break;
      case "tool-input-start": {
        const id = event.toolCallId;
        if (typeof id !== "string") break;
        tools.set(id, { title: typeof event.toolName === "string" ? event.toolName : "tool" });
        onTool({
          sessionUpdate: "tool_call",
          toolCallId: id,
          title: tools.get(id).title,
          kind: "other",
          status: "in_progress",
          rawInput: {},
        });
        break;
      }
      case "tool-input-available": {
        const id = event.toolCallId;
        if (typeof id !== "string") break;
        if (!tools.has(id)) {
          tools.set(id, { title: typeof event.toolName === "string" ? event.toolName : "tool" });
          onTool({
            sessionUpdate: "tool_call",
            toolCallId: id,
            title: tools.get(id).title,
            kind: "other",
            status: "in_progress",
            rawInput: event.input ?? {},
          });
        } else {
          onTool({
            sessionUpdate: "tool_call_update",
            toolCallId: id,
            status: "in_progress",
            rawInput: event.input ?? {},
          });
        }
        break;
      }
      case "tool-output-available": {
        if (typeof event.toolCallId === "string") {
          if (!tools.has(event.toolCallId)) {
            tools.set(event.toolCallId, { title: typeof event.toolName === "string" ? event.toolName : "tool" });
            onTool({
              sessionUpdate: "tool_call",
              toolCallId: event.toolCallId,
              title: tools.get(event.toolCallId).title,
              kind: "other",
              status: "in_progress",
              rawInput: event.input ?? {},
            });
          }
          onTool({ sessionUpdate: "tool_call_update", toolCallId: event.toolCallId, status: "completed" });
        }
        break;
      }
      case "tool-output-error":
        if (typeof event.toolCallId === "string") {
          onTool({ sessionUpdate: "tool_call_update", toolCallId: event.toolCallId, status: "failed" });
        }
        break;
      case "finish":
        if (event.finishReason === "length") stopReason = "max_tokens";
        else if (event.finishReason === "stop" || event.finishReason === "tool-calls") stopReason = "end_turn";
        else stopReason = "end_turn";
        break;
      // Intentionally ignore reasoning and metadata events. ACP has no need for
      // hidden reasoning text, model usage, or UI-only message metadata.
      default:
        break;
    }
  };

  const consumeLines = (chunk, final = false) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    const flush = () => {
      if (!dataLines.length) return;
      const data = dataLines.join("\n");
      dataLines = [];
      consumeEvent(data);
    };
    for (const line of lines) {
      if (!line) flush();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (final) {
      if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).replace(/^ /, ""));
      flush();
      buffer = "";
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      consumeLines(decoder.decode(value, { stream: true }));
    }
    consumeLines(decoder.decode(), true);
  } finally {
    reader.releaseLock();
  }

  if (!stopReason) throw new Error("Agent Buildpack chat stream ended without a finish event");
  if (!doneMarker) throw new Error("Agent Buildpack chat stream ended without [DONE]");
  return { text, stopReason };
}
