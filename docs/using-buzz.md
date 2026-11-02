# Using Buzz with your team

Buzz puts people, project conversations, and AI agents in shared channels. A
channel is the project room; a thread keeps one discussion attached to the
message that started it. Messages and agent replies are relayed through the
Buzz community, so a useful answer stays with its discussion.

## Installation and first sign-in

Begin with a facilitator-led session on the existing verified desktop. Bring
approved non-confidential questions, select an agent with the facilitator and
record results; no attendee installation is required for this first evaluation.

The independent Mac direction is the official Buzz client plus a Tanzu plugin.
Wait for your operator's verified official release, native SSO configuration and
fresh-install instructions. The current beta/plugin compatibility result does
not provide that SSO path. [Client status](client-status.md) tracks the gates.

After that acceptance, each person creates their own Buzz identity, signs in
through the configured SSO provider, and obtains ordinary relay admission,
channel invitations and explicit shared-agent access. Do not copy the operator's
profile or put secrets in client configuration. Follow [Getting started](getting-started.md)
for the future onboarding sequence and labeled historical screenshots.

## Share a project room

Create or join one channel for the project, then invite the people and agents
that should participate. Channel membership controls which channel messages
the member can read and where they can post. Project membership by itself does
not grant access to every other channel.

To keep work together, reply to the relevant message instead of starting a new
top-level message. Use the channel's member/invite controls to add a teammate
or an agent identity. If an agent is not listed, ask its owner or the community
operator to check that it is available and that the invitation is authorized.

The [private channel form](getting-started.md#private-project-channel-form) shows the visibility choice. The [channel member list](getting-started.md#channel-members) shows the operator and two hosted agents.

## Ask an agent in a thread

1. Open the project channel and find the message or thread with the needed
   context.
2. Reply in that thread, type `@`, and select the intended agent from the
   autocomplete suggestions. Typing a name as plain text is not sufficient.
3. Include the request and any relevant constraints in the same message, then
   send it.
4. The mentioned, authorized agent receives the event and replies in its
   admitted channel/thread. Continue the discussion in that thread.

The thread mention picker also offers **Automatically mention agents** and a
per-agent selection. Leave it off to choose each invocation explicitly, or
select the intended agent when you want subsequent thread replies to address
it automatically. This convenience does not change the agent's author policy.

An explicit agent mention selects the agent. The runtime does not select an
agent by guessing from the message text. Only agents that are discoverable to
you and authorized for the destination can be mentioned. The agent's owner
must have enrolled that agent, and the agent must have the necessary channel
access. A mention does not grant the agent new permissions. The pinned Buzz
ACP harness also has an author gate: its default is `owner-only`, so a team
member's mention will not reach the model unless the operator configures an
allowlist. To admit selected teammates, the operator sets
`agents.NAME.respondTo` to `allowlist` and adds their 64-character lowercase
Buzz public key hex values to `agents.NAME.respondToAllowlist` in the private
deployment config. Ask each teammate to provide the key shown by their
verified Buzz identity; do not build this list from email addresses. The owner
is included automatically. This admits message authors; each teammate and the
agent identity still need channel access. Ask the operator if an agent does
not answer. The private pilot verified both owner-authorized runtimes and a
separate Workshop Helper shared with one approved teammate. That teammate
received an answer in the existing thread and a separate context in a new
thread; an owner-only helper explicitly rejected the same teammate.

For the hosted Tanzu adapter, the Buzz supervisor supplies the route from the
admitted source event. The adapter forwards the prompt and returns assistant
text; it cannot choose a channel or thread from generated text. A successful
turn is published as one agent-authored reply in the original route. Failed,
cancelled, empty, or unroutable turns are not published by this adapter.
The reference manifest sets `BUZZ_ACP_SESSION_POLICY=thread`, so model context
is intended to be isolated by channel thread. Confirm the rendered and deployed
setting before relying on this behavior; a configuration change may select a
different session policy.

See the [real desktop conversation](getting-started.md#hosted-agent-reply) for
an owner-authorized Helper turn. Its tool nonce matched the backend log.

## Who can see or use an agent?

Agents have their own identity and channel membership. The current hosted
pilot uses owner-approved, scoped identity grants for its relay connection.
That grant identifies the owner and agent to the identity service; it does not
make the agent a member of every channel, grant a human's roles, or expand the
agent's model/tool permissions. Channel membership and runtime service bindings
are separate controls.

The private pilot has verified two-user shared-room/allowlist behavior and
private-channel denial. The second user's signed HTTP client used its own
real SSO session and key; a second desktop's UX was not tested. Official-client SSO and fresh-install acceptance remain pending. Team members need
both channel access and an author policy that admits their messages. These
results do not represent a public deployment.
