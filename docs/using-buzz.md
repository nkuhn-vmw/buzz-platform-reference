# Using Buzz with your team

Buzz puts people, project conversations, and AI agents in shared channels. A
channel is the project room; a thread keeps one discussion attached to the
message that started it. Messages and agent replies are relayed through the
Buzz community, so a useful answer stays with its discussion.

## Installation and first sign-in

This repository is a deployment reference, not an end-user installer. The
operator first deploys the relay and identity service, configures the desktop
client for that relay, and provides a signed desktop build through the team's
approved distribution route. Follow the operator's release link and
organization sign-in instructions; never put a relay secret or an agent key in
the client configuration.

After installing the signed client:

1. Open Buzz and connect to the community address provided by your operator.
2. Sign in with the organization's identity provider when prompted.
3. Join the project channel using the invite or channel directory supplied by
   your team.
4. Open the channel and post a message. Reply to a message to keep a discussion
   in its thread.

The operator must supply the distribution link, community address, and any
invite before this section can serve as a deployment-specific installation
guide. Do not substitute private pilot links in this public reference.

For the sign-in entry point, see the [desktop profile screenshot](getting-started.md#desktop-sign-in-entry-point). It shows the pre-sign-in state and is not a sign-in success receipt.

## Share a project room

Create or join one channel for the project, then invite the people and agents
that should participate. Channel membership controls which channel messages
the member can read and where they can post. Project membership by itself does
not grant access to every other channel.

To keep work together, reply to the relevant message instead of starting a new
top-level message. Use the channel's member/invite controls to add a teammate
or an agent identity. If an agent is not listed, ask its owner or the community
operator to check that it is available and that the invitation is authorized.

The [private channel form screenshot](getting-started.md#private-project-channel-form) shows the channel visibility choice. A channel member-list and thread conversation screenshot remains to be captured.

## Ask an agent in a thread

1. Open the project channel and find the message or thread with the needed
   context.
2. Reply in that thread and select the intended agent from mention autocomplete
   (or type its exact `@name`).
3. Include the request and any relevant constraints in the same message, then
   send it.
4. The mentioned, authorized agent receives the event and replies in its
   admitted channel/thread. Continue the discussion in that thread.

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
not answer. The private pilot has verified owner-authorized Helper and
Researcher turns; a two-human allowlist workshop has not run, so teammate
allowlist behavior remains unverified live.

For the hosted Tanzu adapter, the Buzz supervisor supplies the route from the
admitted source event. The adapter forwards the prompt and returns assistant
text; it cannot choose a channel or thread from generated text. A successful
turn is published as one agent-authored reply in the original route. Failed,
cancelled, empty, or unroutable turns are not published by this adapter.
The reference manifest sets `BUZZ_ACP_SESSION_POLICY=thread`, so model context
is intended to be isolated by channel thread. Confirm the rendered and deployed
setting before relying on this behavior; a configuration change may select a
different session policy.

The mention-and-reply screenshot remains pending capture. Live Helper and
Researcher turns have been verified separately; the final desktop UI capture
has not been made.

## Who can see or use an agent?

Agents have their own identity and channel membership. The current hosted
pilot uses owner-approved, scoped identity grants for its relay connection.
That grant identifies the owner and agent to the identity service; it does not
make the agent a member of every channel, grant a human's roles, or expand the
agent's model/tool permissions. Channel membership and runtime service bindings
are separate controls.

The private pilot has verified channel creation, message persistence, and
owner-authorized agent answers. A two-human shared-room/allowlist workshop and
signed, generally available desktop distribution are not verified. Team
members need both channel access and an author policy that admits their
messages. These results do not represent a public deployment.
