# API tokens and agents

Status: Draft, 2026-10-22

How to create and use API tokens and agent identities, what each scope allows, and how to keep agent access safe. The design is in [../architecture/authorization.md](../architecture/authorization.md) sections 6 to 8, [../architecture/agent-integrations.md](../architecture/agent-integrations.md), and [ADR 0017](../decisions/0017-bearer-api-tokens.md).

## Two kinds of token

| Kind | Where to create it | Acts as | Use it for |
|---|---|---|---|
| Personal token | Account, API tokens (`/account/api-tokens`) | You | Your own scripts and integrations, such as a spreadsheet sync |
| Agent token | Account, Agents (`/account/agents`) for your own agents, or Manage, Settings, Agents (`/c/{slug}/manage/settings/agents`) for owners and admins | An agent you own | AI assistants and automations that should be labeled as agents |

Both kinds:

- work in exactly one community,
- look like `cohory_` followed by 43 characters,
- are shown once, in a dialog right after you create them, with a curl example and the MCP address; Cohory stores only a hash and the first 12 characters,
- expire after 90 days by default (you can choose 30 days to 1 year),
- stop working on the next request after you revoke them.

Creating an agent also creates its first token ("Main token"), so the dialog shows it at once. Issue more tokens from the agent's card.

Members cannot connect an AI assistant through its own sign in screen (OAuth) yet; that is for owners and admins. A member creates an agent in Account, Agents and gives the assistant its token instead.

### Expiry and regenerate

Seven days before a token expires, the person it belongs to gets a notice in the app and an email that name the token and the day it stops working (daily job `agents.token_expiry_notice`, 08:40 UTC). The list shows "Expires in N days" next to it. The email says how many days are left. A personal token notice opens Account, API tokens; an agent token notice opens Account, Agents for that community. Each token is noticed once, and a notice that fails to send is tried again on the next run. Tokens that lived 7 days or less, revoked tokens, app connections (OAuth), and tokens of paused agents get no notice.

"Regenerate" gives a new token with the same name, community, and permissions, valid for as long as the old one was, and revokes the old token at once. It works for active and expired tokens, not for revoked ones. Only the person an agent acts for regenerates its tokens. The audit log records `api_token.regenerated` or `agent.token_regenerated` with the old token's id. A person can regenerate at most 10 tokens an hour (`RATE_LIMIT_TOKEN_REGENERATE`).

### Last use

Lists show when each token was last used, as a relative time, and how: through the REST API or through MCP. The time updates at most once a minute per token, or sooner when the channel changes.

Send the token in the `Authorization` header:

```sh
curl -H "Authorization: Bearer $COHORY_TOKEN" \
  https://learn.example.com/api/v1/communities/my-community/posts
```

The OpenAPI document at `/api/openapi.json` lists every operation. Each operation carries an `x-cohory` object with the `scope` a token needs and the policy `action` it performs. Operations with `"scope": null` need a signed in session and answer 403 `token_not_allowed` to any token.

