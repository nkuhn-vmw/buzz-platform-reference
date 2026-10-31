# TMM workshop facilitator guide

This is the facilitator procedure for the deployed private pilot. The two-user
shared-agent, channel-isolation, owner-only denial, logout, and native Credential
Store A/B deletion sequence have passed. Signed attendee distribution remains
pending; the second user's Buzz server checks used a separate signed HTTP
client with real SSO. Track the exact limits in the [validation guide](tmm-validation.md).

## Suggested live session

| Segment | Demonstration | What to explain |
| --- | --- | --- |
| 5 minutes | Open the operator's Buzz desktop and project channel. | Local desktop, hosted relay, and independent human identities. |
| 10 minutes | Mention Workshop Helper; have the approved second user follow up in the same thread, then start a new one. | Channel membership, explicit agent selection, shared thread context, and separate topics. |
| 5 minutes | Contrast the shared helper with an existing owner-only agent and the private channel. | Reading a conversation does not grant permission to invoke an agent or access another channel. |
| 10 minutes | Open the native companion in two browser profiles; show A/B receipts, remove A's entry, and call again as both users. | Credential Store selects each user's credential; B remains unaffected. This flow is separate from Buzz. |
| 5 minutes | Show the CF apps, tasks, bindings, and the recorded receipts. | Platform services and scoped access, plus the limits that still require production decisions. |

