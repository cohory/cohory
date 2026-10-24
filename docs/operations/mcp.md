# MCP server

How to connect AI assistants such as Claude and Codex to a Cohory community through the Model Context Protocol (MCP), with OAuth or with an agent token, which tools exist, and how to keep that access safe. The design is in [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 4, [ADR 0019](../decisions/0019-mcp-dispatch-through-http-handlers.md) (tools), and [ADR 0020](../decisions/0020-oauth-authorization-server.md) (OAuth). Scopes, agents, and approvals are described in [api-tokens.md](api-tokens.md); the [scope reference](api-tokens.md#scope-reference) lists every permission.

## What it is

Cohory serves MCP at `<APP_URL>/mcp`, for example `https://learn.example.com/mcp`, inside the web app. There is no separate server to run.

| Item                  | Value                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol revisions    | `2026-07-28` (the current revision, stateless requests with per request metadata) and the handshake revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, and `2024-11-05` that today's clients use |
| Transport             | Streamable HTTP, stateless: every request is a `POST` with JSON, no session id, no event stream (`GET` answers 405)                                                                               |
| Authentication        | OAuth 2.1 access tokens from Cohory's own authorization server, or an agent or personal API token, sent as `Authorization: Bearer <token>`                                                        |
| Server library        | `@modelcontextprotocol/sdk` 1.32.1 for the handshake revisions; Cohory answers `2026-07-28` requests itself because no official SDK speaks that revision yet                                      |
| Resources and prompts | Not offered. Only tools.                                                                                                                                                                          |

Every tool is one REST operation. A tool call becomes the matching `/api/v1` request with your token, inside the server, and runs through the same token check, scope check, rate limits, approval rules, and handler as a direct API call. A tool can never do more than the same call to the REST API.

## Connect an assistant

Two ways, both ending in an agent that belongs to you:

- **Sign in with OAuth.** The assistant opens a Cohory page in your browser, you approve, and it gets its own tokens. Nothing to copy. This is the only way for clients that support MCP authorization only, such as custom connectors in Claude apps.
- **Paste an agent token.** Create an agent and a token in Manage, Settings, Agents (owners and admins) or in Account, Agents (every member, read only agents for members and moderators), choose the permissions, and give the token to the assistant. Keep it in an environment variable, not in a file you share.

Only owners and admins can connect apps through OAuth. Members can create an agent by hand in Account, Agents and give the assistant its token; signing in with OAuth as a member is not offered (product decision, 2026-10-22). The consent screen and Account, Agents say so.

A "Connect an AI assistant" card at the top of Account, Agents and Manage, Settings, Agents shows the MCP address with a copy button and short steps for Claude, ChatGPT, and Codex, with a token as the fallback. For members the card shows the address and the token path only.

### Claude

Claude apps (claude.ai and Claude Desktop): Settings, Connectors, Add custom connector, and enter `https://learn.example.com/mcp`. Claude signs in with OAuth and opens the consent screen.

Claude Code with OAuth:

```sh
claude mcp add --transport http cohory https://learn.example.com/mcp
```

Then run `/mcp` inside Claude Code and choose Cohory to sign in. With an agent token instead:

```sh
claude mcp add --transport http cohory https://learn.example.com/mcp \
  --header "Authorization: Bearer $COHORY_TOKEN"
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.cohory]
url = "https://learn.example.com/mcp"
bearer_token_env_var = "COHORY_TOKEN"
```

Leave out `bearer_token_env_var` and run `codex mcp login cohory` to sign in with OAuth instead.

### Other clients

Point any MCP client that supports Streamable HTTP at the `/mcp` address. Clients that implement MCP authorization find everything on their own from the 401 answer. Others send an agent token as a bearer token. With the official TypeScript SDK:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-assistant", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("https://learn.example.com/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.COHORY_TOKEN}` } },
  }),
);
const { tools } = await client.listTools();
```

For OAuth, pass an `authProvider` instead of the header; the SDK registers the client, opens the consent page, and keeps the tokens. To check a server from a terminal: `npx @modelcontextprotocol/inspector@2.10.1 --cli https://learn.example.com/mcp --transport http --header "Authorization: Bearer $COHORY_TOKEN" --method tools/list`.