AI assistants that support OAuth can connect without a copied token: see [mcp.md](mcp.md#signing-in-with-oauth). Their access tokens are agent tokens like the ones above, valid for 1 hour, and work only at `/mcp`: `/api/v1` refuses them with 401 `invalid_token` (`wrong_resource`).

## What a token can do

A request through a token is allowed only when both are true:

1. the token holds the scope the operation needs, and
2. the person who owns the token (for an agent, the agent's owner) may do it right now with their current role.

So a token can never do more than its owner. If an admin who owns an agent is changed to member, the agent loses admin abilities on its next request. If the owner leaves the community, the agent is paused and personal tokens of that person are revoked. Joining again does not bring them back; create new tokens instead.

Changing or resetting your password revokes every token you own, personal and agent tokens alike, in every community, and ends every connected app (OAuth grant), so a stolen token stops working once you change your password. Create new tokens afterwards.

Only the person an agent acts for issues its tokens, adds permissions, or resumes it. The community owner, and admins for community wide agents, can remove permissions, pause, or revoke an agent someone else owns, but cannot issue a token for it. "Edit permissions" on the agent's card opens the same picker; for someone else's agent it offers only the permissions the agent already has, so you can only remove them. A change applies to every token of the agent on its next request.

### Choosing permissions

The picker shows only permissions that can work for your role and the kind of token. For example, a moderator's personal token never offers payments, settings, webhooks, or Propose changes, and a member's agent offers only reading the community, posts, comments, courses, and events, plus Propose changes. Permissions only staff can use sit under "More permissions". Presets give a starting point: Read only, Write drafts, Moderation helper (when your role can moderate), and Custom. Lists show plain labels grouped under Read, Write, and Sensitive instead of scope codes. The roles for each scope live in `packages/authz/src/scopes.ts`, and a test checks them against the routes.

### Scope reference

Search and member profiles combine several kinds of data, so each part follows its own scope: search returns post hits with `posts:read`, comment hits only with `comments:read`, member hits only with `members:read`, and lesson hits only with `courses:read`; a profile (`members:read`) lists recent posts only with `posts:read` and recent comments only with `comments:read`. Signed in people see everything their role allows.

| Scope | Allows | Preselected |
|---|---|---|
| `community:read` | Community profile, appearance, your membership | Yes |
| `posts:read` | Feed, single posts, search, your agents' drafts, scheduled posts | Yes |
| `comments:read` | Comments and replies | Yes |
| `posts:write` | Create, edit, like, pin (role permitting), report posts, upload post images, edit, cancel, or publish your scheduled posts | No |
| `comments:write` | Comment, reply, edit, like, report comments | No |
| `courses:read` | Courses, lessons, continue learning, and your own progress. It also marks lessons complete and submits assignments as you | Yes |
| `courses:write` | Create and edit courses, modules, and lessons (owner and admins) | No |
| `events:read` | Calendar, events, occurrences, calendar files | Yes |
| `events:write` | Create and edit events, cancel or restore an occurrence, RSVP | No |
| `members:read` | Member directory, profiles, leaderboard, and the Manage people list with inactive members (staff) | No |
| `members:moderate` | Join requests, reports, and (for personal tokens) removals and bans your role allows | No |
| `members:export` | The members CSV with names and email addresses (owner only). Shown as Sensitive. Agents ask for approval instead | No |
| `notifications:read` | Reserved. Notification routes span communities, so they stay session only for now. Not offered in any picker | No |
| `payments:read` | Payments overview, plan, subscriptions, ledger summary, comps, platform fees | No |
| `settings:read` | Settings, overview, usage, and the audit log list | No |
| `webhooks:read` | Webhook endpoints and delivery logs (owner and admins). Agents cannot read them | No |
| `webhooks:write` | Add, change, test, turn off, and delete webhook endpoints and rotate secrets (owner and admins). Agents ask for approval instead | No |
| `proposals:write` | Agents only: ask an owner or admin to approve an action the agent cannot take by itself, and read your own requests. A member's agent uses it to ask the member to buy a membership or course; those requests wait in Account, Agents | No |

There is no wildcard scope.

### Never through a token

Whatever the scopes, tokens cannot connect or disconnect payments, change plans or prices, refund, give someone the admin or owner role, transfer ownership, archive or delete the community, change the custom domain, export the audit log or the archive, import data, manage invite links, change settings or appearance, or create, list, or revoke tokens and agents. Do these signed in.

### What agents must ask for

Agents never do these by themselves: move money or change prices, change payment connections, change roles, remove or ban people, delete content (their own included), publish or unpublish courses and lessons, export or import data (including the members CSV), change settings or appearance, or manage webhooks (which send community data to another server). The same goes for scheduling, rescheduling, or publishing a scheduled post. The list lives in one place, `packages/authz/src/credentials.ts`.

Agents can never archive, restore, or delete the community or transfer its ownership, not even as an approval request (founder decision, 2026-10-19). Those calls answer 403 `not_allowed_for_agents`, store no request, and have no MCP tool. The owner does them signed in.

With the `proposals:write` permission, such a call becomes an approval request, as long as the agent also holds the scope the route needs (for example `members:moderate` for a removal, `members:export` for the members CSV, `webhooks:write` for a webhook endpoint). An agent cannot ask for anything outside its scopes; without the route's scope it gets 403 `insufficient_scope`. Operations that need a session (`"scope": null`) have no route scope, so the agent needs the scope of their area instead: `settings:read` for settings and appearance changes, and exports and imports, and `payments:read` for plans, prices, free access, and payment connections (`proposalScope` in `packages/authz/src/credentials.ts`). Only an owner (or an admin, where the role allows it) can approve them:

```sh
curl -X POST -H "Authorization: Bearer $AGENT_TOKEN" \
  https://learn.example.com/api/v1/communities/my-community/manage/people/$USER_ID/remove
# 202 {"status":"pending_approval","approvalId":"0192...","summary":"remove Sam Lee from the community",
#      "expiresAt":"2026-10-22T10:00:00.000Z","statusUrl":"/api/v1/communities/my-community/approvals/0192..."}
```

Nothing changes until a person decides. The agent's owner and every owner and admin get a notification, and the request waits in Manage, Inbox, Agent approvals with the agent, its owner, a plain summary, and what changes. Approving runs the exact request once, as the person who approved, with that person's current permissions; it needs a sign in from the last 10 minutes. Rejecting can add a note for the agent. Requests expire after 72 hours, and an agent can have at most 20 waiting. If the agent is paused or revoked before anyone decides, approving rejects the request instead.

The agent follows its request with `GET /api/v1/communities/{slug}/approvals/{approvalId}` (or lists them with `GET .../approvals`). `state` is `pending`, `approved` (running), `executed`, `failed`, `rejected`, or `expired`; `result` holds what the action returned, `decisionNote` the reason for a rejection. For an approved members CSV, `download.url` works once within 24 hours for the agent that asked.

Without `proposals:write`, these calls answer 403 `approval_required`. Reads of classified data (webhook endpoints, migration jobs) and file uploads cannot be proposed and are always refused. Connecting Stripe and adding a card for platform fees can be requested but cannot run for an agent yet; approving them reports "not supported", so do them yourself.

### What agents can do

High priority tasks from [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 10, through the REST API:

| Task | Route | Scope | Needs approval |
|---|---|---|---|
| Search discussions | `GET /communities/{slug}/search?q=` | `posts:read` | No |
| Draft an announcement | `POST /communities/{slug}/posts` (saved as a draft) | `posts:write` | Publishing the draft is done by a person on the Agents page |
| Schedule a post | `POST /communities/{slug}/posts` with `scheduledAt` | `posts:write`, `proposals:write` | Yes |
| Find inactive members | `GET /communities/{slug}/manage/people?inactiveDays=30` | `members:read` | No (the owner must be a moderator, admin, or owner) |
| Remove, ban, or change a role | `POST .../manage/people/{userId}/remove`, `.../ban`, `PATCH .../role` | `members:moderate`, `proposals:write` | Yes |
| Create an event | `POST /communities/{slug}/calendar/events` | `events:write` | No |
| Delete an event and all its dates | `DELETE /communities/{slug}/calendar/events/{eventSlug}` | `events:write`, `proposals:write` | Yes |
| Read payment summaries and subscriptions | `GET /communities/{communityId}/payments`, `.../subscriptions`, `.../ledger` | `payments:read` | No |
| Change the plan or price | `PUT /communities/{communityId}/payments/plan` | `payments:read`, `proposals:write` | Yes |
| Propose settings changes | `PATCH /communities/{slug}/manage/settings` | `settings:read`, `proposals:write` | Yes |
| Create course drafts | `POST /communities/{slug}/courses` and lessons | `courses:write` | No |
| Publish a course or lesson | `POST .../courses/{courseSlug}/publish`, `.../lessons/{lessonId}/publish` | `courses:write`, `proposals:write` | Yes |
| Delete someone's post or comment | `DELETE /communities/{slug}/posts/{postId}`, `.../comments/{commentId}` | `posts:write` or `comments:write`, `proposals:write` | Yes |
| Export the members CSV | `GET /communities/{slug}/manage/export/members.csv`, then the download link | `members:export`, `proposals:write` | Yes |
| Add a webhook endpoint | `POST /communities/{slug}/manage/webhooks` | `webhooks:write`, `proposals:write` | Yes (the signing secret is shown once to the approver) |

Not available to agents: creating a community (a token belongs to one community) and emailing all members (not built in Cohory yet).

Posts written by an agent are saved as drafts. They appear under "Drafts waiting for you" on the Agents page, where the owner or an admin publishes or discards them (Discard draft asks first). Published posts and agent comments show an Agent badge with the agent's name.

## Rate limits

| Caller | Default | Variable |
|---|---|---|
| Personal token | 60 requests per minute per token | `RATE_LIMIT_API_TOKENS` |
| Agent | 30 requests per minute per agent | `RATE_LIMIT_AGENT_REQUESTS` |
| Agent writes | 30 writes per hour per agent | `RATE_LIMIT_AGENT_WRITES` |

Every token response carries `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` (seconds). Over the limit the API answers 429 with `Retry-After`. The per action limits (posts, comments, likes) still apply to the owner as well. Counters live in memory per web process, like the other limits in [../self-hosting.md](../self-hosting.md).

## Errors

| Status and code | Meaning |
|---|---|
| 401 `invalid_token` | The token is malformed, unknown, revoked, or expired, the agent is paused or revoked, or the owner left. `details.reason` says which. |
| 403 `insufficient_scope` | The token lacks the scope in `details.required`. For an agent this also applies to asking for approval. |
| 403 `token_not_allowed` | The operation needs a signed in session. |
| 403 `scope_not_available` | Creating a token or agent asked for a permission your role or the token kind cannot use. `details.scopes` lists them. |
| 202 `pending_approval` | An agent's request waits for a person (see above). Not an error. |
| 403 `approval_required` | An agent tried an action that needs a person (`details.category`) without `proposals:write`, or one that cannot be proposed (`details.proposable: false`). |
| 429 `limit_reached` | The agent already has 20 requests waiting. |
| 410 `download_unavailable` | An approved download was already used, expired, or is not approved. |
| 403 `wrong_community` | The token belongs to another community. |
| 403 `forbidden` | The owner's role does not allow it. |
| 429 `rate_limited` | Wait for `Retry-After` seconds. |

## Audit

Every write through a token is in Manage, Settings, Audit log with the owning person, how it was done (API token), the token id, and for agents the agent's name and an Agent badge. Filter with Who (Agents) and How (API token); the CSV has `actor_type`, `via`, `token_id`, `agent_id`, and `agent_name` columns. Creating, pausing, resuming, and revoking agents and tokens is logged too, and so are approval requests (`approval.requested`), decisions (`approval.approved`, `approval.rejected`), and their outcome (`approval.executed`, `approval.failed`, `approval.expired`), each with the agent and its owner. Reads are not logged; the Agents page and Account, API tokens show when each token and agent was last used.

## Security guidance for agent use

- Give each assistant or automation its own agent. Do not share a token between tools; revoking one should not break the others.
- Grant only the scopes it needs. Read scopes are preselected; add a write scope only when the agent must write.
- Treat community content as untrusted input. Posts, comments, and lessons can contain text written to trick an assistant. An agent with write scopes that reads untrusted content can be steered; the draft default and the approval queue limit the damage. Read each approval request before you approve it, and reject anything you did not expect.
- Store tokens in a secret manager or the tool's secret settings, never in prompts, chat logs, shared documents, or source code.
- Pick a short expiry for experiments and rotate long lived tokens with Regenerate, then update the tool right away.
- Pause an agent you are not using. Revoke it if a token may have leaked; that ends every token of the agent on its next request.
- Review the audit log filtered to Agents now and then.
- Cohory never logs tokens. If you report a problem, share the 12 character prefix, never the token.

### What Cohory guarantees

These are checked by tests that walk every route in `/api/openapi.json` (`packages/api/src/agent-safety.integration.test.ts`), so a new route cannot skip them:

- An agent token never runs an operation that moves money, changes a payment connection, changes a role, removes or bans someone, deletes content, or exports data. It gets 202 `pending_approval` or a 403, and the service behind the route is not called. A new money, role, removal, deletion, or export route fails the tests until it is classified in `packages/authz/src/credentials.ts` or made session only.
- Personal tokens never reach session only or never grantable operations (403 `token_not_allowed`).
- A token for one community gets 403 on every route of another community, and ids from another community answer 404.
- Revoking a token, pausing or revoking an agent, demoting its owner, or removing its owner from the community applies on the very next request. Nothing is cached.
- Every agent write, approval request, decision, and execution is in the audit log with the agent id, the token id, and the owning person.
- Tokens are stored as SHA-256 hashes, compared in constant time, shown once, and never written to logs.
- Webhook endpoints cannot point at loopback, private, link local, or metadata addresses, delivery never follows a redirect, and signatures verify with the reference Standard Webhooks library. Signing secrets are encrypted at rest and never logged.

Known limits: approval needs a recent sign in but no second factor, because two factor authentication does not exist yet. User text fields are marked as untrusted in the API schemas, invisible characters are stripped from stored and returned text, and every result and error from the MCP server ([mcp.md](mcp.md)) is wrapped as untrusted. Open items are in [../product/backlog.md](../product/backlog.md).
