# Native Credential Store workshop companion

This optional application demonstrates the native Tanzu Agent Buildpack path alongside Buzz. Buzz's ACP bridge does **not** forward a user's platform identity to the native runtime. Keep the two demonstrations separate.

The reference companion and protected MCP backend are deployed on Cloud Foundry. Both real SSO accounts have authenticated independently. A live user A call returned receipt A; user B, with no saved credential, was denied by the Store without using A's credential. Both users have now saved their own entries. The remaining both-configured and deletion checks are **not yet accepted**. See [deployment validation](tmm-validation.md) for the recorded evidence.

```mermaid
flowchart LR
  A[Browser A] --> Gate[Exact-email SSO gate]
  B[Browser B] --> Gate
  Gate --> Native[Native Agent Buildpack UI\nindependent App SSO session]
  Native --> AI[AI Services model]
  Native --> Gateway[MCP Gateway]
  Gateway --> Store[Credential Store\nuser-scoped credential resolution]
  Gateway --> Backend[Internal synthetic MCP backend]
  Keys[CredHub backend keys] --> Backend
  Backend --> Receipt[A or B label + fresh nonce]
```

## What this proves—and what it does not

The backend accepts two distinct random credentials and returns a non-secret `A` or `B` label plus a fresh nonce. It selects the label from the validated credential, never from the model's prompt or tool arguments. No real business system or personal dataset is connected.

The tested foundation is configured to resolve across issuers by **email**, with matching identity-provider origins disabled. Foundation UAA and App SSO are separate identity namespaces. The observed success demonstrates email-based credential resolution for a controlled test account; it does not establish issuer/subject isolation or production suitability. An account in a trusted issuer with the same email may resolve the same credential. Verify provider ownership and email-verification policy before using this pattern.

The exact-email proxy and native agent have separate SSO sessions. The proxy's allowlist does not enforce equality with the native session. Use separate browser profiles, verify **both** identities before each test, and stop if they differ. This is a documented test precondition, not an enforced native identity boundary. The gate rejects an explicitly unverified email; its upstream default permits an absent verification claim, so inspect actual provider behavior. Do not add an unverified-email override.

The companion uses one instance. Restart rotates its gate cookie key and requires signing in again. Native runtime 0.19.0 also retains MCP identity in memory; finish deployment before login. A surviving browser session after restart does not prove the MCP connection has usable identity.

## Deploy in a dedicated space

Use a separate CF space containing only synthetic workshop resources. Application SSO admission does not authorize CF role grants. Confirm the least role needed for each attendee's own Credential Store management; do not grant SpaceDeveloper merely to make the screen appear. SpaceDeveloper can read bindings and change apps. Inspection of the deployed reference service confirmed that `SpaceAuditor` is accepted for managing one’s own credentials; store-scoped writes require `SpaceManager`. Both approved participants successfully saved their own entries with only SpaceAuditor in this space and the required OrgUser membership. Obtain explicit approval before adding those roles. See [CF role permissions](https://docs.cloudfoundry.org/concepts/roles.html).

Create a private deployment configuration using the [installation guide](install.md), with a dedicated `space`, `routePrefix`, `cfHome`, `stateDir`, and `credentialsDir`. Keep the two exact approved emails in `allowedEmails`. Point `BUZZ_DEPLOYMENT_CONFIG` to that file for **every** command below; the CF wrapper refuses an API/org/space mismatch. Authenticate its isolated CF home normally; never copy a token file from another context.

Create these services using plans available in your marketplace:

| Instance name | Offering / reference plan | Binding |
| --- | --- | --- |
| `buzz-workshop-ai` | `ai-models` / model plan | Native agent |
| `buzz-workshop-sso` | `p-identity` / configured SSO plan | Native agent; Gateway OIDC configuration |
| `buzz-workshop-gateway` | `mcp-gateway` / `gateway` | Protected backend |
| `buzz-workshop-credentials` | `credential-store` / `shared` | Native agent only |
| `buzz-workshop-backend-keys` | `credhub` / `default` | Protected backend only |

`shared` is the service plan name. It does not mean credentials must use store scope. The acceptance exercise uses **user** scope only, with no shared fallback and no second bound store.

Generate two synthetic backend tokens into an ignored private file, without printing them:

