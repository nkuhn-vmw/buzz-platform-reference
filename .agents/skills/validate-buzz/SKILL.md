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
4. Keep current private-pilot evidence distinct: operator/desktop SSO, persisted channel message, and native ACP/model/Gateway nonce probe have passed. The TLS-enabled PostgreSQL plan is approved/applied and the fresh worker database provisioned, but binding, staging, and TLS connectivity checks remain; do not claim hosted-agent or lease checks passed before then.
5. Use a sanitized demo community to check sign-in allow/deny, two-user channel messaging, explicit agent mention, owner-only and configured allowlist behavior, channel denial, source-thread reply placement, and separate context across two threads.
6. Check duplicate task exclusion, lease loss termination, grant expiry/revocation, restart behavior, and persistence of relay messages versus ephemeral local/model state.
7. Record revision, target alias, date, operator, scenario, result, and sanitized evidence reference using the template in `docs/tmm-validation.md`.

## Guardrails

- A passing `probe` is evidence for its model and read-only MCP path only. It does not prove multi-human authorization, production readiness, or all worker lifecycle cases.
- Do not use real user content or place keys, public-key lists, grant material, service credentials, or raw logs in public evidence.
- Do not mark scenarios passed without observing the actual result. Keep unavailable multi-human tests marked `not run` and name the missing test account or environment capability.

## Completion

Summarize each tested scenario and its evidence. Leave unrun checks visible and do not infer live acceptance from local tests or source inspection.
