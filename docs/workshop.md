# TMM workshop facilitator guide

Run the first evaluation with the existing, authorized facilitator desktop;
attendees join the meeting and review shared agent work without installing a
custom Mac app. The earlier two-user server and native Credential Store tests
passed, but the second Buzz identity used a signed HTTP client, not a second
installed desktop. The selected attendee direction is official Buzz plus a
Tanzu plugin. Native SSO and fresh-install acceptance remain pending; see
[current client status](client-status.md) and [validation evidence](tmm-validation.md).

## Suggested live session

| Segment | Demonstration | What to explain |
| --- | --- | --- |
| 5 minutes | Open the operator's Buzz desktop and project channel. | Local desktop, hosted relay, and independent human identities. |
| 10 minutes | Mention Workshop Helper; after official-client SSO and two-Mac acceptance pass, have the approved second user follow up and start a new thread. Until then, show the recorded two-user rehearsal in the operator's desktop. | Channel membership, explicit agent selection, shared thread context, and separate topics. |
| 5 minutes | Contrast the shared helper with an existing owner-only agent and the private channel. | Reading a conversation does not grant permission to invoke an agent or access another channel. |
| 10 minutes | Open the native companion in two browser profiles; show A/B receipts, remove A's entry, and call again as both users. | The tested foundation selects credentials by email across issuers. Use synthetic tokens only; this is separate from Buzz and is not subject isolation. |
| 5 minutes, optional | Preview the official beta and private prototype plugin with a separate synthetic identity. | Readiness/messaging compatibility only; the plugin is not distributed here and cannot add native SSO trust. |
| 5 minutes | Show the CF apps, tasks, bindings, and the recorded receipts. | Platform services and scoped access, plus the limits that still require production decisions. |

