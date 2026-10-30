---
name: deploy-buzz
description: Deploy this Buzz reference to its operator-configured Cloud Foundry space. Use when provisioning services, packaging components, or deploying identity, relay, MCP, native agent, or worker apps.
---

# Deploy Buzz

Use the repository scripts and the configured isolated CF target. Read `docs/install.md`, `config/deployment.example.json`, and the applicable script before changing deployment state.

## Workflow

1. Confirm Node 24, CF CLI 8, required local packaging tools, and an operator-approved target/service plan.
2. Copy the example config to ignored `.state/deployment.json`; do not read aloud, copy, or commit credentials or generated state.
3. Run `scripts/cf-login.sh`, then `node scripts/cf.mjs --verify-target`.
4. Review `node scripts/provision.mjs --plan`. Only apply when its target and plan inventory match the intended space: `node scripts/provision.mjs --apply --wait`.
5. Build/package the pinned Linux/amd64 worker with `scripts/build-agent.sh`, package relay and identity, and (on macOS) build desktop using the commands in `docs/install.md`.
6. Run `node scripts/deploy.mjs prepare-apps`, then the documented deploy steps in dependency order. Inspect generated manifests locally before pushing.
7. Run `node scripts/login.mjs`, enroll with `node apps/identity/tools/enroll-agent.mjs --agent NAME`, admit the shared owner once per relay with `node scripts/deploy.mjs admit-owner`, then activate with `node scripts/activate-agent.mjs --agent NAME`. Keep per-agent config in ignored `.state/deployment.json`; require a worker PostgreSQL service with verified TLS.
8. Run `node scripts/deploy.mjs probe` and `node scripts/deploy.mjs status`; report exactly what was and was not verified.

## Safety and recovery

- Never change the CF API/org/space through ad hoc `cf target` or login commands; use `scripts/cf-login.sh` and the `scripts/cf.mjs` wrapper.
- Do not rerun a failed broker create or start a duplicate worker until inspecting current service/task state.
- Keep `.state/`, `.credentials/`, generated bindings, manifests, logs, and binaries out of commits and user-facing output.
- If target verification fails, stop before provisioning or deploying. Ask the operator to correct the local configuration and rerun the plan.

## Completion

Deployment completion means the scripts returned successfully. Do not describe the deployment as accepted or live until the end-to-end checks in `docs/tmm-validation.md` have recorded evidence.
