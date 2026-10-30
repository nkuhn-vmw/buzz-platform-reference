# Architecture

This page describes the Cloud Foundry reference topology and its identity,
agent, and team-message paths. The diagrams show service boundaries and data
flow; they do not represent a live deployment or imply that an operator has
completed the deployment checklist.

## At a glance

![Buzz Cloud Foundry architecture](assets/architecture.svg)

The relay, identity adapter, and agent worker use separate PostgreSQL
services. Relay messages are durable in relay PostgreSQL. Relay objects use an
S3-compatible object store; Valkey (Redis protocol) supports cache, pub/sub,
and Redis-side Lua operations. Signing and service credentials are supplied
through CredHub-backed bindings. The worker's local files and model sessions
are ephemeral.

The relay obtains the identity adapter's public signing keys through an
internal JWKS route: a relay-side proxy connects to the identity app's mTLS
listener on port 8443. Each side validates the expected Cloud Foundry app GUID.
This protects the JWKS fetch path; the relay still verifies each signed
assertion under the configured issuer and audience rules.

The hosted agent flow is a CF Task running the Buzz ACP supervisor. Its custom
ACP adapter calls the native Tanzu Agent Buildpack chat API; the Buildpack
agent loop calls the explicitly bound model and MCP Gateway. The current
platform-agent configuration disables shell and filesystem access and binds a
scoped read-only tool. These controls apply to the separate Buildpack app. A
Credential Store binding can support outbound user SSO token forwarding when
an authenticated Buildpack user session exists, but the Buzz ACP-to-`/api/chat`
path does not establish that session. Per-user Credential Store delegation is
optional and is not implemented end to end.

## Human sign-in and relay identity

![Human OIDC sign-in and relay identity flow](assets/identity-flow.svg)

The desktop opens a system browser to the identity adapter. The adapter uses
the bound platform SSO service and OIDC authorization-code flow with PKCE,
state, and nonce. After the callback, it validates the verified email against
its exact operator allowlist and returns a short-lived, single-use code to the
desktop's loopback callback. The desktop exchanges that code for a local
session, stores the session in the OS credential store, and signs a NIP-98
request for a short-lived human NIP-FI assertion. The relay checks that
assertion against the identity adapter's JWKS.

The assertion identifies a Buzz public key already proven by the desktop. It
does not grant channel membership or replace the relay's own channel
authorization checks. SSO identity and Buzz key identity are bound by the
identity adapter; the relay remains responsible for event signatures and
channel access.

## Agent work and lifecycle

![Hosted agent runtime and task lifecycle](assets/agent-lifecycle.svg)

An owner-authorized identity binding supplies the agent key, owner key, grant,
and grant deadline to the CF Task. The task refuses expired grants, acquires a
dedicated PostgreSQL advisory lease for the agent, and starts the Buzz ACP
supervisor only while it holds that lease. Lease heartbeat loss or grant
expiry stops the child process; the task first requests graceful termination,
then kills the process group after its bounded grace period. The task releases
the lease only after the child exits.

The task strips its worker-database connection, full CF binding document, and
PostgreSQL connection variables from the ACP child's environment. The child
does receive the agent identity and grant material needed for relay
authentication. Environment filtering reduces accidental exposure; it is not a
security boundary between same-UID processes, which may inspect parent
`/proc` state. The CF app identity and trusted developers in its space are the
isolation boundary. Arbitrary code in a worker tool can exercise the worker's
app privileges. In the separate native Buildpack app, shell and filesystem
tools are disabled; its tools run with that app's own identity and bindings.

The task's working directory, files, and model session live only for that task
run. A restart can therefore lose local and model-session context. Relay events
and replies remain in the relay's PostgreSQL store. A thread-scoped ACP
session policy isolates conversation context by canonical thread; this setting
must be present in the deployed configuration before that isolation can be
claimed.

The worker implementation defines the advisory-lock and fail-stop mechanics.
The deployed task must bind the dedicated PostgreSQL service with a direct
connection. The diagram describes the intended public task contract; it is not
evidence of a verified live worker.

## Team and thread workflow

![Owner, teammate, channel, and agent workflow](assets/team-workflow.svg)

