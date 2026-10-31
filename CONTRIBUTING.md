# Contributing

Contributions should keep the repository a reproducible, operator-configured reference. Start with a focused issue or pull request describing the user-visible problem, changed behavior, deployment assumptions, and evidence.

## Before submitting

- Keep environment-specific values, credentials, rendered manifests, generated binaries, and screenshots containing private user content out of commits. Sanitized captures of an authorized demo are welcome.
- Update the relevant operator or user guide when commands, permissions, runtime behavior, or validation status changes.
- Separate source support, local test results, a CF deployment, and live end-to-end evidence in the pull request description.
- Run the narrow existing test suite for the changed component. Useful commands include `npm test --prefix apps/identity`, `npm test --prefix apps/relay`, `npm test --prefix apps/pilot-mcp`, `npm test --prefix integrations/agent`, and `node --test apps/agent/test/lease.test.mjs` when a PostgreSQL test database is configured.
- For docs-only changes, check relative links, command names against source, and whether status claims have matching evidence.

Do not include private lab identifiers or logs that expose user data, access tokens, service credentials, or grant material. See [SECURITY.md](SECURITY.md) for vulnerability reports.
