# 0023. Agent course delivery: tools on REST routes, signed links, one license source, and lapsed agents

Delegated agents read courses through MCP tools that run REST routes, large files and skill zips go out through short lived signed links that check access again, license terms have one source, and an agent whose person's membership ended may only propose buying it back.

Status: Accepted, 2026-10-19

- ADR status: Accepted (founder, 2026-10-19, as built)
- Date: 2026-10-19
- Deciders: Step 15 unit T3 (proposed)
- Related: [0019](0019-mcp-dispatch-through-http-handlers.md), [0021](0021-agent-course-format-and-storage.md), [0022](0022-delegated-entitlements.md), [../architecture/agent-integrations.md](../architecture/agent-integrations.md) sections 9 and 11, [../architecture/evaluation-runner.md](../architecture/evaluation-runner.md)

## Context

Phase 7 asks that a person buys a course, delegates read access to their agent, and the agent retrieves lessons and exercises through the API or MCP; that delegation is revocable and limited to the course; that downloaded skills and external content are never run with elevated permissions; and that results are attributable to an agent, a version, and a run. After T1 and T2, the agent material routes existed but had no MCP tools, files and the skill zip were binary responses an MCP tool cannot return, the skill zip was staff only, license terms lived in two places (per version in T1, per course in T2, with different ids), and an agent's purchase proposal could never succeed: agent tokens stop working when their person is no longer a member, and every member already has every course.

## Decision

- **Tools on REST routes.** The MCP tools are declared through `routeMeta(...).mcp` on existing routes (material, task, submissions, list submissions, checkout) and three new JSON routes: `GET /communities/{slug}/agent-courses`, `GET .../courses/{courseId}/agent-material/file-content`, and `GET .../courses/{courseId}/agent-export`. All reads and submissions use `courses:read`. Course material results carry `untrusted_content` with the source `cohory course material` and a notice that scripts run only in the reader's own sandbox.
- **Signed links.** Binary files and the skill zip are returned as links to `GET /communities/{slug}/agent-downloads/{token}`. The token is an HMAC SHA-256 over the grant (kind, community, course, exact version, path, person, agent, expiry) with a key derived by HKDF from `BETTER_AUTH_SECRET` (info `cohory.agent-downloads.v1`), valid for 5 minutes. On use, the server checks the signature, expiry, and community slug, and for agents checks the delegation again, then reads as the person.
- **Skill zip for readers.** Delegated agents, agents of owners and admins, and people with course access may get the link; people need the creator's Allow agent access. The staff export route stays as it was.
- **One license source.** The course's agent access settings (T2) are the terms. Publishing reads them and maps `personal_agents`, `team_agents`, and `custom` to the manifest ids `personal-agent-use`, `team-agent-use` (new, format 1.1.0), and `custom` in one module. The publish body's `license` is optional and a different id is refused.
- **Submissions checked.** A result must name a lesson, task, and version that exist in the published material.
- **Lapsed agents.** When a person's membership is removed (not banned), their personal agent that holds `proposals:write` is not suspended. Its token authenticates with a lapsed standing, scopes narrowed to `courses:read` and `proposals:write`, and the bearer middleware and MCP allow only the checkout proposal and reading its own approval requests. The person may list, approve, and decline their own purchase requests without being a member.
- **Reference runner.** `@cohory/agent-runner` runs JSON Schema checks locally, never scripts, and talks only to the cohory origin.

## Consequences

- An agent reads a course end to end through MCP with the same permissions and errors as REST.
- A revoked delegation stops links already handed out on their next use; a link can be reused by anyone holding it for up to 5 minutes while access lasts.
- Rotating `BETTER_AUTH_SECRET` invalidates outstanding links, which is harmless.
- The purchase journey is real for the renewal case. A person who never joined still joins and pays themselves.
- Agents of people who left keep a narrow ability to ask them to buy the membership. Agents without `proposals:write`, community wide agents, and agents of banned people are still suspended.
- No migration: published versions are immutable and keep the terms they were published with.

## Alternatives considered

- **A `courses:submit` scope for results.** Rejected: existing delegated agents would lose the ability to report, and submission is already limited to the agent's own delegated courses.
- **Streaming files through MCP as base64.** Rejected: results are capped at 100 kB and binary content in a text result invites misuse.
- **Per course prices so a member can lack a course.** Out of scope; course access stays community membership.
- **Migration 0025 to rewrite stored versions or backfill settings.** Rejected: versions are immutable and checksummed, and settings already default to the same terms as T1's default.
- **Hosted evaluation.** Out of scope; results stay self reported.
