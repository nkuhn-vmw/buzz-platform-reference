---
name: troubleshoot-buzz
description: Diagnose Buzz installation, Cloud Foundry provisioning, identity, relay, agent, and tool-path failures using the repository's scoped diagnostic commands.
---

# Troubleshoot Buzz

Read `docs/troubleshooting.md` and inspect the relevant source path before proposing a recovery. Use the configured CF wrapper, which isolates local CF state and refuses context overrides.

## Workflow

1. Check `node scripts/cf.mjs --verify-target` and `node scripts/deploy.mjs status`.
2. Inspect relevant services, tasks, events, and sanitized recent logs with commands listed in `docs/troubleshooting.md`.
3. Trace the failing path in order: user/channel authorization, owner grant, worker task and lease, ACP bridge, native agent endpoint, model binding, Gateway binding, read-only MCP backend, relay reply route.
   The current Helper task verified TLS 1.3 and its PostgreSQL certificate. If a worker activation fails in another target, check its binding, CA chain, and direct-connection support; this pilot result does not establish TLS for relay or identity databases.
4. Compare service names and configuration with the rendered manifest and source. Do not print or copy `.state/`, `.credentials/`, VCAP bindings, or environment secrets.
5. Recommend the smallest reversible repair. Before a retry, determine whether the prior service broker operation or CF Task is still active.
6. Recheck the affected user flow and document the result, including any validation that remains unavailable.

## Recovery

If CF target verification fails, stop and request a corrected operator config. If service plans mismatch or an operation failed, inspect the broker state before making another create request. If a worker lease may still be held, inspect the existing task before activation; do not solve a stuck response by starting duplicates.

## Completion

Report the observed symptom, evidence, cause if established, smallest recovery, and exact check that confirms resolution. Clearly distinguish source diagnosis, local checks, CF deployment changes, and live verification.