## Signing in with OAuth

What happens when an assistant connects:

1. It calls `/mcp` without a token and gets 401 with `WWW-Authenticate: Bearer resource_metadata="<APP_URL>/.well-known/oauth-protected-resource/mcp", scope="community:read posts:read comments:read courses:read events:read"`.
2. It reads that document, then `<APP_URL>/.well-known/oauth-authorization-server`.
3. It registers itself at `/oauth/register` and gets a `client_id`.
4. It opens `/oauth/authorize` in your browser. You sign in if needed and see the consent screen.
5. You approve. The browser goes back to the assistant with a one time code, and the assistant exchanges it at `/oauth/token` for an access token and a refresh token.

### The consent screen

The screen shows:

- the instance name and logo above the card, the app's name as the app reported it, its website host when it registered a `client_uri`, and the address the browser returns to (for a desktop app, `127.0.0.1` and a port on your own computer),
- a warning that Cohory has not verified the app; approve only if you started the connection yourself, because any app can call itself "Claude",
- the community, with its logo,
- the agent: create a new one (named after the app by default) or reuse one of your active agents in that community. When an earlier connection of the same app (the same client, or a client with the same name that returns to the same host) used one of your active agents there, that agent is preselected and the screen names the app and host it is reused for, so reconnecting does not create a second agent. A client that only copies the app's name gets no agent preselected. A new agent named like one you already have shows a hint, and agent cards with the same name show the app that connected them (or "Created by hand") and the creation date,
- what the app can do, in plain words: "It can" lists the permissions that will be granted, "It also asked to" lists write permissions the app requested that stay off, and "It cannot" names the main permissions it will not get. Read permissions the app asked for are preselected, write permissions never are. "Change permissions" opens the full picker, limited to permissions your role can give. A new agent gets only permissions your role can give, and a reused agent can use only permissions it already has,
- "Access renews while you use it. Disconnect any time in Account, Connected apps."

"Allow access to" and the community name sends you back to the app. Cancel tells the app you said no. The page cannot be shown inside a frame on another site, and approving works only from Cohory's own pages.

The agent belongs to you. Everything it does carries the Agent badge and is in the audit log, it can never do more than your current role, and actions that need approval wait in Manage, Inbox, Agent approvals.

### Tokens

| Token              | Format                                          | Lifetime   | Notes                                                                |
| ------------------ | ----------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| Access token       | `cohory_` and 43 characters, an agent API token | 1 hour     | Works only at `/mcp`, in the chosen community; `/api/v1` answers 401 |
| Refresh token      | `cohoryrt_` and 43 characters                   | 30 days    | Replaced by a new one on every use                                   |
| Authorization code | 43 characters                                   | 60 seconds | Works once                                                           |

Access tokens are issued for the `<APP_URL>/mcp` resource, so the REST API refuses them with 401 `invalid_token` (`details.reason` `wrong_resource`). Use an agent token from the Agents page for scripts that call `/api/v1`.

Cohory stores only SHA-256 hashes of all three. If a used refresh token is presented again, Cohory treats it as stolen and ends the whole connection: every token of that connection stops working, and the app has to ask you again. The same happens when a code is used twice. The hourly access tokens are not listed on the Agents pages; the agent card shows the connection instead.

### Disconnecting

- **Account, Connected apps** (`/account/connected-apps`) lists the apps you connected in every community.
- **Account, Agents** and **Manage, Settings, Agents** show each connection inside its agent's card as "Connected through" and the app's name, with Disconnect. Manage shows every agent in the community, for owners and admins.

Account, Connected apps groups connections of one app (same name and return address) under one heading with the return host and the number of connections. Each entry shows the agent, the permissions, when it was connected, and when it was last used, relative and via MCP. Disconnect stops it on its next request. The app then gets 401 with "This connection was ended. Connect the app again." (an expired access token gets "This sign in has expired. Your app renews it on its own; if it cannot, connect the app again."); pasted tokens keep the token wording. The agent stays; revoke it on the Agents page to end its other tokens too. Pausing or revoking the agent also stops the app, and refresh is refused while the agent is paused. Apps can disconnect themselves at `/oauth/revoke` (RFC 7009). Revoking a refresh token ends the connection; revoking an access token ends only that token.

