# 0022. Delegated course entitlements derived on every check

A member lends read access to a course to one of their own agents; the agent's access is recomputed from the member's own access on every request, and nothing about the member's entitlement is copied.

- ADR status: Accepted (founder, 2026-10-19, as built)
- Date: 2026-10-19
- Deciders: Step 15 unit T2 (proposed)
- Related: [0017](0017-bearer-api-tokens.md), [0018](0018-approvals-replay-recorded-requests.md), [../architecture/authorization.md](../architecture/authorization.md) sections 4.4, 6, 7, and 8, [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 11.5

## Context

Phase 7 asks that a person who has a course can let their agent read it (REQ-ENT-004), with the constraints in agent-integrations section 11.5: derived from the person's entitlement and ending with it, read only, revocable, expiring by default, no re delegation, purchases only by a person, and a creator opt in with license terms. Course access today is derived on read from membership, subscription, and comp state in Payments (`resolveMembershipAccess`); there is no entitlements table. Agent tokens already act as their owning person, so before this step any agent of a member with `courses:read` could read every course its person could.

## Decision

- Add an Entitlements module (`@cohory/entitlements`) that owns `course_agent_settings`, `course_delegations`, and `agent_submissions` and is the only place that answers whether an agent may read a course: `agentCourseAccess(actor, communityId, courseId)` and `assertAgentCourseAccess(...)`. Courses (and the agent material services) ask it; they do not compute access from delegations themselves.
- Store only the delegation itself (course, person, agent, granted, expires, renewed, revoked with a reason). On every check, recompute from live facts: the person's own access from Payments (`getMembershipAccess`), the agent's status and owner, the creator's setting, and the delegation row. A daily job only records why a delegation ended and sends the 3 day notice; it is never needed for correctness.
- (Amended by the Step 15 verifier.) A delegation belongs to one stretch of membership: when it was granted before the person's current membership began (`joined_at`), it is ended on the next check, so it never comes back when a membership returns before the daily job. Pausing an agent pauses its delegations; only revoking or removing the agent ends them. The answer never depends on whether the job ran.
- Agent tokens of members and moderators need a delegation for course content; agents of owners and admins keep implicit access because their person has it and they author courses.
- Reuse the `courses:read` scope rather than adding a delegation scope. The delegation is the grant; the scope only says the token may read courses at all.
- Delegations and course agent settings are managed from a signed in session only and are non grantable to tokens; the service also refuses any credential, so an agent can never create or extend access.
- Let members create their own agents with read scopes and `proposals:write`, since delegation needs an agent the member owns.
- Purchases by agents become approval requests in a new `purchase` category that only the agent's own person decides; approving starts Checkout for that person and the checkout link is not stored or shown to the agent.
- Results are stored as self reported, keyed by course id plus text lesson id, task id, and agent material version, without foreign keys to the agent material tables, so agent material versions can change without breaking results.

## Consequences

- Access ends on the next request when the person's access, the agent, the creator's setting, or the delegation ends, with no reconciliation lag. Each agent course read costs a few extra queries (agent, person's access, setting, delegation).
- Agents of members lose course access they had implicitly before this step until their person delegates. This is listed under Changed in the changelog.
- Two sources of truth are avoided: there is still no entitlements table for people; if one is added later, the delegation check switches its input without changing its contract.
- Creators see result counts but not other members' payloads.

## Alternatives considered

- **Copy an entitlement row for the agent when delegating.** Rejected: it needs revocation fan out on every subscription, membership, comp, and agent change, and a missed event leaves access open.
- **A separate `courses:delegated` scope.** Rejected: a second read scope confuses token and consent screens, and the scope cannot express the per course grant anyway.
- **Owners and admins approve agent purchases in Manage, Approvals.** Rejected: the buyer is the agent's person, and staff cannot buy for them.
