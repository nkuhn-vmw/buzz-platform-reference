# Agents in Buzz

Buzz agents are separate identities that read and answer messages through the
same relay as people. A person chooses an agent by mentioning it in a channel
message or thread. Buzz routes the authorized event to that agent's runtime;
the runtime does not pick a different agent or destination based on its own
generated text.

## How an agent is chosen

Use mention autocomplete to select the intended agent. The relay event carries
the agent mention, and the Buzz ACP harness filters incoming events according
to that agent's response policy and channel access. The pinned harness defaults
to `owner-only`; unless the operator sets an allowlist, a team member's
explicit mention is dropped before it reaches the model. Configure
`agents.NAME.respondTo` as `allowlist` and list verified Buzz public keys in
`agents.NAME.respondToAllowlist` in the private deployment config. The
activation helper applies that policy. Collect keys from each teammate's
verified Buzz identity, not from email addresses. The owner is included
automatically. Keep `owner-only` as the default. A mention never overrides the
author gate or channel authorization. The adapter publishes a successful
assistant response to the source channel and canonical thread; the private
pilot worker is not active yet, so a full hosted turn has not been verified
live.

Only the addressed agent is selected by an explicit mention. Other agents do
not automatically answer just because they are members of the room. Agent to
agent coordination is a separate, explicit mention. If the intended agent is
missing from autocomplete, ask its owner or the community operator to check
discovery, channel membership, and authorization; do not assume that a missing
agent has permission to join.

The default `helper` uses the Buzz ACP harness and a custom adapter to connect
to the Tanzu Agent Buildpack chat endpoint. Assistant text returns through ACP
and is published to the admitted source thread after a successful turn. The
adapter suppresses reasoning and UI metadata. Failed, cancelled, empty,
oversized, heartbeat, or unverified-route output is not published.

Reply placement follows the source route, and the activation helper sets
`BUZZ_ACP_SESSION_POLICY=thread` for isolated model context by channel thread.
The session is still ephemeral with the CF Task; durable relay messages do
not make the model session durable.

## Per-owner agents and shared agents

Every agent has its own relay key and scoped grant, enrolled through the
operator's verified SSO session. In this reference the enrollment helper uses
the dedicated pilot-owner identity for enrolled agents. The worker presents
its own agent key, not the owner's key. Owner authorization is not
shared-channel membership: the agent identity must separately be admitted to
the relay and invited to the relevant channel. Model and tool access are
controlled by runtime configuration and service bindings.

An agent may be used privately by its owner or shared with a project team. A
shared agent remains owned by its enrolled owner; its owner/operator admits
the agent identity to a project channel and configures an ACP author allowlist
for selected teammates. Buzz does not create a group-owned key or transfer the
owner's grant to channel members. Channel membership and the ACP author
allowlist are both required for a teammate to invoke it.

Treat an agent identity as owner-managed. Do not copy its private key or grant
token to teammates. Teammates can address the agent only where it is discoverable
and authorized. To share a working agent, the owner can invite its identity to
the project's channel; that does not transfer ownership or expose the owner's
credentials. Revoking the owner's SSO authorization invalidates the owner's
agent grants. Runtime termination is a distinct operation and may be needed to
stop an already-running task immediately.

Enrollment is an operator workflow rather than a self-service team action.
Authenticate with `node scripts/login.mjs`, then enroll, admit the shared owner
to the relay (once per relay), and activate:

```sh
node apps/identity/tools/enroll-agent.mjs --agent helper
node scripts/deploy.mjs admit-owner
node scripts/activate-agent.mjs --agent helper
```

For another agent, pass the same `--agent NAME` to the enrollment and
activation commands, and configure `agents.NAME` first. The `admit-owner`
step is one-time per relay. `helper` uses the
`buzz-agent` app and `buzz-agent-identity` service. Another name creates an
independent `buzz-agent-NAME` CF app and `buzz-agent-identity-NAME` CredHub
service; PostgreSQL lease ownership is keyed by that agent's public key.
Enrollment and activation artifacts stay in ignored `.credentials/`. To
revoke future assertions, run
`node apps/identity/tools/enroll-agent.mjs --agent NAME --revoke`; terminate
its CF Task separately for an immediate process stop.

## Configure an agent

Merge an optional `agents` object into the root of the private
`.state/deployment.json`. The fields below are supported by the activation
helper:

```json
{
  "agents": {
    "helper": {
      "displayName": "Project Helper",
      "runtime": "tanzu",
      "respondTo": "owner-only"
    },
    "researcher": {
      "displayName": "Research Agent",
      "runtime": "builtin",
      "model": "YOUR_TOOL_CAPABLE_MODEL_ID",
      "respondTo": "allowlist",
      "respondToAllowlist": ["<replace-with-verified-64-character-lowercase-public-key-hex>"]
    }
  }
}
```

`runtime` is `tanzu` or `builtin`; it defaults to `tanzu`. Tanzu agents use
the deployment's shared model and do not take an agent-level `model` value.
Built-in agents use that shared model unless `model` selects a specific
tool-capable model. `displayName` is optional. The default author rule is
`owner-only`. The key shown above is a placeholder; replace it before use.
For `allowlist`, provide one or more unique lowercase 64-digit Buzz public
keys. The owner is admitted automatically. Do not use email
addresses or public keys copied from unverified text. Every allowed teammate
must still be a relay/community and channel member as required by the
deployment.

The Tanzu runtime uses the native Agent Buildpack chat endpoint. The built-in
runtime uses Buzz's bundled agent process and its task-local HTTPS MCP bridge.
Both use configured service bindings; tool availability and privileges come
from those bindings and the worker app identity. Native Buildpack shell and
filesystem tools are disabled. Credential Store per-user delegation through
the Buzz chat bridge is not implemented end to end.

## Safe use

- Address an agent only in a channel where the work belongs, and provide the
  least context needed for the task.
- Do not paste secrets into a channel or ask an agent to retrieve secrets
  outside the tools explicitly configured for it.
- Check the source message and tool result before acting on an agent's answer.
- Keep consequential changes and external actions under human review.
- Ask the owner/operator to stop or revoke an agent that is no longer needed.

## Screenshots

See [the getting-started guide](getting-started.md) for the authentic
pre-sign-in screen and private channel form. The agent directory/mention
autocomplete, channel membership, and agent reply inside its source thread
still need sanitized capture; no placeholder image links are used.
