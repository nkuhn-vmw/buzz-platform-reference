---
name: validate-buzz
description: Validate a Buzz Cloud Foundry deployment against the repository's user, identity, tool, thread, and worker-lifecycle acceptance checks.
---

# Validate Buzz

Read `docs/tmm-validation.md` and `docs/architecture.md` first. Keep source tests, deployment probes, and live multi-user acceptance evidence distinct.

## Workflow

1. Verify the configured target with `node scripts/cf.mjs --verify-target`.
2. Review expected and actual service plans with `node scripts/provision.mjs --plan`.
3. Run `node scripts/deploy.mjs probe` and `node scripts/deploy.mjs status`.
4. Current private-pilot evidence includes operator/desktop SSO, persisted channel messages, Helper/Tanzu and Researcher/built-in owner-authorized tool turns with signed source-thread replies, TLS 1.3 certificate verification on the Helper worker DB, duplicate-task refusal, and controlled restart/context recovery. See the validation guide for exact limits.
5. Validate remaining cases with a sanitized demo community: two-human allowlist allow/deny, channel denial, live grant-expiry timing, signed/notarized desktop distribution, final UI capture, and TLS status of relay/identity databases.
6. Keep fixture/CI evidence for lease loss and process-group shutdown distinct from live CF task evidence; verify relay-message durability versus ephemeral provider session and files.
7. Record revision, target alias, date, operator, scenario, result, and sanitized evidence reference using the template in `docs/tmm-validation.md`.

## Guardrails

- A passing `probe` is evidence for its model and read-only MCP path only. It does not prove multi-human authorization, production readiness, or all worker lifecycle cases.
- Do not use real user content or place keys, public-key lists, grant material, service credentials, or raw logs in public evidence.
- Do not mark scenarios passed without observing the actual result. Keep unavailable multi-human tests marked `not run` and name the missing test account or environment capability.

## Completion

Summarize each tested scenario and its evidence. Leave unrun checks visible and do not infer live acceptance from local tests or source inspection.
