# Deployment validation

## Evidence status

As of 2026-10-31, the private pilot has verified owner-authorized turns in both
Buzz worker runtimes, a two-user shared-agent rehearsal, and the separate native
Credential Store A/B exercise. This is controlled pilot evidence. Signed
attendee distribution remains pending; no production readiness or public hosted
service is claimed.

| Check | Result and evidence |
| --- | --- |
| Infrastructure and worker TLS | The helper CF Task connected to its dedicated worker PostgreSQL service using TLS 1.3; the task reported `certificateVerified=true`. This validates the worker DB path only. The existing relay and identity PostgreSQL instances were left unchanged and are not claimed TLS-verified. |
| Human sign-in and channel | Operator and desktop SSO succeeded and were renewed on October 31. A private project channel was created and a human message persisted through the relay. |
| Desktop conversation | Real desktop mentions invoked both Platform Helper and Buzz Researcher. Each source-thread reply included a tool nonce matching the backend log. Owner-signed directory registration made both configured names selectable. Authentic [mention, thread, and roster captures](getting-started.md#choose-an-agent-by-name) are included. |
| Two real users and channel isolation | A and B completed independent SSO with distinct subjects and Buzz keys. B was admitted as an ordinary member. Signed HTTP clients verified B could post in a shared private channel and A could read that post. A could read a known fixture in an owner-only private channel; B's exact-event query returned HTTP 200 with no events. B's write returned HTTP 400, `restricted: not a channel member`, and was not persisted. This proves server behavior, not a second desktop's UX. |
| Owner-only author gate | In the shared synthetic channel, Platform Helper answered A with source-thread replies whose tool nonces matched backend logs. B could read those shared replies. B's invocation was explicitly dropped by the worker's `owner-only` author gate with the verified B key and channel; no reply was attached to B's request. Channel visibility and permission to invoke an agent are separate controls. |
| Shared-agent allowlist | The separately approved Workshop Helper has its own owner-scoped grant and an owner-signed directory policy admitting only the owner and B's verified key. A began a thread; B followed up and received an agent-authored reply at that same root, recalling the synthetic marker. Both tool nonces matched backend logs. The actual operator desktop then selected Workshop Helper from mention autocomplete and received a further reply retaining the marker. See the [authentic desktop capture](getting-started.md#two-people-sharing-one-agent). Existing agents remained owner-only. |
| B's separate topic | B started a new top-level Workshop Helper thread without the earlier marker. Its signed source-thread response was `NEW_THREAD`. This checks the configured thread context, not an authorization barrier against other channel-visible messages. |
| Participant logout | B's authenticated read succeeded, logout returned HTTP 204, and the revoked session's fresh identity-assertion request returned HTTP 401. A's session remained valid. B then completed normal SSO renewal. Already-issued assertions can remain valid for five minutes; immediate disconnection was not claimed. |
| Tanzu Helper turn | An owner-signed Buzz event traversed relay → Helper worker → native Agent Buildpack → model → read-only `read_pilot_document` tool through MCP Gateway. The worker returned a signed reply in the exact source-thread root; its nonce matched the backend log. |
| Built-in Researcher turn | An owner-signed event traversed relay → Researcher worker → Buzz built-in runtime → model → the same read-only Gateway tool and returned a signed source-thread reply. The latest reply contained the requested title and tool nonce without the earlier false messaging warning. The built-in runtime used the scoped ACP auto-publisher. |
| Duplicate-task exclusion | Starting a second Helper task while the first held its lease failed with exit code 1 and `Another task already owns this agent`. The first task remained the active owner. |
| Restart and thread history | Controlled Helper restart/reactivation succeeded. Earlier relay messages and replies persisted; the restarted agent recalled the exact prior nonce from the existing thread without another tool call. A fresh top-level Helper thread returned `NEW_THREAD` instead of the prior thread's nonce. |
| Lease-loss shutdown | Linux TLS fixture and CI cover PostgreSQL lease loss and child process-group termination. This is fixture/CI evidence, separate from the live duplicate-task check. |
| Configured worker deadline | An isolated NDC CF Task verified that its deployed `worker.mjs`, `lease.mjs`, and `lease-config.mjs` hashes matched the reference source. With a dedicated test lease and synthetic child/grandchild that ignored SIGTERM, the worker terminated the whole group at its configured deadline and allowed lease reacquisition. The task succeeded on October 31; the test required shutdown within 1.5 seconds of the deadline. No real agent identity, grant, relay message, or directory policy was created. |
| CI and review | [GitHub Actions](https://github.com/nkuhn-vmw/buzz-platform-reference/actions/runs/41136076552) passed all 8 jobs for commit `29d3bdd`, including the corrected identity PostgreSQL integration fixture. Gitleaks found no secrets in the reviewed source history. Independent review by Claude Opus 5.5 (`claude-opus-5-5`) identified two implementation blockers, now fixed: exact created-task GUID tracking (verified by live reactivation) and exact patched-source verification (verified with build fixtures). The final profile/directory registration changes also received independent `claude-opus-5-5` review with no blockers. The final activation command passed live. This row records an earlier CI revision; the workflow badge reports the latest revision. |

The optional [native Credential Store companion](credential-companion.md) was deployed separately on October 31 using Agent Buildpack 0.2.53 / runtime 0.19.0 and OAuth2 Proxy 7.15.5. Its backend passed real HTTP/MCP A/B token checks locally; both CF apps reached 1/1 readiness. Live anonymous requests to chat, authentication status and agent discovery redirected to SSO; `/health` returned 200. Socket inspection confirmed the native process listens on `127.0.0.1:8091`. The Gateway binding succeeded and its broker created the specific container TLS network policy. The agent has only model, SSO, Store and MCP descriptor bindings; backend keys are absent. The Gateway root `/mcp` returned 404; the app-specific `/buzz-workshop-receipts/mcp` returned 401 with OIDC metadata and is configured.

Both real participants authenticated through independent foundation CF SSO sessions and through the companion's gate and native App SSO. The two displayed browser identities matched for each participant. After explicitly approved SpaceAuditor/OrgUser grants, each used their own foundation bearer token to manage their own Store entry. No administrator-owned entry was relabeled as a user entry. The standalone Store UI's UAA-host callback remains rejected; the normal foundation login-host passcode flow and management API worked.

| Native credential phase | Live evidence on October 31 |
| --- | --- |
| A configured, B absent | A's native tool result returned label A and nonce `01fb3d3b-f2bf-4c0b-9ed5-9a6e4782f830`, matched in the protected backend log at 18:32 UTC. |
| B attempts without a credential | The native UI showed an error. Store logs at 18:34 UTC identified B's distinct App SSO subject and `outcome=not_found` for this resource. No B receipt reached the backend, and A's usage count remained unchanged. The causal Store result, not the generic UI error, establishes this denial. |
| Both credentials saved | Each user's own management request returned HTTP 201 with `userConfigured=true` and `storeConfigured=false`. B's real native tool returned B with nonce `5c18f084-2cb1-4275-814e-73d320aea1c1`; A still returned A with `d557e5de-40f5-4814-b870-a2e28c21c927`. Both matched backend logs. |
| A deletes its entry; B unaffected | A's own DELETE returned HTTP 204 at 19:05:52 UTC. The next actual tool call was denied with A's Store `outcome=not_found` about nine seconds later; a new conversation also failed. B still received B with nonce `c1836878-b6e7-47f8-ace7-4592ddc39a3d`, matched in the backend. Nine seconds is the observed request interval, not a measured cache lifetime. |
| Management boundary and restoration | A's metadata showed no own credential after deletion while B's entry and usage remained intact. No store-scoped fallback existed. Both SpaceAuditor accounts received HTTP 403 reading the backend's credential-bearing CF app environment. A's disposable entry was then restored through A's own session; a fresh native receipt A with nonce `25d5e764-7f7a-4032-8fae-e38ee76ced07` matched the backend. |

The deployed Store resolves across issuers by email with origin matching disabled. These results do **not** establish issuer/subject isolation. Both users' bearer-authenticated debug-list requests returned 401; separately, the deployed settings resolved `debug_endpoints_enabled=False`. No debug configuration was changed. Native companion code at `9a919309` received independent `claude-opus-5-5` review; [all nine PR CI jobs passed](https://github.com/nkuhn-vmw/buzz-platform-reference/actions/runs/41229093968). The exported public source scan found no secrets. The synthetic A/B credential exercise passed within this documented identity mapping; OAuth refresh/expiry and production trust policy are outside that result.

The participant management helper was also exercised live: it refused a wrong
account before making service requests, inspected A's entry, deleted and restored
that entry using A's own session, and left B's entry and usage unchanged. Its
focused regression checks refusal of a mismatched CF target or account without
printing the access token. This is management-path evidence; the native tool
sequence above separately establishes credential use.

SpaceAuditor can read logs, events, and app status/settings across the synthetic
space. The HTTP 403 environment check above does not establish log isolation.
Keep that space's content and logs appropriate for all approved participants.

## Remaining validation

- The second user's Buzz checks used an independently authenticated signed HTTP client. A second desktop installation and UX are unverified.
- The live worker deadline check used a configured test deadline and synthetic child processes. It did not exercise an issuer-expired grant in an actual Buzz conversation. Identity grant revocation is covered separately by integration tests.
- The desktop build remains unsigned; signed/notarized distribution is unverified.
- Relay and identity PostgreSQL TLS was not checked or changed as part of worker TLS validation.
- Credential Store per-user delegation through the Buzz ACP-to-`/api/chat` path is not implemented end to end.
- OpenCode remains a bounded extension proposal; no Buzz OpenCode runtime is implemented or verified.

These results support a controlled facilitator rehearsal. Broad attendee rollout
still requires signed distribution and its own installation check. Keep the
listed production and extension limits visible; do not convert source,
fixture, or CI evidence into claims of live behavior.

The [workshop rehearsal guide](workshop.md) defines the two-person success/denial checks and separate Credential Store acceptance criteria. Its procedure is not a live test result.

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

Do not record user email addresses, full identity keys, access tokens, grant material, service credentials, or private conversation content. The published screenshots contain only the synthetic workshop conversation and abbreviated display labels.
