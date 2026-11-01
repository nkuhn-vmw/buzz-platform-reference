# Install and deploy

This guide is for a Cloud Foundry operator preparing a pilot in a dedicated, approved org and space. The scripts inspect and target the configured space, but service creation, app pushes, service bindings, and tasks still change that environment. Review the plan and manifest inputs before applying them.

## Prerequisites

- Node.js 24.x and Cloud Foundry CLI 8, logged in with permission to create services, apps, bindings, routes, and tasks in the target space.
- Docker for packaging the pinned relay image.
- A macOS build host with Xcode Command Line Tools, Git, pnpm, and Rust for the desktop bundle.
- Operator-selected service offerings and plans matching the template: PostgreSQL with verified TLS/direct connections, Lua-capable Redis, S3-compatible object storage, AI model service, SSO/identity, MCP Gateway, Credential Store, and CredHub. Availability and plan names are foundation-specific; obtain and verify them with the platform operator. In the current pilot, the Helper CF Task verified TLS 1.3 and its worker database certificate; this does not verify TLS for the relay or identity databases.
- An approved OIDC issuer/provider and an allowlist of pilot user email addresses.

## Configure and verify the target

Copy the public template to the ignored local deployment file:

```sh
cp config/deployment.example.json .state/deployment.json
```

Edit `.state/deployment.json` with the target API, org, space, domain, route prefix, model, SSO values, desktop profile, and actual service offering/plan names. Keep this file and `.credentials/` local. Do not commit credentials, generated parameters, or rendered manifests.

For a new TLS-enabled PostgreSQL deployment, keep `databaseTls: true` as in the
template. It enables certificate-verified TLS for the identity adapter and the
relay, including relay migrations. Trust comes from the named database binding
(`ca`, `ca_cert`, or `ca_certificate`) or the foundation's `CF_SYSTEM_CERT_PATH`
file/directory. The apps refuse to start without trusted CA material; they do
not disable certificate checks to connect. The worker already requires verified
TLS independently. Existing configurations that omit `databaseTls` retain their
previous core-database behavior; that compatibility does not establish TLS.

Some brokers supply a PostgreSQL URI without SSL options even for a database
that rejects plaintext connections. The adapter therefore configures TLS
explicitly. It also removes URI SSL options before passing a separate trust
object to node-postgres, whose URL parser otherwise replaces that object. See
[node-postgres SSL configuration](https://node-postgres.com/features/ssl) and
[SQLx PostgreSQL options](https://docs.rs/sqlx/latest/sqlx/postgres/struct.PgConnectOptions.html).

Select the target through the repository wrapper, which uses a dedicated local CF home and verifies the configured API/org/space:

```sh
scripts/cf-login.sh
node scripts/cf.mjs --verify-target
```

Review the exact service inventory and plans, then create missing services only after checking the output:

```sh
node scripts/provision.mjs --plan
node scripts/provision.mjs --apply --wait
```

`--apply` provisions services; it is not a dry run. The plan reports expected and existing offerings/plans and stops on mismatches. Inspect broker operations before retrying a failed or timed-out create.

## Package and deploy

Build and package the pinned Buzz `sprig` worker binary for Linux/amd64 in the included container builder, or use the lower-level packaging command with a compatible binary you already built:

```sh
scripts/build-agent.sh
# Alternative when sprig is already available:
scripts/package-agent.sh /absolute/path/to/sprig
scripts/package-relay.sh
scripts/package-identity.sh
scripts/build-desktop.sh
```

The desktop command builds an unsigned macOS app under `artifacts/desktop/PROFILE/`. Have the organization sign, notarize, and distribute it through its approved route before team installation. The build script checks out the upstream Buzz revision pinned by this repository and applies the maintained patch.

Prepare app identities and rendered manifests, then deploy in dependency order:

```sh
node scripts/deploy.mjs prepare-apps
node scripts/deploy.mjs identity
node scripts/deploy.mjs relay
node scripts/deploy.mjs tools
node scripts/deploy.mjs register-mcp
node scripts/deploy.mjs native-agent
node scripts/deploy.mjs worker
```

The rendered manifests are generated in ignored `.state/`; inspect them locally before pushing. The MCP backend included here exposes a read-only pilot document tool. The native Buildpack application is a separate internal app, with shell and filesystem access disabled in its manifest. The worker calls its chat endpoint through the custom ACP adapter.

Authenticate the operator and enroll the default `helper` identity:

```sh
node scripts/login.mjs
node apps/identity/tools/enroll-agent.mjs --agent helper
node scripts/deploy.mjs admit-owner
node scripts/activate-agent.mjs --agent helper
```

`admit-owner` is a separate relay membership step for the shared pilot-owner
identity; activation does not add relay members. Enrollment and activation
write/read private per-agent files under ignored `.credentials/`; never copy
the private binding to teammates. Activation creates or updates the agent's
CredHub identity service, pushes its dedicated CF app, publishes its display-name
profile and owner-signed directory policy, and starts one task. The directory
policy mirrors the configured `owner-only` or explicit `allowlist` response
policy; it does not add channel membership. Activation requires the same
owner's current operator SSO session. The
agent's lock is derived from its public key in the worker PostgreSQL service.
For another agent, set its `agents` config as described in
[Agents in Buzz](agents.md), then use the same name for enrollment and
activation.

Run the deployment probe and review status:

```sh
node scripts/deploy.mjs probe
node scripts/deploy.mjs status
```

The probe exercises the native adapter, model, and read-only MCP tool path. It does not validate multiple human accounts, production readiness, or all authorization/lifecycle cases. Record those separately using [the validation guide](tmm-validation.md).

For attendees, use the [workshop onboarding procedure](workshop.md#admit-an-ordinary-participant), which grants ordinary relay membership and keeps each participant's SSO session and desktop key separate from the operator.

## Screenshots for the install guide

The [getting-started guide](getting-started.md) shows the authentic profile sign-in entry point and private channel form. An operator configuration/plan screenshot and a signed installer screenshot have not been captured. Never publish `.credentials/`, private keys, bearer tokens, OIDC authorization codes, or service binding values.
