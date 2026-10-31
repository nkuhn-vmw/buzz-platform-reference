<p align="center">
  <img src="docs/assets/hero.webp" alt="Abstract midnight-blue field with cyan and violet light" width="100%">
</p>

# Buzz Platform Reference

**A Cloud Foundry reference deployment for shared Buzz project conversations and owner-managed agents.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-45d5c7.svg)](integrations/Buzz-LICENSE)
[![Platform: Cloud Foundry](https://img.shields.io/badge/platform-Cloud%20Foundry-29c6ef.svg)](https://www.cloudfoundry.org/)
[![Client: Buzz](https://img.shields.io/badge/client-Buzz-8b83ff.svg)](https://github.com/block/buzz)
[![Status: pilot reference](https://img.shields.io/badge/status-pilot%20reference-f0bf69.svg)](docs/tmm-validation.md)
[![Reference checks](https://github.com/nkuhn-vmw/buzz-platform-reference/actions/workflows/ci.yml/badge.svg)](https://github.com/nkuhn-vmw/buzz-platform-reference/actions/workflows/ci.yml)

[Install](docs/install.md) · [Get started](docs/getting-started.md) · [Use Buzz with a team](docs/using-buzz.md) · [Configure agents](docs/agents.md) · [Architecture](docs/architecture.md)

This repository packages a pinned Buzz desktop client and deploys the supporting identity, relay, read-only tool, and hosted agent services to an operator-selected Cloud Foundry space. It is a deployment reference for a pilot, not a public hosted service or a turnkey marketplace tile.

The deployment uses platform service bindings for persistence, identity, model access, and tool access. Agent tasks use a per-agent PostgreSQL lease; messages remain in the relay while local worker files and model session state are temporary. See the architecture and validation guide for boundaries and evidence status.

| Shared project rooms | Owner-managed agents | Platform-native deployment |
| --- | --- | --- |
| People keep work in channels and message threads. | An explicit mention addresses one agent; channel membership and the configured author policy still apply. | Operator-selected Cloud Foundry service plans, app identity, and bound AI/MCP services define the deployment. |

## Validation status

This source tree is a pilot reference. In a private pilot, operator/desktop SSO, channel message persistence, and live owner-authorized Helper (Tanzu) and Researcher (Buzz built-in) turns through the read-only Gateway tool have succeeded. The worker PostgreSQL connection verified TLS 1.3 and its certificate in a CF Task. The real desktop request and source-thread reply were also verified and captured. Multi-human allowlist behavior, live grant-expiry timing, and signed desktop distribution remain unverified. See the [validation guide](docs/tmm-validation.md) for evidence boundaries; these results do not establish whole-pilot acceptance or a public service.

## Start here

- [Operator installation and deployment](docs/install.md)
- [First sign-in and team onboarding](docs/getting-started.md)
- [How channels, threads, and agent mentions work](docs/using-buzz.md)
- [Agent ownership, sharing, and author policy](docs/agents.md)
- [Runtime choices and OpenCode assessment](docs/agent-runtimes.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Validation checklist](docs/tmm-validation.md)
- [Troubleshooting](docs/troubleshooting.md)

## Screenshots

The [getting-started guide](docs/getting-started.md) includes authentic desktop screenshots of sign-in, private channel creation, channel membership, and a live hosted-agent reply.

[![A real desktop conversation with the hosted Platform Helper](docs/assets/agent-thread.jpg)](docs/getting-started.md#hosted-agent-reply)

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for focused changes and checks. Report suspected vulnerabilities through the private reporting route described in [SECURITY.md](SECURITY.md).
