# Client status and pilot starting path

Updated November 5, 2026. **If a teammate wants to join from their own Mac, hold the invitation.** An official release still needs to support choosing the organization at startup and creating or linking a new member’s key on their first visit. The latest preview checked was [243.1](https://github.com/block/buzz-app/releases/tag/v0.7.0-preview.243.1).

For a facilitator-led evaluation, use the existing SSO desktop. Renew organization sign-in and agent grants, confirm one running task per agent, then ask a fresh question and check its tool-backed reply. [Workshop procedure](workshop.md) · [Agent operation](agents.md).

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
| Official release with native federation configuration | The upstream PR is ready for maintainer review. Preview 243.1 still uses compile-time configuration. | Qualify a release with both native SSO configuration and first-time identity setup before inviting colleagues. |

## Generic upstream contribution

PR #2152 lets a desktop with no compiled authority read a trusted local `federated-identity.json` at startup. A compiled deployment policy takes precedence. The change uses Buzz’s existing native credentials and relay assertions, and applies to any compatible federation adapter. The fork hosts the contribution. Use Block’s releases for official client downloads. [Upstream PR and Mac test results](https://github.com/block/buzz-app/pull/2152) · [Contribution fork](https://github.com/nkuhn-vmw/buzz-app).

The descriptor chooses where users sign in. Obtain it from a trusted operator, protect its parent directory, and review plugins before installing them. A process running as the Mac user can replace files that user owns. Maintainer review includes this local trust decision.

On a Mac running the PR candidate, an existing member signed out of the organization and a protected write returned 401. After signing back in with the same key, the relay accepted a new message and the member saw it after reopening the channel. DCO, Semgrep and zizmor passed. Application CI requires upstream authorization. [Candidate evidence](https://github.com/block/buzz-app/pull/2152) · [Application CI](https://github.com/block/buzz-app/actions/runs/41724185340).

**What still needs to ship.** Preview 243.1 reads the authority at compile time and its Welcome screen offers the build’s sign-in service. A separate draft covers required-community signup and recovery. The relay has merged discovery support for reporting a host's sign-in requirement. That field tells clients **when** sign-in is required. Operators must still supply a trusted authority, and first-time members need a supported way to create or link their own key. [Release source](https://github.com/block/buzz-app/blob/56729773f48d3f922a043ac83b7faa727bcfc9c2/src-tauri/src/federated_identity/mod.rs#L134) · [First-run proposal](https://github.com/block/buzz-app/pull/2245) · [Merged relay discovery](https://github.com/block/buzz/pull/8988).

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
