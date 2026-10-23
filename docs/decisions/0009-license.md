# 0009. License: AGPL-3.0 core and MIT SDK

License the core application under AGPL-3.0 and the SDK, API client, and plugin templates under MIT.

Status: Accepted, 2026-10-19

- ADR status: Accepted (founder, 2026-10-19). The plugin exception wording awaits legal review.
- Date: 2026-10-17, accepted 2026-10-19
- Deciders: founder
- Related: [../research/comparable-projects.md](../research/comparable-projects.md) section b and Appendix A, [../foundation/business-model.md](../foundation/business-model.md)

## Context

**Confirmed** in the brief: a genuine open-source self-hosted edition. Evaluate AGPL-3.0, Apache-2.0, and MIT with trade-offs, and do not select without documenting commercial and legal implications. Cloud infrastructure must not prevent self-hosting the core.

Cohory earns revenue from the 2% fee on Cloud transactions, collected through cohory's Stripe Connect platform, not from gated features. Self-hosters cannot use cohory's Connect platform without cohory's cooperation, so the fee does not depend on code ownership.

Nothing here is legal advice. A lawyer should review the final choice.

## Decision

- Core (`apps/*`, `packages/*` except below): AGPL-3.0.
- `packages/sdk`, the generated API client, and plugin templates: MIT.
- An explicit exception stating that plugins using only the public SDK and API are not derivative works of the core, modeled on the exception Twenty uses (exact wording for legal review).
- No `ee/` folder, no license keys, no source-available parts.
- DCO (`Signed-off-by`) for contributions, no CLA.

As built in Step 16: the root [LICENSE](../../LICENSE) holds the full AGPL-3.0 text, `packages/sdk/LICENSE` and `packages/agent-runner/LICENSE` hold the MIT text with "cohory contributors", every `package.json` has a `license` field (`AGPL-3.0-only`, or `MIT` for the SDK and the agent runner), [LICENSING.md](../../LICENSING.md) explains the split and carries the draft plugin exception, and `.github/workflows/dco.yml` checks the sign-off on every pull request commit. The agent runner is MIT too, because agents and their operators run it outside cohory. No plugin templates exist yet; they get MIT when added.

## Alternatives considered

| Option | Commercial implications | Legal implications | Community implications |
|---|---|---|---|
| AGPL-3.0 core + MIT SDK (recommended) | Competitors may host cohory but must publish their modifications; a closed hosted fork is not allowed | Network clause requires offering source to users of modified versions over a network; some companies have policies against AGPL | Plugin authors stay free through MIT SDK; some enterprises and agencies avoid AGPL |
| Apache-2.0 | Anyone, including large competitors, may run a closed hosted fork | Explicit patent grant and patent retaliation; permissive | Highest enterprise comfort with a patent grant; contributions easy to accept |
| MIT | Same as Apache-2.0: closed hosted forks allowed | Short, permissive, no explicit patent grant | Maximum adoption (Ghost, Payload precedent); moat is brand, hosting, and payments integration |
| AGPL + `ee/` commercial folder | Feature gating possible | Two licenses in one repo, license keys | Contributor confusion; unnecessary because revenue is not feature-based |
| Fair source (FSL) | Strong protection for two years | Not OSI open source | Contradicts "open-source Skool alternative" positioning |

Notes:

- Relicensing later is possible only with the agreement of all copyright holders, or with a CLA collected from the start. AGPL to MIT later is easy for the community to accept. MIT to AGPL later is effectively impossible for existing code.
- AGPL does not restrict creators who self-host for their own community. Obligations apply to people who modify cohory and offer it to others over a network.

## Consequences

- Positive (AGPL): protects against a closed hosted competitor built on cohory, aligns with the ownership message.
- Negative (AGPL): some agencies and companies will not adopt or contribute; the "developer platform" goal is harder.
- Follow-up: LICENSE files per package, the plugin exception text, and the DCO check in CI are done (Step 16). SPDX headers per file are not added.

## Open questions

- **Decided** (founder, 2026-10-19): AGPL-3.0 core with MIT SDK, generated client, and plugin templates.
- **Decided** (founder, 2026-10-19): DCO, no CLA.
- **Open question:** legal review of the plugin exception wording and the per package split (human gate before the first public release).
