# Third party skill notices

Licenses and attribution for the agent skills in this directory that Cohory copies unchanged from other projects.

Status: Accepted, 2026-10-24

These skills keep their own terms. They are not covered by Cohory's AGPL-3.0 license. Each folder is a copy of the upstream skill, installed with the `skills` CLI; [skills-lock.json](../../skills-lock.json) at the repository root records the source path and content hash of each one. The commit column is the upstream default branch at the time of the audit (2026-10-24); the content hash in the lock file identifies the copied version exactly.

## Skills

| Skill | Source | License | Copyright | Upstream commit |
|---|---|---|---|---|
| `code-review` | [mattpocock/skills](https://github.com/mattpocock/skills) (`skills/engineering/code-review`) | MIT | Copyright (c) 2026 Matt Pocock | `5beb35b040e3` |
| `codebase-design` | [mattpocock/skills](https://github.com/mattpocock/skills) (`skills/engineering/codebase-design`) | MIT | Copyright (c) 2026 Matt Pocock | `5beb35b040e3` |
| `improve-codebase-architecture` | [mattpocock/skills](https://github.com/mattpocock/skills) (`skills/engineering/improve-codebase-architecture`) | MIT | Copyright (c) 2026 Matt Pocock | `5beb35b040e3` |
| `hono` | [honojs/skills](https://github.com/honojs/skills) (`skills/hono`) | MIT | Copyright (c) 2026 Yusuke Wada | `e54ce51f6eff` |
| `playwright-best-practices` | [currents-dev/playwright-best-practices-skill](https://github.com/currents-dev/playwright-best-practices-skill) | MIT | Copyright (c) 2026 Currents Software Inc. | `283d5cbc5d11` |
| `security-audit` | [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) (`skills/security-audit`) | MIT | Copyright (c) 2025-2026 Cloudflare, Inc. | `c1c8a8c14710` |
| `stripe-best-practices` | [stripe/ai](https://github.com/stripe/ai) (`skills/stripe-best-practices`) | MIT | Copyright (c) 2024-2025 Stripe | `8a8818e85637` |
| `supabase-postgres-best-practices` | [supabase/agent-skills](https://github.com/supabase/agent-skills) (`skills/supabase-postgres-best-practices`) | MIT | Copyright (c) 2026 Supabase | `c9be0e931b79` |
| `turborepo` | [vercel/turborepo](https://github.com/vercel/turborepo) (`skills/turborepo`) | MIT | Copyright (c) 2026 Vercel, Inc | `8003ff0fe919` |
| `vitest` | [antfu/skills](https://github.com/antfu/skills) (`skills/vitest`) | MIT | Copyright (c) 2025-present Anthony Fu | `8886fe2d385d` |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (`skills/react-best-practices`) | MIT, as stated in the License section of the repository [README](https://github.com/vercel-labs/agent-skills#license) and in the skill's `SKILL.md` frontmatter; the repository has no license file | Vercel | `063bee94c3f4` |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (`skills/web-design-guidelines`) | MIT, as stated in the License section of the repository [README](https://github.com/vercel-labs/agent-skills#license); the repository has no license file | Vercel | `063bee94c3f4` |
| `supply-chain-risk-auditor` | [trailofbits/skills](https://github.com/trailofbits/skills) (`plugins/supply-chain-risk-auditor/skills/supply-chain-risk-auditor`) | CC-BY-SA-4.0 | Trail of Bits | `196a9073ab10` |

## MIT License

The MIT licensed skills above are distributed under the following terms, with the copyright line from the table for each skill.

```text
MIT License

Copyright (c) <year> <copyright holder>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Creative Commons Attribution-ShareAlike 4.0

`supply-chain-risk-auditor` is the work of Trail of Bits, published in [trailofbits/skills](https://github.com/trailofbits/skills) under the [Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/) ([full legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode)). Cohory distributes it unchanged. It stays under CC-BY-SA-4.0, not under Cohory's AGPL-3.0, and any adaptation of it must be shared under the same license.

## Skills without a license statement

| Skill | Source | Upstream commit |
|---|---|---|
| `better-auth-best-practices` | [better-auth/skills](https://github.com/better-auth/skills) (`better-auth/best-practices`) | `20c9e88a5c00` |
| `better-auth-security-best-practices` | [better-auth/skills](https://github.com/better-auth/skills) (`security`) | `20c9e88a5c00` |

The source repository has no license file and states no license. The Better Auth project itself ([better-auth/better-auth](https://github.com/better-auth/better-auth)) is MIT licensed. These two skills are not covered by Cohory's AGPL-3.0 license. They are included unchanged with attribution to their authors, the Better Auth team, and we will remove them on the authors' request.
