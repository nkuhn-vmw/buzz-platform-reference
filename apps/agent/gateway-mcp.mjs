#!/usr/bin/env node
// The model sees only the remote fixed-document MCP tools; no local shell/FS server.
import { readFileSync } from 'node:fs';
try {
  const binding = JSON.parse(readFileSync(new URL('./.mcp-binding.json',import.meta.url),'utf8'));
  process.env.BUZZ_MCP_HTTP_URL = binding.url;
  process.env.BUZZ_MCP_BEARER_TOKEN = binding.token;
  await import('./runtime/mcp-http-stdio.js');
} catch {
  console.error('Scoped Gateway bridge could not start');
  process.exitCode=1;
}