Complete enrollment and sign-in before presenting. Keep grant expiry beyond
the session, and rehearse with synthetic data only. Use the [desktop screenshots](getting-started.md#two-people-sharing-one-agent)
and [credential screenshots](credential-companion.md#read-the-live-result) as
explanations, not substitutes for a working deployment.

## Start a facilitated session

1. Select your existing private deployment configuration; run `node scripts/cf.mjs --verify-target`
   and `node scripts/deploy.mjs status`. Confirm the intended environment before any renewal.
2. Renew the owner's desktop SSO through the existing facilitator build's
   [Platform sign-in](../integrations/desktop/README.md#first-launch). The operator's
   terminal SSO session is separate: run `node scripts/login.mjs` and finish its
   browser flow as the same owner when renewing agent grants.
3. Inspect task states and print grant expiries with the commands below. For each
   missing/expired worker, stop only its exact existing active task ID, wait until
   no task is `PENDING`, `RUNNING` or `CANCELING`, then enroll and activate that
   existing agent name. See [agent operation](agents.md); do not rerun `admit-owner`
   or create a new identity for renewal.
4. Confirm exactly one `RUNNING` task for each agent used in the session and grant
   expiries beyond the session end. Keep the existing approved directory/author
   audience; this renewal does not authorize adding participants.
5. From the existing facilitator desktop, mention each demonstration agent in its
   channel and require a source-thread reply with a tool nonce matching the backend
   receipt. If it fails, resolve the cause before presenting.
6. Record the dated preflight in the [validation template](tmm-validation.md#workshop-record-template).
   Run the agenda above with meeting attendees; no attendee install or membership
   change is needed for this session.

For example, after stopping any active `buzz-agent` task and renewing owner SSO,
renew the existing default Helper without changing its audience:

```sh
node apps/identity/tools/enroll-agent.mjs --agent helper
node scripts/activate-agent.mjs --agent helper
node scripts/cf.mjs tasks buzz-agent
```

Repeat only for other already-configured, approved agents using their matching
name and app. Do not start a duplicate task when an existing task is healthy.

## Before inviting attendees

For the facilitated session, the operator needs an already verified community,
owner desktop identity, current owner SSO and agent grants. Attendees need only
approved synthetic questions and a way to record feedback. Rehearse a real
agent/tool reply before inviting them. Never distribute `.credentials/` or the
owner-loading `scripts/launch-desktop.mjs` helper to attendees.

For later independent use, complete the [official-client gates](client-status.md#before-independent-attendee-onboarding),
then provide the verified official release, reviewed plugin, community address,
SSO instructions, channels and agent names privately. Keep each Mac's identity and
keychain separate. The earlier unsigned facilitator build is not the selected
attendee distribution; do not ask users to disable Gatekeeper.

The optional native credential segment uses only the two existing approved
accounts and synthetic entries. Each account owner completes their own sign-in;
keep the identities in separate browser profiles and do not share passwords or tokens. Additional Buzz email approvals do not grant CF
roles or companion access. For a separately authorized new companion deployment,
follow the [companion guide](credential-companion.md#participant-management-commands):
verify the minimum scoped management role and deliver only each person's own
synthetic credential privately. SpaceAuditor includes app-log visibility; do not
put private user data in that shared test space.

Check the exact API, org, and space, then inspect the deployed processes and tasks:

```sh
node scripts/deploy.mjs status
node scripts/cf.mjs tasks buzz-agent
node scripts/cf.mjs tasks buzz-agent-researcher
node scripts/cf.mjs tasks buzz-agent-workshop-helper
```

The worker apps intentionally have no running web process; their active CF Tasks must be `RUNNING`. Check each private enrollment's `expires_at` against the whole workshop duration. Renew enrollment and reactivate before the session if necessary. Do not print grant tokens or start a duplicate task. Agent activation requires stopping the exact existing task first; see [agent operation](agents.md).

Print only grant expiries from the configured private enrollment records:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDeployment } from './scripts/lib/config.mjs';
const c = loadDeployment();
for (const name of Object.keys(c.agents)) {
  const e = JSON.parse(readFileSync(join(c.credentialsDir, 'agents', name, 'agent-enrollment.json')));
  console.log(name, e.expires_at);
}
JS
```

## Admit an ordinary participant

Run this only after the official-client installation/SSO gate passes and the
participant and intended agent audience are authorized. It is not needed for
meeting attendees watching the facilitator.

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

A separately authenticated signed HTTP client may verify server-side behavior when only one Mac is available. Record that limitation; it does not establish a second desktop's user experience or satisfy the two-Mac acceptance gate. Do not reuse A's desktop profile or key for B.

## Per-user Credential Store acceptance

The shipped Buzz bridge sends text and a thread session ID to the installed native Agent Buildpack `/api/chat`. That runtime authenticates its own encrypted browser session; it has no verified incoming bearer handoff for Buzz. The identity adapter also does not retain the upstream SSO access token. **Per-user delegation from Buzz is not implemented.** Do not derive credential authority from a prompt, display name, thread ID, or model output.

The optional [native Credential Store companion](credential-companion.md) provides a separate synthetic exercise alongside Buzz. Its A-positive/B-missing-credential, both-configured, and A-delete/B-unaffected phases passed. Verify its Gateway/Store identity mapping and both browser identities before interpreting results. Do not bind user-scoped credentials to the existing Buzz runtime, whose internal chat endpoint uses application access.

Those results hold for the two controlled accounts under the foundation's
email-based cross-issuer mapping. Production trust-policy approval remains open;
the result is not issuer/subject isolation. If your mapping is email-based,
continue only with approved synthetic accounts/tokens and stop before connecting
real credentials or personal datasets.

For that separate acceptance exercise:

1. Use a dedicated Credential Store and test resource, with the companion bound only to that store. Store two disposable test credentials that produce distinct non-secret receipts, `A` and `B`. The protected tool must never echo a credential.
2. Verify the native agent issuer/subject and the Credential Store management issuer/subject. Foundation UAA and an app's SSO zone can differ. Same email is not proof of equal subjects. Determine the resolution tier actually used. Email-based mapping permits only this explicitly approved synthetic exercise; an approved production trust policy is required before real credentials or datasets are connected. Never report email fallback as subject isolation.
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

Record pass/fail/not-run for each scenario with the code revision and sanitized evidence. For independent participant rehearsals, do not mark acceptance complete while an identity boundary or official-client onboarding prerequisite remains unresolved. A facilitator-only session can proceed after its own successful preflight; record independent-desktop checks as not run.

Remove a temporary participant from private channels and shared-agent allowlists. For relay cleanup, the role-filtered command refuses to remove an administrator:

```sh
node scripts/deploy.mjs remove-participant VERIFIED_BUZZ_PUBLIC_KEY_HEX
```

This removes relay membership only. It does not revoke SSO, erase local history, or immediately invalidate already-issued assertions. Remove temporary SSO access using the same exact-email configuration path, stop temporary agent tasks by their task IDs, and delete only the disposable credentials created for this rehearsal. Preserve the working owner-only pilot.

Also remove temporary companion emails from `allowed-emails`/`APP_ALLOWED_EMAILS`
and restart the companion to end gate sessions. Revoke temporary SpaceAuditor
roles and any OrgUser membership created solely for this workshop through the
approved access-management process; preserve pre-existing roles. Follow the
[credential cleanup steps](credential-companion.md#end-the-workshop) before
stopping the synthetic apps.
