# 0004. Better Auth for authentication

Use Better Auth for users, sessions, and sign-in methods, and keep authorization in Cohory's own policy module.

- ADR status: Accepted
- Date: 2026-10-17
- Deciders: founder (Better Auth in the brief), architecture docs wave
- Related: [../architecture/authorization.md](../architecture/authorization.md), [../architecture/data-model.md](../architecture/data-model.md) section 3

## Context

**Confirmed:** Better Auth is the preferred authentication library. Requirements: email and password, magic links, session listing and revocation, OAuth providers and TOTP post-MVP, passkeys post-MVP (REQ-ID-001 to 009). One account across communities (REQ-ID-004). Sessions on custom domains ([../architecture/authorization.md](../architecture/authorization.md) section 9).

Research: Formbricks runs Better Auth in production. NextAuth v4, used by several comparable projects, is legacy.

## Decision

- Better Auth with its Drizzle adapter, PostgreSQL storage, and plugins for magic link, two-factor (Post-MVP), and passkeys (post-MVP).
- Better Auth tables are mapped to Cohory naming (`users`, `sessions`, `accounts`) and extended with profile fields.
- Authorization (roles, entitlements, scopes) is not implemented with Better Auth's organization features. It lives in `packages/policy`.
- API tokens and agent tokens are Cohory tables verified by `packages/auth`, not Better Auth sessions.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Auth.js (NextAuth) | Widely known | v4 legacy, credential and magic link handling less complete, session model less flexible | Better Auth is the modern option with a production reference. |
| Custom authentication | Full control | Security-sensitive code to own and audit | Not a differentiator for Cohory. |
| Hosted auth (Clerk, Supabase Auth) | Fast to start | Breaks self-hosting without external services | Contradicts self-hosting principle. |
| Better Auth organizations for roles | Less code | Couples tenant roles to the auth library, harder to combine with entitlements and agent scopes | Policy needs to combine roles, entitlements, scopes, and approvals in one place. |

## Consequences

- Positive: maintained auth flows, plugins for planned features, self-hostable.
- Negative: dependency on a young project. Mitigated by keeping tables in our database and authorization outside the library.
- Follow-up: verify custom table names and extra columns, multiple trusted origins for custom domains, session revocation behavior.

## Open questions

- Whether the cross-domain session handoff needs a custom plugin (**Unverified**).
