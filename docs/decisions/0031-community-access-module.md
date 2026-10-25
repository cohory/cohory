# 0031. Entitlements answers community access for every module, through a dependency free entry

Every service and web loader asks Entitlements who the viewer is in a community and whether their access is paid up. The answer comes from `@cohory/entitlements/access`, which applies the paid access rule (grace, comps, cancel at period end, closed billing) instead of treating every active membership as entitled.

- ADR status: Accepted (decision 1 wiring superseded by [0044](0044-composition-roots-and-shared-infrastructure.md))
- Date: 2026-10-22
- Deciders: coordinator as product owner under the founder's mandate (review of 2026-10-21)
- Related: [0022](0022-delegated-entitlements.md), [0029](0029-remove-or-ban-ends-billing.md), [../architecture/authorization.md](../architecture/authorization.md) section 4, [../architecture/payments.md](../architecture/payments.md) section 12.4, AGENTS.md section 2

## Context

Posts, calendar, courses, payments, members, gamification, communities, the agent delegation check, and four web loaders each loaded the viewer's membership and set `entitled: role !== null`. The paid access rule (`resolveMembershipAccess`: subscription state, grace while past due, cancel at period end, comps, and access ending after a creator closed billing) lived in Payments and was used only by the membership page and agent delegations. Posts, calendar, courses, payments, webhooks, and agent token checks also queried the `memberships` table directly.

The two answers agreed for almost everyone, because the subscription handler updates the membership row in the same transaction. They disagreed in one case: after a creator closed billing, a paying member's access ends at their stored period end, but the membership row stays active until `payments.closed-billing-sweep` removes it (every 15 minutes). In that window the content modules still let the member read and post.

AGENTS.md says Entitlements is the only module that answers access questions, but content modules could not import `@cohory/entitlements`. It depended on `@cohory/agents`, `@cohory/notifications`, and `@cohory/payments` to build its default agent delegation service, and `@cohory/notifications` depends on `@cohory/posts`, so the import would have closed a package cycle.

## Decision

1. **Entitlements sits below the content modules.** `@cohory/entitlements` depends only on `@cohory/authz` and `@cohory/db`. The agent directory and the notice sender are ports typed inside Entitlements (`AgentSummary`, `AgentAccessNotice`), and the default delegation service that plugs in the agents service, the notifier, and Payments' `getMembershipAccess` moves to `@cohory/courses/entitlements` (`getEntitlementsService`). Courses owns the agent course features, and its own default service needs the delegation service; the web app, the API, and the worker import it from there.
2. **A dependency free entry.** `@cohory/entitlements/access` exports the paid access rule (`resolveMembershipAccess`, `hasAccess`, and the helpers they use, moved from `packages/payments/src/access.ts`) and the community access helpers. Payments re-exports the rule unchanged and keeps `membershipSyncAction`, which decides how its webhook handler changes the membership row.
3. **One helper per transaction.** `communityAccessIn(queries, userId, now)` returns `{ role, entitled }`. A viewer without an active membership gets `{ role: null, entitled: false }`. For an active membership it reads the viewer's subscription and its connection's close date, and only when those deny, the open comp and whether a plan is on sale, then applies the rule. It reads paid facts as the viewer (`app.user_id`) and restores the caller's setting afterwards, so it works inside any module's community transaction. `getCommunityAccess(scope, userId, now)` wraps it in its own transaction.
4. **Shared reads stay in the database package.** `findMembershipIn` (`repositories/memberships.ts`) and the subscription, closed connection, comp, and plan reads (`repositories/payments.ts`) are transaction scoped helpers in `@cohory/db`. The payments store uses the same subscription and connection reads, so Payments and Entitlements cannot drift on which subscription counts. Webhooks and agent token checks read memberships through `findMembershipIn`.
5. **Every caller asks Entitlements.** Each module's store or repository exposes `findAccess`, and `withAccess` builds its policy context from the answer. The communities service exposes `getAccess(actor, communityId)`, and the web page loader carries `entitled` so button visibility matches the services.

## Behavior changes

- A paying member whose creator closed billing loses member access (posting, commenting, and liking, the classroom, event details and RSVPs, the member directory and leaderboard, and reading the feed of a private community) at their stored period end instead of when the sweep removes their membership up to 15 minutes later. Staff and members with open free access keep access, as before.
- Such a member is never allowed less than a signed out visitor. `post.read` and `comment.read` use the rule `entitled_or_public_community` for members, so they keep reading a public community's feed, and a policy test checks the invariant for every action in the matrix.
- No other outcome changes. Past due members keep access during grace, members who cancel keep access until the period ends, and removed and banned members have no role, as before. Someone with a granting subscription but no active membership (for example a member who left before their period ended) still sees the community as a non member until they join again.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Keep the default delegation service in `@cohory/entitlements` and add a subpath for access | Smallest change | The package still depends on notifications, so importing any entry from posts is a cycle | Cycles are forbidden (AGENTS.md section 2) |
| Build the delegation service in each app | No new entry in courses | The courses default service needs it too, so four places would wire it | One wiring point in courses |
| Host the helper in `@cohory/db` | No package changes | A business rule in the database package, against AGENTS.md | Entitlements can own it now |
| Host the helper in `@cohory/payments` | Payments owns the subscription tables | Every content module would depend on the module that talks to Stripe | Entitlements is the documented owner |
| Keep the membership row as the only answer | No extra reads | Leaves the closed billing window and the copies in place | The review asked for one rule |

## Consequences

- Positive: one rule and one helper, owned by Entitlements, with tests for granted, past due, cancelled at period end, revoked, comp, closed billing, banned, and cross community cases. A change to the rule reaches every module.
- Positive: no module queries `memberships` for its own access check, and the workspace package graph has no cycles.
- Negative: an active member's access check reads one or two more rows (subscription and connection), and two more (comp and plan) when those deny.
- Negative: `@cohory/courses` now depends at runtime on `@cohory/agents`, `@cohory/notifications`, and `@cohory/payments`. Before, agents was a development dependency only. Courses pulls in the notifier and the payments service just to build the default delegation service, and code that needs that service imports `@cohory/courses/entitlements`.
- Planned direction: the courses service takes the agent access port only by injection, and `getEntitlementsService` and `getCoursesService` move into one small wiring module per process (web, worker, API), so courses goes back to agents as a development dependency. It was not done here because the default courses service has 13 callers across the web app, the API, the MCP server, the worker, search, and migration, and the API is being changed by another unit at the same time.
- Negative: probe roles in integration tests that run member flows need select on `subscriptions`, `payment_connections`, `comped_memberships`, and `membership_plans`. The app role already has every table.
