# Security policy

This repository is a pilot reference. Do not use it as evidence that a deployment, service plan, or tool integration is production-ready.

## Report a vulnerability privately

Use the repository host's private vulnerability reporting feature for this repository when it is enabled. If private reporting is unavailable, contact a repository maintainer through an established private channel and ask for a secure reporting route. Do not open a public issue with an exploitable detail, access token, private key, grant, service credential, personal data, or raw conversation.

Include the affected revision and component, impact, reproduction steps that do not expose real credentials, and a safe contact method. There is no published response-time commitment. Coordinate public disclosure with the maintainers after a fix or mitigation is available.

## Deployment handling

Keep `.state/`, `.credentials/`, rendered manifests, deployment logs, and service parameters private. Use a dedicated CF org/space and operator-approved service plans. Agent tools execute with the worker app's privileges; a tool running arbitrary code must be treated as able to use those privileges. Review tool bindings and the CF app identity before enabling additional tools.
