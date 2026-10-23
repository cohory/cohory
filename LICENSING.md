# Licensing

How Cohory is licensed, which parts use which license, and the plugin exception.

Status: Accepted, 2026-10-19 (founder decision; the exception wording awaits legal review)

## Summary

| Part | License | File |
|---|---|---|
| Everything in this repository unless listed below (`apps/*`, `packages/*`, `docker/`, `scripts/`, docs) | GNU Affero General Public License, version 3 only (`AGPL-3.0-only`) | [LICENSE](LICENSE) |
| `packages/sdk` (the public SDK and the generated API client in `packages/sdk/src/schema.ts`) | MIT | [packages/sdk/LICENSE](packages/sdk/LICENSE) |
| `packages/agent-runner` (the reference runner agents use to work through course tasks) | MIT | [packages/agent-runner/LICENSE](packages/agent-runner/LICENSE) |
| Plugin templates, when they are added | MIT | A `LICENSE` file in each template |
| Agent skills in `.claude/skills` adapted from pstack | AGPL-3.0-only for the adaptations; the pstack MIT notice is kept | [.claude/skills/LICENSE-pstack](.claude/skills/LICENSE-pstack) |
| Third party agent skills in `.claude/skills` copied unchanged | Their own terms, not the AGPL: MIT for most, CC-BY-SA-4.0 for `supply-chain-risk-auditor`, and no stated license for the two Better Auth skills | [.claude/skills/THIRD_PARTY_NOTICES.md](.claude/skills/THIRD_PARTY_NOTICES.md) |

Every `package.json` carries its `license` field (`AGPL-3.0-only` or `MIT`), private packages included. The MIT packages depend on AGPL packages only at build time (the SDK generator reads the API's OpenAPI document), so their published code is MIT on its own.

The reasoning is in [decision 0009](docs/decisions/0009-license.md).

## What the AGPL means for you

- **Creators who self-host** for their own community have no extra obligations. Run it, change it, and keep your data.
- **Anyone who modifies Cohory and lets other people use it over a network** must offer those people the source of the modified version under the AGPL. Set `SOURCE_URL` to your copy of the code and every page footer shows a "Source code" link with the version ([self-hosting](docs/self-hosting.md#legal-pages-and-contact)).
- **Code you write against the SDK, the REST API, the MCP server, or webhooks** is covered by the plugin exception below.

## Plugin exception (draft for legal review)

**Draft.** This wording is modeled on the exceptions other AGPL projects with an MIT SDK publish (Twenty among them). It has not been reviewed by a lawyer yet and may change before the first public release. Nothing here is legal advice.

> As an additional permission under section 7 of the GNU Affero General Public License, version 3, the copyright holders of Cohory give you permission to create, use, and distribute programs ("plugins") that interact with Cohory only through its public interfaces, under terms of your choice, without those programs being covered by the GNU AGPL. The public interfaces are the HTTP API under `/api/v1`, the MCP server at `/mcp`, outgoing webhooks, the OAuth endpoints, and the MIT licensed packages listed in LICENSING.md. This permission does not cover modifications of Cohory itself or works that copy or link Cohory's AGPL code, and it does not change the obligations of anyone who modifies Cohory and offers it to users over a network.

## Contributions

Contributions are accepted under the license of the part they change, with a Developer Certificate of Origin sign-off on every commit and no Contributor License Agreement. See [CONTRIBUTING.md](CONTRIBUTING.md#developer-certificate-of-origin).

## Decisions and open questions

- **Confirmed** (founder, 2026-10-19): AGPL-3.0 core, MIT for the SDK, the generated API client, the agent runner, and plugin templates, with a plugin exception.
- **Confirmed** (founder, 2026-10-19): DCO sign-off, no CLA.
- **Open question:** final wording of the plugin exception, after legal review (a human gate before the first public release).
