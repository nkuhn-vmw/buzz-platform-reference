# Agent runtimes

This page distinguishes the candidate's tested integration from runtime
options that remain proposals. The candidate is a reference under development;
its source does not establish a public or production deployment.

## Current integration: Tanzu Agent Buildpack

The tested flow is:

```text
Buzz relay event
  -> Buzz ACP supervisor and custom ACP adapter
  -> Tanzu Agent Buildpack /api/chat
  -> bound Tanzu AI model and MCP Gateway tools
  -> assistant text returned over ACP
  -> Buzz publishes to the admitted source channel/thread
```

The adapter sends the prompt transcript to the Buildpack chat endpoint, streams
assistant text and tool progress as ACP updates, and leaves actual model tool
execution to the Buildpack's agent loop. The candidate's platform-agent
manifest disables shell access and filesystem access. MCP tool availability is
determined by the Gateway servers bound to the platform agent. The custom ACP
bridge does not establish an authenticated Buildpack browser session; its
`/api/chat` call does not forward the Buzz grant or identity assertion as an
SSO identity. Do not claim per-user Credential Store delegation on this path.
The native Buildpack app's configured tool restrictions and app identity are
its security boundary; verify deployed bindings and effective server
configuration.

Model selection is explicit. The launcher resolves a named `ai-models` service
binding and model ID; it fails when the binding is missing/ambiguous or the
model ID is absent. The model must support tool calls for the Gateway-enabled
path. The included candidate manifest pins example values for a specific
deployment and must be rendered from operator configuration before reuse.

## Identity and permissions

The hosted worker runs as a CF Task. Its agent key and owner-approved grant are
supplied through the identity service binding; the grant is scoped to the agent
key and relay URL and expires with the authenticated owner session. The owner
grant permits the identity service to issue short-lived agent assertions. It
does not grant channel membership, tool access, SSO access to the Buildpack, or
the owner's human roles.

The launcher passes the agent key and grant material to the Buzz ACP child so
it can authenticate to the relay. It strips the worker database configuration
and full CF binding document from the child's environment as minimization,
not as a security boundary: same-UID processes can inspect parent `/proc` state.
The CF app identity and trusted space developers are the isolation boundary;
arbitrary code running in a worker tool can use that app's privileges.

The agent's Buzz relay identity, channel membership, Buildpack tool loop, model
binding, and Gateway credential are separate permission boundaries:

| Boundary | Controls |
| --- | --- |
| Buzz identity | Which agent key the owner authorizes and for how long |
| Relay/channel | Which admitted messages the agent can read and where it can post |
| Model service | Which configured model the runtime may call |
| MCP Gateway | Which tools and scoped service credentials the model loop can use |
| CF task | Which application bindings and process lifetime are available |

Do not place private keys, owner grant tokens, or Gateway bearer credentials in
source, public manifests, screenshots, model prompts, or logs. Use platform
service bindings and secret management. The public candidate intentionally
does not include private lab routes, account identifiers, or environment
credentials.

## Worker state and deployment status

The intended public worker model is a CF Task with an exclusive lease in a
dedicated PostgreSQL worker database. The relay's PostgreSQL event store is the
authoritative record of messages and replies. Local workspace files and model
session state are ephemeral; a task restart may begin a fresh model session.
The worker must stop when it loses its lease, and duplicate tasks must not
process the same agent concurrently.

That PostgreSQL-lease design is the deployment target described in the
implementation plan. The earlier object-storage implementation is not a public
prerequisite. The deployed task must bind the dedicated PostgreSQL service and
use a direct connection for advisory locks. Do not describe the lease,
restart behavior, or public runtime as deployed or live until an isolated
deployment has verified those behaviors.

## Built-in Buzz runtime

The Buzz built-in runtime is an alternative path in the worker launcher. It
starts `buzz-agent`, resolves the same explicit Tanzu model binding, and uses a
task-local MCP bridge to the bound HTTPS Gateway endpoint. Buzz's native tools
publish through the Buzz CLI. The launcher clears the Tanzu adapter's
auto-publish flag in this mode so the two publishing paths cannot overlap.

This alternative is present in candidate code, but the documented flow is not
a general public installer or a verified live service. It needs the same owner
grant, channel authorization, service-binding review, and task-lifecycle
validation as the Buildpack path.

## OpenCode buildpack: bounded pilot proposal

OpenCode documents two relevant interfaces: `opencode acp` is an ACP
JSON-RPC subprocess over stdio, and `opencode serve` exposes an HTTP API for
headless clients. The local OpenCode buildpack packages OpenCode as a CF app
and supports configured model providers, tools, and MCP servers. None of this
means Buzz currently supports OpenCode as a hosted runtime.

The smallest useful pilot is to keep the Buzz ACP supervisor as the owner of
relay identity, event admission, channel/thread routing, and message
publication, then launch a pinned OpenCode executable through its ACP stdio
interface as the agent child. Add a small Buzz-owned launch adapter only if
OpenCode's expected provider/MCP configuration cannot be supplied through the
existing CF bindings. Start with one tool-capable model and one read-only
Gateway tool. Disable OpenCode shell and file-write tools for that pilot; prove
which ACP permissions and tools the host actually mediates before enabling
write access.

Keep OpenCode inside the same CF Task lifetime/lease boundary as the Buzz
worker. Do not expose `opencode serve` as a user-attributed Buzz endpoint in the
first pilot: that creates a separate HTTP session and authentication surface
that the current Buzz event adapter does not bind to a specific owner or
thread. The ACP path fits the existing subprocess contract and avoids creating
that separate remote control plane.

Before calling the pilot implemented, verify one addressed thread end to end,
owner grant expiry/revocation, channel denial, tool allow/deny behavior,
session isolation across two threads, cancellation, output bounds, and task
lease loss. The pilot is a recommendation only; this repository does not
change or release the OpenCode buildpack.

## References

- Candidate adapters: [`buildpack-acp.js`](../integrations/agent/buildpack-acp.js), [`bindings.js`](../integrations/agent/bindings.js), [`mcp-http-stdio.js`](../integrations/agent/mcp-http-stdio.js)
- Candidate launcher and task worker: [`apps/agent/launch.mjs`](../apps/agent/launch.mjs), [`apps/agent/worker.mjs`](../apps/agent/worker.mjs)
- OpenCode [ACP documentation](https://opencode.ai/docs/acp/), [server documentation](https://opencode.ai/docs/server/), [configuration](https://opencode.ai/docs/config/)
- The local OpenCode Buildpack README and configuration reference informed the packaging assessment. Its availability is separate from the OpenCode ACP/server interfaces above; this candidate does not depend on it.
