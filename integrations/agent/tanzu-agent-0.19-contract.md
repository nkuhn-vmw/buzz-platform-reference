# Native runtime compatibility

Verified against Tanzu Agent Buildpack 0.2.53 and runtime 0.19.0 in the reference pilot. These versions are supplied by the foundation, not bundled in this repository. Re-run the native probe when upgrading them.

## Chat and authentication

The ACP bridge uses the native `/api/chat` HTTP endpoint and translates the streamed AI SDK events into ACP text/tool events. It does not send the Buzz private key or owner grant to the native service. The native service has only an internal CF route; a C2C policy admits its worker. No incoming per-user Bearer-token delegation is implemented.

The runtime's browser SSO integration uses its own authenticated browser session. Binding Credential Store alone does not make the ACP bridge a user-authenticated browser client. The optional Credential Store service is provisioned for extension work; per-user credential delegation is not proven by this pilot.

## Operator-provided MCP access

Use a CredHub binding tagged `mcp-server`, with flat credentials `{ "url": "https://gateway.example.invalid/tool/mcp", "api_key": "OPERATOR_PROVIDED_SECRET" }`. This runtime uses `api_key` as its machine Bearer credential. In the observed version, placing Authorization only in `headers` caused interactive authentication discovery instead of immediate tool availability. Never put a real key in a manifest or source file.

The reference Gateway registration forwards that scoped token to the read-only document backend. The backend rejects missing/wrong tokens and serves only the two named documents. The live native probe verifies actual model/tool execution using a backend-generated nonce; a binding or health check alone is insufficient evidence.

## Session and cancellation limits

The adapter keeps native model history in memory and advertises no ACP session reload. A replacement worker rebuilds context from durable relay messages. Cancelling an ACP turn aborts the HTTP request; it does not prove that the model server immediately stopped inference. Shell, filesystem access and the native debug UI are disabled in the generated manifest.