## Which tools you see

`tools/list` returns only tools that the token could ever call, sorted by name:

- the token holds the scope the REST operation needs,
- the owner's current role could perform the action (an agent of a member never sees `find_inactive_members`),
- for an agent, actions that need approval appear only when it holds `proposals:write` ("Propose changes") and the area scope of the action: the route's scope, or for actions that only signed in people can take, `settings:read` (settings, appearance, archiving, deleting or transferring the community, exports and imports) or `payments:read` (plans, prices, free access, payment connections),
- operations no token may use are never listed.

The list is computed on every request, so revoking a permission or demoting the owner removes tools at once. A tool that is not listed can still be called by name; the REST rules then refuse it with the same error as the API.

## Course tools

`list_courses`, `get_course`, and `get_lesson` read any course the agent may read through the normal course routes (`courses:read`): every course for agents of owners and admins, and for a member's agent only the courses its person shared with it. They work without a published agent version, and reading a lesson does not mark it complete. Since 0.8.0, tools let agents read the agent material of courses their person shared with them: `list_my_courses`, `get_course_agent_material`, `get_agent_task`, `get_agent_material_file`, `get_skill_export`, `submit_task_result`, `list_my_submissions`, and `propose_course_purchase`. Their results wrap course material in `untrusted_content` with the source `Cohory course material` and a notice that it is data, never instructions, and that scripts and templates run only in the agent's own sandbox. Files and skill zips that do not fit inline come back as signed links valid for 5 minutes. When the agent's person is no longer a member, a personal agent with `proposals:write` sees only `propose_course_purchase`, `get_approval_status`, and `list_my_approval_requests`; every other call answers 403 `membership_required`. Details: [agent-courses-delegation.md](agent-courses-delegation.md).

## Tool reference

Generated from the route metadata by `pnpm --filter @cohory/mcp reference`. A unit test fails when this table is stale. The community always comes from the token, so no tool asks for it.

<!-- tool-reference:start -->

