#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolveTanzuModelBinding } from "./bindings.js";

let resolved;
try {
  resolved = resolveTanzuModelBinding(
    process.env.VCAP_SERVICES,
    process.env.BUZZ_TANZU_AI_SERVICE,
    process.env.BUZZ_TANZU_AI_MODEL || process.env.TANZU_AGENT_GENAI_MODEL_NAME,
  );
} catch (error) {
  console.error(`Tanzu model binding: ${error.message}`);
  process.exit(78);
}

const command = process.env.BUZZ_AGENT_COMMAND || "buzz-agent";
const args = process.argv.slice(2);
const child = spawn(command, args, {
  env: { ...process.env, ...resolved },
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(`Unable to start ${command}: ${error.message}`);
  process.exit(127);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