An agent remains owned by one person. The owner enrolls its key through SSO
and grants the identity service permission to issue short-lived assertions.
The owner invites that agent identity to a project channel. The ACP author gate
defaults to `owner-only`; selected teammates can be admitted by setting
`BUZZ_ACP_RESPOND_TO=allowlist` and listing their verified Buzz public-key hex
values in `BUZZ_ACP_RESPOND_TO_ALLOWLIST`. Each teammate must also be a member
of the channel. A mention selects the named agent but grants neither channel
membership nor new tools. Other agents do not answer automatically.

For conversations, a top-level agent mention starts a thread. A mention or
reply inside an existing thread is routed back to that canonical thread. Set
`BUZZ_ACP_SESSION_POLICY=thread` to give each channel thread isolated model
context; without it, Buzz ACP's default is a shared provider session per
channel. Direct messages remain conversation-scoped.

## Status and configuration boundaries

| Area | What the source supports | What still needs verification |
| --- | --- | --- |
| Relay | PostgreSQL event store, S3-compatible object storage, Valkey-compatible Redis, CredHub-backed secrets | Rendered bindings, routes, and service policy in the target space |
| Identity | OIDC login, scoped agent grants, signed NIP-FI assertions, dedicated PostgreSQL state | Real SSO, allow/deny behavior, key rotation, and mTLS JWKS on the target deployment |
| Agent | CF Task, per-agent lease target, grant deadline, stop-on-lease-loss, native Buildpack ACP adapter | Worker database binding, task lifecycle, duplicate-task refusal, recovery, and live tool policy |
| Desktop | Local OIDC browser handoff and OS credential-store session handling | Signed/notarized distribution and a sanitized end-user onboarding run |
| Credential Store | Optional native Buildpack support for outbound SSO credential forwarding | Per-user delegation through the Buzz ACP runtime is not implemented end to end |

No private route, account identifier, app GUID, key, token, or credential is
part of these diagrams. Operators render those values from their own
deployment configuration.

## Mermaid source

The following source blocks mirror the SVG diagrams and are kept here for
review and future edits.

### Platform components

```mermaid
flowchart LR
  Desktop[Local Buzz desktop]
  IdP[Platform OIDC SSO]
  Identity[Identity adapter<br/>OIDC, grants, NIP-FI issuer]
  Relay[Buzz relay<br/>WebSocket + HTTP]
  Worker[CF Task<br/>Buzz ACP supervisor]
  ACP[Custom ACP bridge]
  Buildpack[Tanzu Agent Buildpack<br/>/api/chat]
  Model[Tanzu AI Services<br/>selected model]
  Gateway[MCP Gateway<br/>scoped read-only tool]
  CredStore[Optional Credential Store<br/>per-user path not end-to-end]
  RelayDB[(Relay PostgreSQL<br/>durable messages)]
  Objects[(S3-compatible objects)]
  Valkey[(Valkey / Redis<br/>pub-sub, cache, Lua ops)]
  IdentityDB[(Identity PostgreSQL)]
  WorkerDB[(Dedicated worker PostgreSQL<br/>per-agent advisory lease)]
  Secrets[CredHub-backed bindings]

  Desktop -->|browser OIDC + local code handoff| Identity
  IdP <-->|authorization redirect / callback| Identity
  Desktop -->|NIP-FI assertion + signed events| Relay
  Relay <-->|JWKS over internal mTLS<br/>CF app GUID pin, listener :8443| Identity
  Worker <-->|agent assertion + signed events| Relay
  Worker -->|ACP stdio · agent key + grant| ACP -->|HTTP chat stream| Buildpack
  Buildpack --> Model
  Buildpack --> Gateway -->|read-only| Tool[Approved platform tool]
  CredStore -. optional; not end-to-end .-> Gateway
  Relay --> RelayDB
  Relay --> Objects
  Relay --> Valkey
  Identity --> IdentityDB
  Worker --> WorkerDB
  Identity -. secrets .-> Secrets
  Relay -. secrets .-> Secrets
  Worker -. identity binding .-> Secrets
```

### Human sign-in

