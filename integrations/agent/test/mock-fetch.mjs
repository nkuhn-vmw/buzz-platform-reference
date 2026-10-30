import { appendFileSync } from "node:fs";

const lines = (events) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  appendFileSync(process.env.BUZZ_TEST_RECORD_PATH, `${JSON.stringify({
    body,
    authorization: new Headers(options.headers).get("authorization"),
  })}\n`);
  if (body.messages.at(-1).parts[0].text === "cancel") {
    return await new Promise((_resolve, reject) => {
      if (options.signal.aborted) reject(new DOMException("aborted", "AbortError"));
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  }
  const delta = body.messages.at(-1).parts[0].text === "first" ? "Hello" : "Again";
  return new Response(lines([
    { type: "start" },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta },
    { type: "finish", finishReason: "stop" },
  ]), { headers: { "content-type": "text/event-stream" } });
};