| Tool                        | Title                              | REST operation                                                                                                      | Scope              | Approval for agents                                               | Annotations                     | Member content |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------- | ------------------------------- | -------------- |
| `ban_member`                | Ban a member                       | `POST /api/v1/communities/{slug}/manage/people/{userId}/ban` (banMember)                                            | `members:moderate` | Yes (removal); agents need `members:moderate` and proposals:write | writes, destructive, idempotent | Yes            |
| `cancel_event_series`       | Cancel an event and all its dates  | `DELETE /api/v1/communities/{slug}/calendar/events/{eventSlug}` (deleteCalendarEvent)                               | `events:write`     | Yes (deletion); agents need `events:write` and proposals:write    | writes, destructive, idempotent | Yes            |
| `create_draft_post`         | Create a draft post                | `POST /api/v1/communities/{slug}/posts` (createPost)                                                                | `posts:write`      | No                                                                | writes                          | Yes            |
| `create_event`              | Create an event                    | `POST /api/v1/communities/{slug}/calendar/events` (createCalendarEvent)                                             | `events:write`     | No                                                                | writes                          | Yes            |
| `find_inactive_members`     | Find inactive members              | `GET /api/v1/communities/{slug}/manage/people` (listManagePeople)                                                   | `members:read`     | No                                                                | read only, idempotent           | Yes            |
| `get_agent_material_file`   | Get a reference or template file   | `GET /api/v1/communities/{slug}/courses/{courseId}/agent-material/file-content` (getAgentMaterialFileContent)       | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `get_agent_task`            | Get an agent task                  | `GET /api/v1/communities/{slug}/courses/{courseId}/agent-material/lessons/{lessonId}/tasks/{taskId}` (getAgentTask) | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `get_approval_status`       | Get an approval request            | `GET /api/v1/communities/{slug}/approvals/{approvalId}` (getApprovalRequest)                                        | `proposals:write`  | No                                                                | read only, idempotent           | Yes            |
| `get_community`             | Get the community                  | `GET /api/v1/communities/{slug}` (getCommunity)                                                                     | `community:read`   | No                                                                | read only, idempotent           | Yes            |
| `get_community_settings`    | Get community settings             | `GET /api/v1/communities/{slug}/manage/settings` (getCommunitySettings)                                             | `settings:read`    | No                                                                | read only, idempotent           | Yes            |
| `get_course`                | Get a course                       | `GET /api/v1/communities/{slug}/courses/{courseSlug}` (getCourse)                                                   | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `get_course_agent_material` | Get course agent material          | `GET /api/v1/communities/{slug}/courses/{courseId}/agent-material` (getAgentMaterial)                               | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `get_event`                 | Get an event                       | `GET /api/v1/communities/{slug}/calendar/events/{eventSlug}` (getCalendarEvent)                                     | `events:read`      | No                                                                | read only, idempotent           | Yes            |
| `get_event_occurrence`      | Get an event date                  | `GET /api/v1/communities/{slug}/calendar/events/{eventSlug}/occurrences/{occurrenceId}` (getCalendarOccurrence)     | `events:read`      | No                                                                | read only, idempotent           | Yes            |
| `get_lesson`                | Get a lesson                       | `GET /api/v1/communities/{slug}/courses/{courseSlug}/lessons/{lessonSlug}` (getLesson)                              | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `get_member`                | Get a member                       | `GET /api/v1/communities/{slug}/members/{userId}` (getMemberProfile)                                                | `members:read`     | No                                                                | read only, idempotent           | Yes            |
| `get_payments_summary`      | Get a payments summary             | `GET /api/v1/communities/{communityId}/payments/ledger` (getPaymentsLedgerSummary)                                  | `payments:read`    | No                                                                | read only, idempotent           | Yes            |
| `get_post`                  | Get a post                         | `GET /api/v1/communities/{slug}/posts/{postId}` (getPost)                                                           | `posts:read`       | No                                                                | read only, idempotent           | Yes            |
| `get_review_summary`        | Get the review summary             | `GET /api/v1/communities/{slug}/reviews/summary` (getReviewSummary)                                                 | `community:read`   | No                                                                | read only, idempotent           | No             |
| `get_skill_export`          | Get the skill download link        | `GET /api/v1/communities/{slug}/courses/{courseId}/agent-export` (getAgentSkillExport)                              | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `list_comments`             | List comments on a post            | `GET /api/v1/communities/{slug}/posts/{postId}/comments` (listComments)                                             | `comments:read`    | No                                                                | read only, idempotent           | Yes            |
| `list_courses`              | List courses                       | `GET /api/v1/communities/{slug}/courses` (listCourses)                                                              | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `list_event_rsvps`          | List who is going to an event date | `GET /api/v1/communities/{slug}/calendar/occurrences/{occurrenceId}/rsvps` (listCalendarOccurrenceRsvps)            | `events:read`      | No                                                                | read only, idempotent           | Yes            |
| `list_events`               | List events                        | `GET /api/v1/communities/{slug}/calendar/occurrences` (listCalendarOccurrences)                                     | `events:read`      | No                                                                | read only, idempotent           | Yes            |
| `list_members`              | List members                       | `GET /api/v1/communities/{slug}/members` (searchMembers)                                                            | `members:read`     | No                                                                | read only, idempotent           | Yes            |
| `list_my_approval_requests` | List my approval requests          | `GET /api/v1/communities/{slug}/approvals` (listApprovalRequests)                                                   | `proposals:write`  | No                                                                | read only, idempotent           | Yes            |
| `list_my_courses`           | List my courses                    | `GET /api/v1/communities/{slug}/agent-courses` (listMyAgentCourses)                                                 | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `list_my_submissions`       | List my results                    | `GET /api/v1/communities/{slug}/courses/{courseId}/submissions` (listAgentSubmissions)                              | `courses:read`     | No                                                                | read only, idempotent           | Yes            |
| `list_post_drafts`          | List draft posts                   | `GET /api/v1/communities/{slug}/post-drafts` (listPostDrafts)                                                       | `posts:read`       | No                                                                | read only, idempotent           | Yes            |
| `list_posts`                | List posts                         | `GET /api/v1/communities/{slug}/posts` (listPosts)                                                                  | `posts:read`       | No                                                                | read only, idempotent           | Yes            |
| `list_reviews`              | List reviews                       | `GET /api/v1/communities/{slug}/reviews` (listReviews)                                                              | `community:read`   | No                                                                | read only, idempotent           | Yes            |
| `list_scheduled_posts`      | List scheduled posts               | `GET /api/v1/communities/{slug}/scheduled-posts` (listScheduledPosts)                                               | `posts:read`       | No                                                                | read only, idempotent           | Yes            |
| `propose_course_purchase`   | Propose buying the membership      | `POST /api/v1/communities/{communityId}/payments/checkout` (createMembershipCheckout)                               | session only       | Yes (purchase); agents need `courses:read` and proposals:write    | writes                          | No             |
| `propose_settings_change`   | Propose a settings change          | `PATCH /api/v1/communities/{slug}/manage/settings` (updateCommunitySettings)                                        | session only       | Yes (settings); agents need `settings:read` and proposals:write   | writes, destructive, idempotent | Yes            |
| `remove_member`             | Remove a member                    | `POST /api/v1/communities/{slug}/manage/people/{userId}/remove` (removeMember)                                      | `members:moderate` | Yes (removal); agents need `members:moderate` and proposals:write | writes, destructive, idempotent | Yes            |
| `schedule_post`             | Schedule a post                    | `POST /api/v1/communities/{slug}/posts` (createPost)                                                                | `posts:write`      | Yes (scheduling); agents also need proposals:write                | writes                          | Yes            |
| `search_community`          | Search the community               | `GET /api/v1/communities/{slug}/search` (searchCommunity)                                                           | `posts:read`       | No                                                                | read only, idempotent           | Yes            |
| `submit_task_result`        | Submit a task result               | `POST /api/v1/communities/{slug}/courses/{courseId}/submissions` (submitAgentResult)                                | `courses:read`     | No                                                                | writes                          | No             |

