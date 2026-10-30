# Deployment validation

## Evidence status

As of 2026-10-30, the private pilot has verified owner-authorized agent turns in both configured Buzz worker runtimes. This is pilot evidence, not full acceptance, production readiness, or evidence that a public service is available.

| Check | Result and evidence |
| --- | --- |
| Infrastructure and worker TLS | The helper CF Task connected to its dedicated worker PostgreSQL service using TLS 1.3; the task reported `certificateVerified=true`. This validates the worker DB path only. The existing relay and identity PostgreSQL instances were left unchanged and are not claimed TLS-verified. |
| Human sign-in and channel | Operator and desktop SSO succeeded. A private project channel was created and a human message persisted through the relay. |
| Tanzu Helper turn | An owner-signed Buzz event traversed relay → Helper worker → native Agent Buildpack → model → read-only `read_pilot_document` tool through MCP Gateway. The worker returned a signed reply in the exact source-thread root; its nonce matched the backend log. |
| Built-in Researcher turn | An owner-signed event traversed relay → Researcher worker → Buzz built-in runtime → model → the same read-only Gateway tool and returned a signed source-thread reply. The latest reply contained the requested title and tool nonce without the earlier false messaging warning. The built-in runtime used the scoped ACP auto-publisher. |
| Duplicate-task exclusion | Starting a second Helper task while the first held its lease failed with exit code 1 and `Another task already owns this agent`. The first task remained the active owner. |
| Restart and thread history | Controlled Helper restart/reactivation succeeded. Earlier relay messages and replies persisted; the restarted agent recalled the exact prior nonce from the existing thread without another tool call. A fresh top-level Helper thread returned `NEW_THREAD` instead of the prior thread's nonce. |
| Lease-loss shutdown | Linux TLS fixture and CI cover PostgreSQL lease loss and child process-group termination. This is fixture/CI evidence, separate from the live duplicate-task check. |
| CI and review | [GitHub Actions](https://github.com/nkuhn-vmw/buzz-platform-reference/actions/runs/41135154735) passed all 8 jobs for commit `ac7f818`, including the corrected identity PostgreSQL integration fixture. Gitleaks found no secrets in the reviewed two-commit history. Independent review by Claude Opus 5.5 (`claude-opus-5-5`) identified two implementation blockers, now fixed: exact created-task GUID tracking (verified by live reactivation) and exact patched-source verification (verified with build fixtures). This row records that implementation revision; the workflow badge reports the latest revision. |

## Remaining validation

- A two-human allowlist scenario has not run because a second authorized account was unavailable. Owner-only behavior is the deployed default; successful teammate allowlist behavior remains unverified live.
- The grant-expiry timer was not exercised in a live task. Grant-deadline validation and identity-revocation integration are covered separately, but those do not prove timer behavior in a running CF Task.
- The final desktop screenshot showing a live agent conversation is not captured yet because the desktop test workstation is unavailable. Desktop SSO, channel creation, and human message persistence were verified; the desktop build remains unsigned and signed/notarized distribution is unverified.
- Relay and identity PostgreSQL TLS was not checked or changed as part of worker TLS validation.
- Credential Store per-user delegation through the Buzz ACP-to-`/api/chat` path is not implemented end to end.
- OpenCode remains a bounded extension proposal; no Buzz OpenCode runtime is implemented or verified.

These results do not amount to whole-pilot acceptance. Keep unrun scenarios visible and do not convert source, fixture, or CI evidence into claims of live behavior.

## Focused deployment checks

For the native model/Gateway path, the repository probe is:

```sh
node scripts/deploy.mjs probe
```

It checks the ACP/model/read-only tool path. It does not replace the multi-user allowlist, grant-expiry timer, task restart, thread, signed desktop distribution, or service-specific TLS checks described above.

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