```sh
mkdir -p .credentials/workshop
node --input-type=module <<'JS'
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
writeFileSync('.credentials/workshop/backend-keys.json', JSON.stringify({
  TOKEN_A: randomBytes(32).toString('hex'),
  TOKEN_B: randomBytes(32).toString('hex'),
}), { mode: 0o600, flag: 'wx' });
JS
node scripts/cf.mjs create-service credhub default buzz-workshop-backend-keys \
  -c .credentials/workshop/backend-keys.json
```

The file must remain private and excluded from pushes. Do not recreate it during an existing deployment; that would leave backend and saved credentials inconsistent.

Prepare an ignored `.state/workshop-vars.yml`:

```yaml
node-stack: YOUR_NODE_STACK
agent-stack: YOUR_AGENT_BUILDPACK_STACK
route-prefix: YOUR_UNIQUE_PREFIX
domain: apps.example.invalid
model: YOUR_MODEL_NAME
allowed-emails: attendee-a@example.invalid,attendee-b@example.invalid
sso-provider: YOUR_CONFIGURED_IDENTITY_PROVIDER
```

Deploy the backend, bind it to the Gateway using the SSO service, and wait for the asynchronous binding to succeed before restaging:

```sh
node scripts/cf.mjs push buzz-workshop-receipts -p apps/workshop-mcp \
  -f apps/workshop-mcp/manifest.yml --vars-file .state/workshop-vars.yml
node scripts/cf.mjs bind-service buzz-workshop-receipts buzz-workshop-gateway \
  -c '{"auth":{"service-instance":{"type":"OIDC","name":"buzz-workshop-sso"}}}'
node scripts/cf.mjs service buzz-workshop-gateway
# Run after the binding reports create succeeded:
node scripts/cf.mjs restage buzz-workshop-receipts
```

The backend has only an internal route. Verify the broker-created network policy from the exact Gateway app to this backend. The observed broker used its container TLS port `61443`; do not add broad network access or assume port `8080`.

Read the Gateway's advertised dashboard origin from `cf service`. Create a user-provided MCP descriptor tagged `mcp-server`, containing only its protected MCP URL and authentication type. The tested broker exposes the app-specific path below; its root `/mcp` returned 404. Verify an unauthenticated request to the selected route returns an OIDC `WWW-Authenticate` challenge before staging the agent:

```sh
node scripts/cf.mjs create-user-provided-service buzz-workshop-receipt-mcp \
  -p '{"url":"https://YOUR_GATEWAY_ORIGIN/buzz-workshop-receipts/mcp","auth_type":"bearer"}' -t mcp-server
```

Do not put either backend token in this descriptor. The agent receives the SSO, model, store and descriptor bindings; it does not receive the backend's CredHub binding.

Before the **first** SSO binding, create the app and set broker registration hints. Replace the example route and provider:

```sh
node scripts/cf.mjs create-app buzz-workshop-agent
node scripts/cf.mjs set-env buzz-workshop-agent SSO_SCOPES openid
node scripts/cf.mjs set-env buzz-workshop-agent SSO_AUTO_APPROVED_SCOPES openid
node scripts/cf.mjs set-env buzz-workshop-agent SSO_IDENTITY_PROVIDERS YOUR_PROVIDER
node scripts/cf.mjs set-env buzz-workshop-agent SSO_REDIRECT_URIS \
  'https://YOUR_AGENT_ROUTE/oauth2/callback,https://YOUR_AGENT_ROUTE/api/auth/callback'
bash scripts/package-workshop-agent.sh
node scripts/cf.mjs push buzz-workshop-agent -p artifacts/workshop-agent \
  -f apps/workshop-agent/manifest.yml --vars-file .state/workshop-vars.yml
```

Packaging verifies the official OAuth2 Proxy 7.15.5 archive SHA-256 and includes its license. The launcher keeps the native agent on loopback and runs the gate on the CF route port. Shell and filesystem tools, admin/debug UI, and the native token endpoint are disabled. Native API/A2A bearer clients cannot bypass the browser gate; this route is for the workshop UI.

Verify `/health` returns 200 and unauthenticated `/`, `/api/chat`, `/api/auth/status`, and `/.well-known/agent-card.json` redirect to the SSO login. Inspect actual listening sockets to confirm the native agent uses `127.0.0.1:8091`. Do not treat CF's green health indicator as authentication evidence.

## Save credentials as the actual users

