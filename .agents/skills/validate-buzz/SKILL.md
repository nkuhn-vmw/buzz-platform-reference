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
4. Match existing evidence in `docs/tmm-validation.md` to the revision, deployment, and boundary under review. Reuse valid results; repeat a scenario when code/configuration changes, a failure, or a specific unresolved risk requires it. Do not treat the guide's private-pilot results as proof for another deployment.
5. For a two-user rehearsal, use `docs/workshop.md`: independent real SSO identities and keys, allowed shared-thread turns, explicit owner-only rejection, known-event private-channel filtering/write denial, and logout. Keep a signed HTTP client's server evidence distinct from a second desktop UX.
6. Keep fixture/CI evidence for lease loss and process-group shutdown distinct from live CF task evidence; verify relay-message durability versus ephemeral provider session and files.
7. Record revision, target alias, date, operator, scenario, result, and sanitized evidence reference using the template in `docs/tmm-validation.md`.

## Guardrails

- A passing `probe` is evidence for its model and read-only MCP path only. It does not prove multi-human authorization, production readiness, or all worker lifecycle cases.
- Native Credential Store acceptance follows `docs/credential-companion.md`, separately from Buzz. Match actual A/B tool nonces to backend logs; establish a successful control before counting denial. Require the intended user's missing-credential cause, exclude shared fallback, and verify deleting A leaves B working. Report the actual cross-issuer resolution tier; email matching is not subject isolation.
- Do not use real user content or place keys, public-key lists, grant material, service credentials, or raw logs in public evidence.
- Do not mark scenarios passed without observing the actual result. Keep unavailable multi-human tests marked `not run` and name the missing test account or environment capability.

## Completion

Summarize each tested scenario and its evidence. Leave unrun checks visible and do not infer live acceptance from local tests or source inspection.