```mermaid
sequenceDiagram
  actor Human
  participant Desktop as Local Buzz desktop
  participant Identity as Identity OIDC adapter
  participant SSO as Platform SSO
  participant IdentityDB as Identity PostgreSQL
  participant Relay as Buzz relay

  Human->>Desktop: Start platform sign-in
  Desktop->>Desktop: Bind loopback callback; create state and PKCE handoff challenge
  Desktop->>Identity: Open /v1/login/start with callback and S256 challenge
  Identity->>IdentityDB: Store one-time browser flow
  Identity-->>SSO: Redirect using OIDC state, nonce, and PKCE
  Human->>SSO: Authenticate
  SSO-->>Identity: OIDC authorization callback
  Identity->>Identity: Verify OIDC claims and exact email allowlist
  Identity->>IdentityDB: Store single-use handoff code
  Identity-->>Desktop: Redirect to loopback callback with code
  Desktop->>Identity: Exchange code and handoff secret
  Identity->>IdentityDB: Consume code; create bounded session
  Identity-->>Desktop: Session token and expiry
  Desktop->>Identity: NIP-98 proof for human key assertion
  Identity-->>Desktop: Short-lived NIP-FI assertion
  Desktop->>Relay: Present assertion; sign relay events as Buzz key
  Relay->>Identity: Fetch JWKS via pinned internal mTLS app identity
  Relay->>Relay: Verify issuer, audience, key, and signature
```

### Agent lifecycle

```mermaid
stateDiagram-v2
  [*] --> ValidateGrant
  ValidateGrant --> Refused: Missing or expired grant
  ValidateGrant --> AcquireLease: Active owner-approved grant
  AcquireLease --> Refused: Agent lease already held
  AcquireLease --> Running: Per-agent advisory lease acquired
  Running --> Running: Relay event / ACP turn
  Running --> Stopping: Grant deadline reached
  Running --> Stopping: PostgreSQL lease heartbeat fails
  Running --> Stopping: CF task termination
  Stopping --> ForceStop: Child exceeds 2-second grace
  Stopping --> ReleaseLease: Child exits
  ForceStop --> ReleaseLease: Process group killed
  ReleaseLease --> EphemeralGone: Local files and model session discarded
  EphemeralGone --> [*]
  Running --> DurableRelay: Messages and replies persist in relay PostgreSQL
  DurableRelay --> Running
```

### Team channel and thread

```mermaid
flowchart LR
  Owner[Agent owner] -->|SSO enrollment + grant| Identity[Identity adapter]
  Identity -->|short-lived agent assertions| Agent[Agent identity / CF Task]
  Owner -->|invite identity| Channel[Project channel]
  Teammate[Selected teammate] -->|member of channel| Channel
  Agent -->|invited member| Channel
  Teammate -->|explicit @agent in thread| Gate[ACP author gate]
  Gate -->|default owner-only: blocked| Denied[No model turn]
  Owner -->|configure allowlist with verified public keys| Allow[Owner-only allowlist]
  Allow -->|approved teammate key| Gate
  Channel -->|agent + teammate are members| Gate
  Gate -->|allowed author + membership| Mention[One named agent selected]
  Mention -->|one named agent selected| Agent
  Agent -->|reply to canonical thread| Thread[Source thread]
  Policy[Session policy: thread] -->|isolated context per thread| Agent
```

## Source references

- Relay service binding resolution: [`apps/relay/bindings.mjs`](../apps/relay/bindings.mjs)
- OIDC session, human assertion, and agent grant handlers: [`apps/identity/src/server.mjs`](../apps/identity/src/server.mjs)
- Internal JWKS mTLS endpoints: [`server.mjs`](../integrations/cf-mtls/server.mjs), [`proxy.mjs`](../integrations/cf-mtls/proxy.mjs)
- Worker launcher, lease supervisor, and advisory lock: [`launch.mjs`](../apps/agent/launch.mjs), [`worker.mjs`](../apps/agent/worker.mjs), [`lease.mjs`](../apps/agent/lease.mjs), [`lease-config.mjs`](../apps/agent/lease-config.mjs)
- Buildpack ACP bridge: [`buildpack-acp.js`](../integrations/agent/buildpack-acp.js)
- Read-only MCP tool example: [`apps/pilot-mcp/server.mjs`](../apps/pilot-mcp/server.mjs)
