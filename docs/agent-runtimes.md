# Agent runtimes

This page distinguishes the private pilot's verified Helper and Researcher
runtime turns from lifecycle checks and runtime alternatives that remain
unverified or proposed. A private pilot deployment is not a public or
production service.

## Native integration: Tanzu Agent Buildpack

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

In the current private pilot, the direct native ACP → model → Gateway
read-only-tool probe passed with its expected nonce. Helper also completed an
owner-authorized relay turn through this adapter and replied in the exact
source-thread root; the tool nonce matched backend logs. Its CF Task verified
the dedicated worker PostgreSQL connection using TLS 1.3 with the certificate
verified. This does not establish TLS for the separate relay or identity
databases.

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

The current private pilot has an active Helper worker with the verified TLS
connection above. A second Helper task was refused while the first held its
lease. Controlled restart/reactivation succeeded; the earlier relay thread
transcript remained available and Helper recalled its prior nonce without
another tool call. A fresh top-level thread returned a distinct `NEW_THREAD`
response. This demonstrates transcript-backed context across that restart; it
does not mean the provider session or task-local files persist. Linux TLS
fixture/CI coverage exercises lease loss and process-group termination. An
isolated live CF Task also verified the deployed supervisor's configured
deadline using synthetic child processes and a dedicated lease. This did not
test an issuer-expired grant in a real conversation; see the [validation
guide](tmm-validation.md) for the remaining scope and evidence limits.

## Built-in Buzz runtime

The Buzz built-in runtime is an alternative path in the worker launcher. It
starts `buzz-agent`, resolves the same explicit Tanzu model binding, and uses a
task-local MCP bridge to the bound HTTPS Gateway endpoint. Buzz's native tools
access the configured MCP backend, while the launcher enables the same bounded
ACP response publisher used by the Tanzu adapter.

This alternative is present in source and can be selected for a named agent
with `agents.NAME.runtime` set to `builtin`. The private-pilot Researcher
completed an owner-authorized relay turn through AI Services and the read-only
Gateway tool, then published a signed reply to its source thread. Its output
contained the requested title and tool nonce without the earlier false
messaging warning. This verifies that turn path, not the unrun multi-human
allowlist or grant-expiry scenarios. It needs the same owner grant,
relay/channel authorization, service-binding review, and task-lifecycle
validation as the Buildpack path.

`agents.NAME.model` can select that runtime's tool-capable model. If omitted,
the agent uses the deployment's configured model. The bound Buzz MCP service
limits available tools; those tools execute with the worker app's privileges.

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
