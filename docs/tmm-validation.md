# Deployment validation

## Evidence status

This repository describes a pilot deployment. As of 2026-10-30, a private pilot has the identity, relay, read-only MCP service, and native Tanzu Agent Buildpack deployed. Operator SSO and desktop platform SSO succeeded; a private project channel was created and a message persisted; the native ACP → model → Gateway tool probe returned its expected nonce. These results verify those paths in that pilot only.

The TLS-enabled PostgreSQL plan has been approved and applied, and the fresh worker database has been provisioned. Its binding, app staging, and TLS connectivity checks are still pending, so the worker is not running yet. Worker activation, lease behavior, and end-to-end hosted agent turns are therefore not verified live. A second authorized human account was not available for allowlist workshop validation. Do not infer full deployment acceptance from the passing paths above.

| Check | Current private-pilot evidence | Acceptance evidence to record |
| --- | --- | --- |
| Service plan and deployment configuration | Identity, relay, read-only MCP, and native platform agent are deployed; TLS-enabled worker PostgreSQL plan is approved/applied and fresh worker DB is provisioned. | Verify service readiness, expected plan, TLS certificate chain, direct connection, and correct worker binding in the configured space. |
| Sign-in and identity | Operator SSO succeeded in the private pilot. | Also verify a non-allowlisted account is denied and no tokens appear in logs. |
| Desktop relay flow | Desktop platform SSO succeeded; a private project channel was created and a message persisted. | Signed client distributed through the organization's route; second user exchanges messages in a shared channel. |
| Agent model/tool path | Native ACP → model → Gateway read-only tool probe passed with the expected nonce. Worker DB binding, app staging, and TLS connectivity checks are pending. | Activate the worker, then verify explicit mention and source-thread reply. Verify unapproved authors and channel-inaccessible events cannot reach or publish from the agent. |
| Thread separation | Activation manifest configures thread-scoped sessions; live hosted agent turn not yet available. | Two active threads maintain separate model context and replies stay in their source threads. |
| Lease and lifecycle | Worker source implements a per-agent PostgreSQL lease; TLS-enabled plan is applied and fresh DB provisioned, but binding and connectivity are not verified. | After the worker database is bound and connected: exclude duplicate task; verify lease-loss shutdown, grant expiry/revocation, restart, ephemeral local/model state, and durable relay messages. |
| Team-sharing policy | Default author policy is owner-only; explicit public-key allowlist is configurable. Multi-human allowlist test has not run. | Owner succeeds; explicitly allowlisted teammate succeeds only in a channel where the agent is a member; unlisted teammate is rejected. |

These are private pilot results, not a public deployment receipt. Add revision, date, sanitized result, and operator details to the appropriate release record; do not store secrets or raw personal data in the public repository.

## Focused deployment checks

After configuring and deploying the target, the supported probes are:

```sh
node scripts/provision.mjs --plan
node scripts/deploy.mjs probe
node scripts/deploy.mjs status
```

The probe checks the configured native agent/model/Gateway tool path. It does not substitute for the multi-user, thread, denial, lease-loss, expiry, restart, or signed desktop checks above. Use a separate workshop record for those end-to-end scenarios.

## Workshop record template

Record only non-sensitive evidence:

```text
revision:
target alias:
date:
operator:
scenario:
result: pass | fail | not run
sanitized evidence reference:
follow-up owner:
```

Do not record user email addresses, public keys, access tokens, grant material, service credentials, or raw conversation content.
