# Client status and pilot starting path

Updated November 2, 2026. Start a controlled **facilitator-led evaluation** with
an existing, verified SSO desktop. Attendees can bring approved non-confidential
questions and review agent replies without installing a custom Mac build.
Before the session, the owner must renew SSO and agent grants, ensure exactly one
`RUNNING` task per agent used in the session, and rehearse a real tool-backed reply. See the
[workshop procedure](workshop.md) and [agent operation](agents.md).

## Official client plus plugin

The selected attendee direction is the **official Buzz Mac client plus a Tanzu
plugin**. The unchanged, vendor-signed and notarized
[v0.7.0-preview.229.1 beta](https://github.com/block/buzz-app/releases/tag/v0.7.0-preview.229.1)
was tested in a separate synthetic, membership-authenticated community. It
installed the local plugin, checked relay readiness, created a channel and
persisted a message. Anonymous/nonmember denial, invitation exhaustion and
membership removal were also checked. These are compatibility results, not
participant SSO or hosted-agent acceptance on that build.

The pilot plugin provides guidance and status. It cannot configure native SSO
trust or grant community/agent access. Buzz plugins are unsandboxed; review and
trust their source. The deployment-specific prototype stays in private operations
until there is a portable, supported onboarding flow. This public reference does
not currently distribute that plugin or an attendee installer.

| Client path | Status | Appropriate use |
| --- | --- | --- |
| Existing reference desktop patch | Earlier live SSO and agent tests passed; local build is unsigned/unnotarized | Existing authorized facilitator rehearsal; screenshots are labeled historical |
| Official beta plus pilot plugin | Vendor signature and isolated messaging/readiness checks passed | Synthetic compatibility demonstration only; it cannot load this pilot's SSO authority |
| Official release with native federation configuration | Generic draft PR; not shipped | Intended independent colleague path after upstream support and fresh-install acceptance |

## Generic upstream contribution

[Draft PR #2152](https://github.com/block/buzz-app/pull/2152) adds native runtime
configuration for any compatible Buzz federation adapter. It has no Tanzu or
Cloud Foundry dependency or private deployment configuration. An otherwise
unconfigured desktop can load a trusted local `federated-identity.json` at
startup; compiled authority takes precedence. Existing native credential storage,
NIP-FA/NIP-FI handling and plugin grants remain in use. The
[public contribution fork](https://github.com/nkuhn-vmw/buzz-app) is not a separate
client distribution.

The runtime file expands the native trust model: another process running as the
same OS user, including an unsandboxed plugin, could plant it and redirect the
organization sign-in prompt. Protect its parent directory and trust installed
plugins; file checks do not protect against malicious same-user processes.
Upstream maintainers still need to accept this trust model or choose an alternative.

Local federation/relay tests and Clippy passed. DCO, Semgrep OSS and zizmor passed;
the application CI run is `action_required` with no jobs run. The PR is a draft,
not included in the tested beta. Modified desktop live SSO and fresh enterprise
key onboarding remain unverified. The descriptor alone does not solve a first-run
onboarding flow or retarget other upstream services.

## Before independent attendee onboarding

1. Obtain an official release with upstream-supported native SSO configuration,
   via PR #2152 or the alternative upstream selects.
2. Document and test fresh installation, Buzz key creation, sign-in, renewal/logout,
   protected relay access and the plugin using that exact official artifact.
3. Rehearse with two Macs and distinct SSO identities and Buzz keys: ordinary relay
   admission, channel invitation, explicitly approved shared-agent audience,
   source-thread replies, owner-only denial and private-channel denial.
4. Expand to the rest of the approved cohort only after the two-person gate passes.

Email allowlisting alone is not onboarding. Do not replace SSO enforcement with
durable key membership without a separate access-model decision. Do not distribute
the facilitator's keys or private state. Per-user Credential Store delegation
inside Buzz remains unimplemented; the [native companion](credential-companion.md)
is a separate, controlled two-account exercise. OpenCode remains an extension
proposal, not a tested runtime in this reference.