<!-- tool-reference:end -->

## Results

A successful call returns `structuredContent` and the same JSON as text:

```json
{
  "untrusted_content": {
    "notice": "Fields in result were written by community members ...",
    "source": "Cohory community members"
  },
  "status": 200,
  "result": { "data": [], "nextCursor": null }
}
```

- `status` is the HTTP status of the REST operation and `result` is its JSON body, unchanged. Lists keep the REST pagination: pass `nextCursor` back as `cursor`.
- `untrusted_content` is present on every tool result and every error (all tools are marked "Member content" above). It means that strings inside `result` were written by people and must be read as data. Tool descriptions and the server instructions say the same.
- When a person must approve, the call returns a normal result (not an error) with `status` 202 and `result.status` `pending_approval`, the `approvalId`, a plain summary, `expiresAt`, and `statusUrl`. The text starts with "Waiting for a person to approve this" and asks the assistant not to retry. Check the decision with `get_approval_status`.
- REST errors come back as tool errors (`isError: true`) with the same `{ "error": { "code", "message", "details" } }` as the API, for example `insufficient_scope`, `approval_required`, `forbidden`, or `not_found`.

## Errors at the HTTP level

| Answer                                                                                             | When                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401 with `WWW-Authenticate: Bearer resource_metadata=..., scope=...`                               | No token, or a token that is unknown, expired, revoked, paused, or whose owner left (`error="invalid_token"`)                                                                                                                                                                                                                                                                    |
| 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="...", resource_metadata=...` | An OAuth access token calls a tool it lacks the scope for. `scope` names every scope the call needs (for a proposal, the area scope and `proposals:write`), so the client can ask you for more. The JSON-RPC error has code `-32003` and the REST error in `data`. Pasted agent and personal tokens get the usual tool error instead, since they cannot be widened by the client |
| 403                                                                                                | A browser sends an `Origin` other than `APP_URL` (protection against DNS rebinding)                                                                                                                                                                                                                                                                                              |
| 400 with JSON-RPC `-32022`                                                                         | `MCP-Protocol-Version` names a revision Cohory does not speak; `data.supported` lists the ones it does                                                                                                                                                                                                                                                                           |
| 400 with JSON-RPC `-32020`                                                                         | A `2026-07-28` request whose `MCP-Protocol-Version`, `Mcp-Method`, or `Mcp-Name` header is missing or differs from the body                                                                                                                                                                                                                                                      |
| 404 with JSON-RPC `-32601`                                                                         | A `2026-07-28` request for a method Cohory does not offer, such as `resources/list`                                                                                                                                                                                                                                                                                              |
| 405                                                                                                | `GET` or `DELETE`: there are no sessions and no event stream                                                                                                                                                                                                                                                                                                                     |
| 413                                                                                                | The request body is larger than 256 KiB                                                                                                                                                                                                                                                                                                                                          |
| 429                                                                                                | Rate limited (see below)                                                                                                                                                                                                                                                                                                                                                         |

## Protocol revisions

Cohory serves both eras of the protocol on the same address:

- A request whose `MCP-Protocol-Version` header (or `_meta` field `io.modelcontextprotocol/protocolVersion`) is `2026-07-28` is answered statelessly by that revision: `server/discover` returns the supported versions, capabilities, and instructions; `tools/list` and `tools/call` work as above; every result carries `resultType: "complete"` and `_meta["io.modelcontextprotocol/serverInfo"]`, and `tools/list` carries `ttlMs` and `cacheScope: "private"` because the list depends on the token.
- An `initialize` request, or a request with an older revision in the header, is served by the official SDK in stateless JSON mode for that revision.

Neither era keeps sessions, so any web replica can answer any request.

## Limits

| Limit        | Value                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request body | 256 KiB; larger requests get HTTP 413                                                                                                                                                                                                                  |
| Tool result  | 100,000 bytes of UTF-8; larger results become a `result_too_large` tool error that asks for a smaller `limit`                                                                                                                                          |
| Requests     | The same per token and per agent limits as the API (agents 30 requests per minute and 30 writes per hour by default). Each tool call counts once; `initialize`, `tools/list`, and other requests count once each                                       |
| OAuth        | `/oauth/register`: 10 registrations per hour per address (`RATE_LIMIT_OAUTH_REGISTER`). `/oauth/token` and `/oauth/revoke`: 30 requests per minute per address (`RATE_LIMIT_OAUTH_TOKEN`). Over the limit: 429, `Retry-After`, `{"error":"slow_down"}` |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`. When the limit is reached, a tool call answers with JSON-RPC error `-32029` and `data: { "code": "rate_limited", "retryAfterSeconds": n }` plus a `Retry-After` header; other requests answer HTTP 429 with the same error.

