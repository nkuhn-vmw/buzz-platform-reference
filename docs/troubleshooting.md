# Troubleshooting

Use the repository wrappers so diagnostic commands stay scoped to the configured CF target. Check the deployment config and verified target before inspecting or retrying anything:

```sh
node scripts/cf.mjs --verify-target
node scripts/deploy.mjs status
```

`scripts/cf.mjs` refuses login, targeting, authentication, API, and context-override operations. Use `scripts/cf-login.sh` to select the configured target.

## Common symptoms

| Symptom | Check |
| --- | --- |
| Login reports target mismatch | Run `scripts/cf-login.sh` and ensure the API, org, and space in `.state/deployment.json` match the operator-approved space. |
| Provision plan shows a mismatch | Do not apply. Confirm the actual marketplace offering and plan with the foundation operator; change the local config only when the intended plan is known. |
| Service is still provisioning | Inspect `node scripts/cf.mjs service SERVICE_NAME`. Wait for the broker operation to finish before retrying. |
| Agent does not answer | Confirm it is in the channel, the message explicitly mentions it, the sender is admitted by the agent's author policy, and a worker task is active. Check sanitized recent logs with `node scripts/cf.mjs logs buzz-agent --recent`. |
| Native agent probe fails | Inspect `buzz-agent`, `buzz-platform-agent`, and the bound AI/Gateway services with `node scripts/deploy.mjs status`; then check recent logs for the worker and platform agent. Verify the model supports tool calls and Gateway binding is healthy. |
| Agent repeats or appears stuck | Inspect task state and recent logs before retrying. Check the configured dedicated PostgreSQL binding and lease errors. Do not start duplicate tasks as a recovery shortcut. |
| Agent activation refuses the database | The worker requires verified TLS and a dedicated direct connection for its session lock. The private pilot verified TLS 1.3 and the certificate in the Helper task; for another target, inspect the binding, CA chain, and direct-connection support before retrying. |
| Desktop connects but sign-in fails | Ask the operator to verify the configured OIDC issuer/provider and allowed-user policy. Do not send authorization codes or session data in chat. |

To inspect known CF objects through the verified wrapper:

```sh
node scripts/cf.mjs apps
node scripts/cf.mjs services
node scripts/cf.mjs tasks buzz-agent
node scripts/cf.mjs logs buzz-agent --recent
node scripts/cf.mjs events
```

Review output before sharing it. Redact routes, user identifiers, request bodies, environment values, and service details that identify a private deployment. Never publish `.credentials/` or `.state/` contents. For suspected vulnerabilities, follow [SECURITY.md](../SECURITY.md).
