# Upstream and build provenance

Buzz source is pinned to [`5d70622ac0b1b7bf940803cc8f912f0e82a4c946`](https://github.com/block/buzz/tree/5d70622ac0b1b7bf940803cc8f912f0e82a4c946), version 0.5.28, under Apache-2.0. Patches in this repository implement federated identity on the desktop/agent boundary and the hosted native-runtime reply path. They are maintained reference patches, not claimed upstream releases.

The relay packaging script extracts official Linux amd64 binaries and web assets from `ghcr.io/block/buzz@sha256:d30f1b0b393df82a023810c00e080b1418c6123fd74a18a7232ca01c0d3db90c`. The worker is built from the pinned source plus the agent patch with Linux Rust 1.98.1. `scripts/build-agent.sh` pins the builder image digest and lockfile. `scripts/build-desktop.sh` checks the source revision and patch, then builds a separate macOS application/profile. Platform origins are embedded at build time; build a client for your own deployment.

`SHA256SUMS` files in generated packages identify their binaries. Node lockfiles describe the JavaScript dependencies. Neither a Node audit nor source lockfiles establish that an opaque foundation-supplied native runtime is vulnerability-free. No proprietary platform executable or private repository dependency is redistributed.

## Verification boundary

The owned Node tests, disposable PostgreSQL tests, desktop identity/origin tests and live deployment flow are tracked in the validation guide. The entire upstream Rust suite is not claimed green. In a Linux baseline comparison at the pinned revision, `invalid_or_unavailable_wrapper_never_falls_back_to_worker` reproduced a failure on untouched upstream; `claude_version_timeout_kills_launcher_children` passed in isolation. An earlier patched full-suite run reported both failures, so the second remains an environment-sensitive/unresolved result rather than a confirmed upstream defect. These process-launch tests are separate from the passing targeted identity/routing checks.