Complete enrollment and sign-in before presenting. Keep grant expiry beyond
the session, and rehearse with synthetic data only. Use the [desktop screenshots](getting-started.md#two-people-sharing-one-agent)
and [credential screenshots](credential-companion.md#read-the-live-result) as
explanations, not substitutes for a working deployment.

## Before inviting attendees

The facilitator needs an operator-deployed community, two approved SSO accounts, and separate Buzz identities. Each attendee uses their own Mac and local keychain. Do not distribute the operator's `.credentials/` directory or use `scripts/launch-desktop.mjs` for attendees: that operator helper deliberately loads the pilot owner's identity.

Provide attendees with the approved desktop download, community address, SSO instructions, project channel, and agent names through the organization's private distribution channel. The current pilot macOS artifact is unsigned and unnotarized. Resolve distribution with the organization's macOS administrator before a broad workshop; do not ask participants to disable Gatekeeper. Installation and first-use screenshots are in [Getting started](getting-started.md).

Check the exact API, org, and space, then inspect the deployed processes and tasks:

```sh
node scripts/deploy.mjs status
node scripts/cf.mjs tasks buzz-agent
node scripts/cf.mjs tasks buzz-agent-researcher
```

The worker apps intentionally have no running web process; their active CF Tasks must be `RUNNING`. Check each private enrollment's `expires_at` against the whole workshop duration. Renew enrollment and reactivate before the session if necessary. Do not print grant tokens or start a duplicate task. Agent activation requires stopping the exact existing task first; see [agent operation](agents.md).

## Admit an ordinary participant

1. Obtain explicit authorization for the participant's exact SSO email. Add only that address to the private deployment's `allowedEmails`, render and deploy the identity service using the [installation procedure](install.md). A successful SSO login does not itself admit a relay member or grant channel access.
2. Have the participant sign in from their own Buzz desktop. Verify the selected account and obtain its Buzz public key over your trusted onboarding channel. Use the 64-character lowercase hex form. Keep it in private operations records; never request their secret key or login token.
3. Admit that identity as an ordinary relay member:

   ```sh
   node scripts/deploy.mjs admit-participant VERIFIED_BUZZ_PUBLIC_KEY_HEX
   ```

   This submits `add-member --role member` in the configured relay. It does not grant a Cloud Foundry role, change SSO access, enroll an agent, or add a channel membership. Existing relay membership is left unchanged by upstream `add-member`; check the roster if the identity existed before. Do not use `admit-owner` for attendees: it requests administrator membership.
4. In the owner's desktop, create a private workshop channel and invite the participant as a member. Invite the selected agent as a bot. Confirm both human identities are distinct before testing.
5. For a shared agent, use a separate enrolled name such as `workshop-helper`. Configure `runtime: tanzu`, `respondTo: allowlist`, and `respondToAllowlist` containing the participant's verified Buzz public key in the private deployment. The owner is included automatically. Enroll and activate using that same name as described in [Agents](agents.md). Activation also publishes the corresponding owner-signed directory policy; authorize that intended audience before running it. Keep the existing owner-only agents unchanged for the denial check.

Email allowlisting, relay membership, channel membership, agent directory policy, and the worker's author policy are different controls. All must permit the intended interaction. None makes a tool run as the attendee's platform identity.

## Rehearse with two people

Use synthetic project content. Save only labeled results and non-sensitive request receipts. Screenshots should hide emails, keys, tokens, private channel contents, and browser authorization URLs.

| Step | Action | Required evidence |
| --- | --- | --- |
| Two sign-ins | A and B sign in independently with distinct SSO subjects and Buzz keys. | Both succeed. Label them A and B in the public record; retain identity correspondence privately. |
| Shared conversation | A mentions the shared agent in a new thread; B follows up in that thread. | Each receives an agent-authored reply in the same source thread. A backend tool receipt, when requested, matches the relevant call. |
| Separate topic | B starts a second thread. | The agent does not recall a unique marker from the first thread unless deliberately supplied again. |
| Owner-only denial | B attempts to invoke an existing owner-only agent. | Directory/author policy prevents use; no model/tool call is made for B. A still receives a reply. Absence of a reply alone is insufficient—check the authorization evidence. |
| Private-channel denial | Keep a second private channel visible only to A. Attempt a read of a known event and a post as B using B's authenticated client. | A can read the fixture. B's query returns an empty event array because the relay filters private events; B's write is rejected and the event is absent even from A's query. An empty channel list alone does not prove access denial. |
| Logout | B logs out; attempt to request a fresh identity assertion with the revoked session. | The identity service refuses the request. Already-issued assertions can remain valid for up to five minutes; do not claim immediate disconnection. |

A separately authenticated signed HTTP client may verify server-side behavior when only one Mac is available. Record that limitation; it does not establish a second desktop's user experience. Do not reuse A's desktop profile or key for B.

## Per-user Credential Store acceptance

The shipped Buzz bridge sends text and a thread session ID to the installed native Agent Buildpack `/api/chat`. That runtime authenticates its own encrypted browser session; it has no verified incoming bearer handoff for Buzz. The identity adapter also does not retain the upstream SSO access token. **Per-user delegation from Buzz is not implemented.** Do not derive credential authority from a prompt, display name, thread ID, or model output.

The optional [native Credential Store companion](credential-companion.md) provides a separate synthetic exercise alongside Buzz. Its A-positive/B-missing-credential, both-configured, and A-delete/B-unaffected phases passed. Verify its Gateway/Store identity mapping and both browser identities before interpreting results. Do not bind user-scoped credentials to the existing Buzz runtime, whose internal chat endpoint uses application access.

For that separate acceptance exercise:

1. Use a dedicated Credential Store and test resource, with the companion bound only to that store. Store two disposable test credentials that produce distinct non-secret receipts, `A` and `B`. The protected tool must never echo a credential.
2. Verify the native agent issuer/subject and the Credential Store management issuer/subject. Foundation UAA and an app's SSO zone can differ. Same email is not proof of equal subjects. Determine the resolution tier actually used; any intentional cross-issuer claim mapping must have an approved trust policy. Never report an incidental email fallback as subject isolation.
3. Ensure no store-scoped credential exists for the resource and no other bound store can satisfy it. Explicitly inspect claim fallback configuration. Record only the relevant configuration and metadata, never credential values. Verify production debug endpoints cannot expose or delete other users' credentials.
4. Confirm the least CF role needed to manage one's own credentials. Application SSO access does not authorize granting CF SpaceDeveloper; that role can expose app bindings. Resolve management access or isolate the workshop space before adding roles.
5. Let each user save their own `scope: user` credential through the supported management flow. Do not use an administrator's token and relabel the resulting credential as another user.

| Scenario | Expected outcome |
| --- | --- |
| A has a credential; B has none | A's tool call returns receipt A. B's fresh call fails; A's usage metadata does not advance for B. |
| Both have credentials | A receives A; B receives B. Only the caller's usage metadata advances. `storeCredential` remains absent. |
| A deletes their credential | A's next fresh call fails; B still receives B. Report any cache/revocation delay observed. |
| B attempts cross-user use | No receipt A and no access to A's credential management data. |

Static-token deletion is not evidence of OAuth refresh, expiry, or revocation. Those need their own supported live flow before being advertised. Finish restages before sign-in and check reconnection after any native runtime restart.

Per-user credential selection would not make results private inside a shared Buzz thread: everyone with channel access can read agent replies, tool output, and relevant conversation context. Keep confidential user-specific data out of shared conversations.

## Close the rehearsal

Record pass/fail/not-run for each scenario with the code revision and sanitized evidence. Do not mark the workshop ready while an identity boundary or participant distribution prerequisite is unresolved.

Remove a temporary participant from private channels and shared-agent allowlists. For relay cleanup, the role-filtered command refuses to remove an administrator:

```sh
node scripts/deploy.mjs remove-participant VERIFIED_BUZZ_PUBLIC_KEY_HEX
```

This removes relay membership only. It does not revoke SSO, erase local history, or immediately invalidate already-issued assertions. Remove temporary SSO access using the same exact-email configuration path, stop temporary agent tasks by their task IDs, and delete only the disposable credentials created for this rehearsal. Preserve the working owner-only pilot.