Each participant signs into the foundation's Credential Store management flow as themselves. Verify the management email and native App SSO email match exactly, and that neither session is the administrator's. Record the issuer/subject correspondence privately. Never relabel an operator-owned entry as a participant's.

The reference deployment’s standalone Store UI sign-in was rejected by its identity provider because its UAA-host callback was not registered. The normal `cf login --sso` flow on the foundation’s login host successfully authenticated both users independently. Before the scoped role grant, Store metadata returned 404; after the approved SpaceAuditor grants, each user's own bearer token could read their metadata and save their user-scoped entry. These are separate authentication and authorization checks. Do not loosen callback validation, use the administrator’s identity, or claim the standalone UI login passed.

Use a separate browser profile for each account. An existing corporate session in one Chrome profile does not sign a different profile into App SSO. Verify the exact-email gate identity and the native agent's displayed identity independently before the tool call. The reference rehearsal checked both identities for A and B.

Use the deployed service's OpenAPI contract. The reference contract exposes:

- `GET /api/stores/{store_id}/resources` for current-user metadata.
- `POST /api/stores/{store_id}/credentials` to save a static credential.
- `DELETE /api/stores/{store_id}/credentials?resourceName={resource_name}&scope=user` to remove that user's entry.

The store ID is the service-instance GUID. The resource name is **`buzz-workshop-receipt-mcp`**, the descriptor name—not the backend app name. The save body is:

```json
{
  "resourceName": "buzz-workshop-receipt-mcp",
  "headers": {"Authorization": "Bearer USER_SPECIFIC_SYNTHETIC_TOKEN"},
  "scope": "user",
  "description": "Disposable workshop credential"
}
```

Keep the bearer token and management access token out of prompts, shell arguments, logs, screenshots and source control. Use private input or an approved secrets workflow. The Gateway-to-Store `/v1/resolve` endpoint is an internal mTLS contract; do not call it as an agent-side SDK.

A prior native rehearsal found that Hub inferred OAuth for this OIDC Gateway even though the backend needs a static bearer credential. Its static-save API worked, but that does not establish vendor support policy for API-based creation. If Hub will not offer the static type, record the limitation and confirm the approved management workflow. Do not switch off Gateway authentication or move the secret into the descriptor.

## Rehearse the isolation and deletion sequence

Use a new conversation for each step. Ask: **“Call workshop_credential_receipt now and report its actual principal label and nonce. If the tool fails, report the failure.”** Read the actual tool result, then match its nonce in the backend log. Model prose alone is insufficient. Require a successful A receipt on this exact deployment before interpreting any denied call. That positive control establishes path rewriting, backend reachability and permission to call the MCP tool.

For every denial, record the actual Gateway/Store cause. Only a missing credential for the intended authenticated user counts as the expected denial. Stale native identity, tool-permission refusal, OIDC failure, timeout or an unreachable backend is **inconclusive**. Resolve that cause and repeat the affected step; never count generic connection failure as isolation.

| Phase | A | B | Required evidence |
| --- | --- | --- | --- |
| Only A configured | Gets label A | Fails; no receipt | No store-scoped entry; no A usage attributed to B |
| Both configured | Gets label A | Gets label B | Distinct fresh nonces matched to backend logs |
| A deletes own entry | Fresh call fails | Still gets label B | Record deletion-to-denial delay; B remains unaffected |
| Cross-user management | Own metadata only | Own metadata only | No access to the other user's saved entry or secret |

Verify that the provider asserts verified, controlled email identities. Verify the store's debug endpoints cannot expose other users' credentials. Keep real emails, subjects, public keys and token values in private operations only; public evidence uses A/B labels.

Static-token deletion does not test OAuth refresh or expiry. Do not advertise those without a separate supported live exercise. If the native MCP panel asks to connect again after a restart, sign into the native agent afresh and retry the connection; check the existing credential before saving a duplicate.

## End the workshop

Delete each disposable user-scoped credential while signed in as its owner, verify the metadata and a denied fresh tool call, then stop the two workshop apps if no longer needed. Remove any temporary attendee CF roles through the approved access-management process. Removing an email from `APP_ALLOWED_EMAILS` requires an app restart, which rotates the cookie key and ends all gate sessions. Preserve the original Buzz deployment. Keep this exercise marked incomplete until every required success and denial has actual evidence.
