# Identity adapter onboarding

## Configure and provision a deployment

Copy `config/deployment.example.json` to the operator-only `.state/deployment.json` and fill in the target foundation, org, space, service offerings/plans, SSO settings, and a small exact email allowlist. Keep this file and `.credentials/` private. `scripts/cf-login.sh` interactively logs into only that configured API/org/space using an isolated `CF_HOME`; subsequent CF commands go through `scripts/cf.mjs`, which refuses context changes and checks the stored target before running them.

Run `node scripts/provision.mjs` to inspect the target and print a plan. It makes no CF changes by default. After reviewing the missing services and expected plans, `node scripts/provision.mjs --apply` creates only missing instances. Existing instances must match the configured offering and plan. Add `--wait` to wait up to 15 minutes for broker operations. Generated secret parameters are kept in mode-600 files under `.credentials/service-parameters/`; the provisioner reuses those values on retry and does not rotate an existing service. The docs service-access instance receives the `mcp-server` CF service tag and starts without gateway credentials; those are added after gateway registration.

The identity service accepts sign-ins only when the verified email address matches an operator-configured exact allowlist. Set `ALLOWED_EMAILS_JSON` on the identity app to a non-empty JSON array of email strings, for example:

```json
["operator@example.org", "pilot@example.org"]
```

The service refuses to start when this setting is missing, malformed, empty, or contains invalid or duplicate addresses. Comparison trims outer whitespace and ignores case; it does not match aliases or email domains. Keep the list small and limited to pilot operators.

## Operator login and enrollment

From the configured candidate checkout, run `node scripts/login.mjs`, then open the URL written to the configured state directory's `login-url.txt`. Complete the deployment's SSO sign-in in a browser. The local operator session is saved with private file permissions under the configured credentials directory. No token or key is printed.

Enroll the default helper agent with:

```sh
node apps/identity/tools/enroll-agent.mjs
```

To enroll another named agent, use a lowercase identifier containing letters, digits, `_` or `-`:

```sh
node apps/identity/tools/enroll-agent.mjs --agent summarizer
```

Every enrollment uses the same dedicated `pilot-owner.json` key, which is distinct from any pre-existing desktop identity. Each agent gets its own key, grant record, enrollment metadata and deployment binding under `credentials/agents/NAME/`. The `helper` profile uses the shared `buzz-agent` app; another name gets its own `buzz-agent-NAME` app and identity grant service. The generated `agent-identity.json` is the sensitive CF Task binding; pass that file to the activation workflow without copying its contents into logs or source control. A repeat enrollment for the same name reuses its key and replaces its grant. Different names have independent agent keys and grants.

On the first enrollment, admit the shared owner identity to the relay as an administrator and wait for that CF Task to succeed. This is a separate, one-time operator action:

```sh
OWNER_PUBKEY=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(".credentials/pilot-owner.json", "utf8")).pubkey)')
node scripts/cf.mjs run-task buzz-relay -c "node launch.mjs add-member --pubkey ${OWNER_PUBKEY} --role admin" --name admit-helper-owner
```

Then activate the helper task with `node scripts/activate-agent.mjs --agent helper` (or omit the flag for the same default). For an additional named agent, use the same name with both enrollment and activation. Activation checks the private enrollment, updates the matching identity service, pushes the agent app in task mode, and starts one CF Task. It refuses to start another task while one is pending or running.

Revoke a grant with `node apps/identity/tools/enroll-agent.mjs --agent NAME --revoke` (or omit `--agent` for `helper`). Revocation prevents further assertions; terminate the corresponding running CF Task to stop an already-running process immediately. The owner key and agent key files remain local so the operator can reproduce or rotate enrollment deliberately.

## Desktop profile

Build the desktop bundle using the deployment's configured isolated demo profile, then run `node scripts/launch-desktop.mjs [path/to/App.app]`. The launcher loads the shared pilot owner key and configured relay. The desktop profile is isolated from an existing desktop installation and uses the deployment's profile-specific keyring entry.