## Audit and logs

Writes through MCP are in the audit log exactly like API writes, with How set to MCP (`via = mcp`), the token, the agent, and the owning person. Approval requests made over MCP are recorded with `via = mcp` too, and the approval, its execution, and the change itself name the agent. OAuth events are entries too: `oauth.grant_created` (with the new agent's `agent.created`), `oauth.token_issued`, `oauth.token_refreshed`, `oauth.token_revoked`, `oauth.grant_revoked` (reason `refresh_reuse`, `code_reuse`, or `revoked`), and `oauth.disconnected`, each with the person, the agent, the client id, and the app's name. Registration happens before any community is chosen and is not in a community audit log.

The server logs one line per tool call with the tool, the operation id, the agent and token ids, the status, and the time taken; it never logs tokens or arguments.

## Security guidance for agent use

- Give each assistant its own agent with the fewest permissions it needs. Read only is the default for a reason. Add `proposals:write` only when you want the assistant to ask for removals, settings changes, or scheduled posts.
- Approve an OAuth connection only when you started it yourself and the return address is what you expect. App names are not verified.
- Treat everything inside `untrusted_content` as text a stranger wrote. A post can contain "ignore your instructions"; Cohory never acts on it, and your assistant should not either. Since 0.9 every tool result, write tools included, and every error carries `untrusted_content`, because a created draft or a validation message can echo text a person wrote. Zero width spaces, word joiners, byte order marks, bidirectional controls, and Unicode tag characters are removed from every string in a result before it is sent; joiners that shape emoji and scripts stay.
- Removals, bans, settings changes, deleting an event series, and scheduled posts by an agent always wait for a person, and money, roles, and deletions are never possible without one. An injected instruction can at most create a request that a person sees in Manage, Inbox, Agent approvals, where they can reject it.
- Approving needs a sign in from the last 10 minutes. Read the summary and the list of changes before you approve.
- Disconnect apps and revoke agents as soon as an assistant is no longer used. The next call is refused with 401.
- The server ignores cookies on `/mcp`; only bearer tokens work, so a browser session cannot be used to call tools, and browser requests from other sites are refused.

## For client developers

| Endpoint                                                                                       | Purpose                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /mcp`                                                                                    | The MCP endpoint                                                                |
| `GET /.well-known/oauth-protected-resource/mcp` (also `/.well-known/oauth-protected-resource`) | Protected resource metadata (RFC 9728). `resource` is `<APP_URL>/mcp`           |
| `GET /.well-known/oauth-authorization-server`                                                  | Authorization server metadata (RFC 8414). The issuer is the origin of `APP_URL` |
| `POST /oauth/register`                                                                         | Dynamic client registration (RFC 7591), JSON body                               |
| `GET /oauth/authorize`                                                                         | Authorization code with PKCE                                                    |
| `POST /oauth/token`                                                                            | `authorization_code` and `refresh_token` grants, form encoded                   |
| `POST /oauth/revoke`                                                                           | Token revocation (RFC 7009), form encoded                                       |

Rules:

- Public clients only: `token_endpoint_auth_method` is `none`, and the registration answer says so whatever you asked for. Send `client_id` in every token and revocation request.
- `redirect_uris` must use `https`, or `http` on `127.0.0.1`, `[::1]`, or `localhost`. Custom schemes, fragments, and user names are refused, and a redirect must match a registered one exactly, including the port. Refusing custom schemes is a confirmed decision (founder, 2026-10-19): native apps use a loopback redirect.
- `grant_types` may contain only `authorization_code` and `refresh_token`; `response_types` only `code`.
- PKCE with `S256` is required. `plain` and missing challenges are refused.
- Send `resource=<APP_URL>/mcp` in the authorization and token requests. Any other value is refused with `invalid_target`. When it is missing, the grant is still bound to `/mcp`.
- `scope` is a space separated list from the [scope reference](api-tokens.md#scope-reference). Unknown values such as `offline_access` are ignored. A refresh may narrow the scopes but never widen them. Ask for more after a 403 `insufficient_scope` by authorizing again with the union of your scopes and the challenged ones.
- Authorization responses include `state` and `iss`. Compare `iss` with the issuer you discovered.
- Errors follow RFC 6749: JSON with `error` and `error_description`, and a redirect with `error`, `state`, and `iss` when the redirect URI is known to be safe. An unknown client or an unregistered redirect URI is shown to the person instead of redirecting.
- Client ID Metadata Documents, which the `2026-07-28` revision prefers over dynamic registration, are not supported yet (`client_id_metadata_document_supported: false`); use dynamic registration.
- Registrations that nobody uses are deleted. Once a day the server removes a client that has no active connection, no unexpired access or refresh token, and no consent or token issued in the last 30 days (a client never used is removed 30 days after it registered). Its ended connections and revoked tokens go with it. A deleted `client_id` gets `invalid_client`, so register again when that happens.

## Self hosting

Set `APP_URL` to the public `https` address of your server. The issuer, the `/mcp` resource, and the allowed `Origin` are derived from it, and assistants refuse metadata whose issuer does not match the address they used. Nothing else needs configuring; there is no outside service.

Data lives in `oauth_clients` (public client metadata, not tied to a community), `oauth_grants`, `oauth_authorization_codes`, and `oauth_refresh_tokens` (row level security by community), and `api_tokens.oauth_grant_id`. The worker job `agents.oauth_clients_prune` runs daily at 03:55 UTC and deletes up to 500 unused clients per run, with the rule above; it logs only counts.

## Decisions and open questions

- **Confirmed** ([0019](../decisions/0019-mcp-dispatch-through-http-handlers.md)): every tool runs its REST operation through the same handler, checks, and limits.
- **Confirmed** ([0020](../decisions/0020-oauth-authorization-server.md)): Cohory is its own OAuth 2.1 authorization server for MCP clients.
- **Confirmed** (founder, 2026-10-19): custom redirect schemes are refused; native apps use a loopback redirect.
- **Confirmed** (product decision, 2026-10-22): only owners and admins connect apps through OAuth; members paste an agent token.
- **Open question:** Client ID Metadata Documents, which the `2026-07-28` revision prefers over dynamic registration.
