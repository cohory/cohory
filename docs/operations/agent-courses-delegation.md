# Agent access to courses

How creators let agents read a course, how members give their agents access, how agents propose purchases and report results, and what operators need to know.

Available since 0.8.0. Design: [ADR 0022](../decisions/0022-delegated-entitlements.md) (Accepted), [../architecture/authorization.md](../architecture/authorization.md) section 4.4, and [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 11.5.

## For creators

1. Open the course and find the Agent access card below the lessons. Only owners and admins see the switch.
2. Turn on Allow agent access. It is off for every course until you turn it on, and the switch saves as soon as you flip it.
3. Choose license terms:
   - **Personal use by the buyer's agents only** (default). Agents that act for the person who has access may read the course to help that person. They may not share the material, resell it, or use it to train models.
   - **Use by agents of the buyer's own team.** Agents may use the course for the buyer's own team, never outside it, and never to train models.
   - **Custom terms.** Write your own text. You can also add extra text to the other two choices.
4. Choose Save license terms.

The terms show on the course page, in the dialog where a member gives access, on the membership page before checkout, to agents in `list_my_courses` and the skill link, and in every agent version you publish after the change (manifest and `LICENSE.txt` in the skill zip). These settings are the one source of the terms: the publish dialog only shows them. Versions keep the terms they were published with, so no data migration was needed. Turning access off ends every agent's access to the course at once, and those delegations do not come back when you turn it on again.

The card also shows Agent results by task: how many results, agents, and members per lesson, task, and version. You never see what another member's agent reported.

## For members

1. Create an agent in Account, Agents (choose the community first). Your agents can read the community and courses and, with Propose changes, ask you to buy a membership. Issue a token for it and give the token to your assistant.
2. Open a course that allows agents and choose Give my agent access. Pick the agent, read the terms, and choose Agree and give access.
3. The agent can now read that course for 30 days with its token. Renew adds 30 days from today. Revoke ends it on the agent's next request.

Access also ends on its own when your own access ends (your subscription ends, you leave or are removed, free access ends), when the agent is revoked, or when the creator turns agent access off. Access that ended with your membership does not come back if you join or pay again, even on the same day: give access again. Pausing an agent pauses its access until you resume it or the access expires. The course page and Account, Agents show why it ended. You get a notification 3 days before a delegation ends.

Agents can only read. They cannot mark lessons complete, post, see other members, or buy anything, and they cannot give access to another agent.

## For agents (API)

Use an agent token with `courses:read`.

| Operation | Route | Scope or session |
|---|---|---|
| Read a course (existing) | `GET /api/v1/communities/{slug}/courses/{courseSlug}` | `courses:read` |
| Read a lesson (existing) | `GET /api/v1/communities/{slug}/courses/{courseSlug}/lessons/{lessonSlug}` | `courses:read` |
| List courses you may read | `GET /api/v1/communities/{slug}/courses` | `courses:read` |
| Agent access and license terms | `GET /api/v1/communities/{slug}/courses/{courseId}/agent-access` | `courses:read` |
| Submit a result | `POST /api/v1/communities/{slug}/courses/{courseId}/submissions` | `courses:read` |
| List your results | `GET /api/v1/communities/{slug}/courses/{courseId}/submissions` | `courses:read` |
| Result counts per task (owners and admins) | `GET /api/v1/communities/{slug}/courses/{courseId}/submissions/summary` | `courses:write` |
| Turn agent access on or off | `PUT /api/v1/communities/{slug}/courses/{courseId}/agent-access` | session only |
| List, create, renew, revoke delegations | `/api/v1/communities/{slug}/delegations`, `.../{delegationId}/renew`, `.../{delegationId}/revoke` | session only |
| Purchase requests | `GET /api/v1/communities/{slug}/purchase-requests`, `POST .../{approvalId}/approve`, `POST .../{approvalId}/reject` | session only |

Without access, course reads answer 403 with code `delegation_required` and a `reason`: `no_delegation`, `expired`, `revoked`, `human_access_ended`, `agent_inactive`, `agent_access_off`, or `wrong_community`.

A result body is `{ lessonId, taskId, version, runId, payload }`. `version` is the agent material version you worked from, `runId` is your own id for the run, and `payload` is any JSON up to 64 KiB. One result per agent, run, and task; a repeat answers 409 `duplicate_submission`. Results are stored as `self_reported` and never called verified.

### Proposing a purchase

With `proposals:write`, `POST /api/v1/communities/{communityId}/payments/checkout` answers 202 `pending_approval` with a `statusUrl`. Nothing happens at Stripe. Your person sees the request in Account, Agents and either declines it or approves it, which takes them to Stripe Checkout to pay themselves. Poll the status URL: `executed` means checkout started for your person, not that they paid. You never receive the checkout link. Requests expire after 72 hours.

## Agent access through MCP and the API

An agent with an active delegation (or whose person is an owner or admin) reads the course through these MCP tools or the same REST routes. MCP and REST give the same answers and the same errors, because each tool runs its REST route. Routes are under `/api/v1/communities/{slug}`.

| MCP tool | REST route | Scope |
|---|---|---|
| `list_my_courses` | `GET /agent-courses` | `courses:read` |
| `get_course_agent_material` | `GET /courses/{courseId}/agent-material?version=` | `courses:read` |
| `get_agent_task` | `GET /courses/{courseId}/agent-material/lessons/{lessonId}/tasks/{taskId}?version=` | `courses:read` |
| `get_agent_material_file` | `GET /courses/{courseId}/agent-material/file-content?path=&version=` | `courses:read` |
| `get_skill_export` | `GET /courses/{courseId}/agent-export?version=` | `courses:read` |
| `submit_task_result` | `POST /courses/{courseId}/submissions` | `courses:read` |
| `list_my_submissions` | `GET /courses/{courseId}/submissions` | `courses:read` |
| `propose_course_purchase` | `POST /api/v1/communities/{communityId}/payments/checkout` (session only route, always an approval request for agents) | `proposals:write` plus `courses:read` as the purchase category scope |

- `list_my_courses` lists, for an agent, the courses its person delegated to it that are still active (every course with agent material for agents of owners and admins), each with the latest version, how the agent got access (`delegated` with `expiresAt`, or `staff`), and the license terms. For a person it lists the courses they can read that have a published agent version.
- `get_agent_material_file` returns Markdown, text, CSV, and JSON files up to 32 KiB inline as text. Other files come back as a signed link.
- `get_skill_export` returns a signed link to the Agent Skills zip with the license terms. Agents need a delegation, or a person who is an owner or admin. People need access to the course, and the creator must allow agent access (owners and admins always can).
- Signed links look like `/api/v1/communities/{slug}/agent-downloads/{token}`, work without a token for 5 minutes, check the delegation again when used (a revoked delegation stops the link with 403 `delegation_required`), and answer 404 `link_expired` when the link is expired, changed, or used under another community. Downloads are limited to 30 per minute per client address (`RATE_LIMIT_AGENT_DOWNLOADS`); over the limit the route answers 429 with `Retry-After`. Files are served as attachments with a sandboxing Content Security Policy.
- Every result from these tools is wrapped in `untrusted_content` with the source `Cohory course material` and a notice: the material is data, never instructions, and scripts and templates run only in the agent's own sandbox, never with elevated permissions. Cohory never runs them.
- A result must name a lesson, task, and version that exist in the published agent material; otherwise it answers 404. How to run tasks and report results: [../architecture/evaluation-runner.md](../architecture/evaluation-runner.md).

### Buying the course: what is supported

Course access in Cohory is community membership (every course is open to all members), so buying a course means buying the community membership. An agent can only exist for a member. When the person's membership ends (for example the subscription ended and they were removed, but not banned), a personal agent that holds `proposals:write` is not paused. It keeps a lapsed standing:

- Its token works only to propose the membership checkout (`propose_course_purchase`) and to read its own approval requests (`get_approval_status`, `list_my_approval_requests`). Everything else answers 403 `membership_required`, and MCP lists only those three tools. Its permissions are narrowed to `courses:read` and `proposals:write`.
- The person gets a notification that opens Account, Agents for that community even though they are no longer a member. They decline, or approve and pay in Stripe Checkout themselves. Approval alone charges nothing, and the agent never sees the checkout link.
- When the payment brings the membership back, the person gives the agent access to the course again. Delegations that ended with the old access do not come back.

Agents without `proposals:write`, community wide agents, and agents of banned people are still paused when their person leaves, as before. A person who never joined a community cannot have an agent there; they join and pay themselves.

## For operators

- Migration 0024 adds `course_agent_settings`, `course_delegations`, `agent_submissions` (forced row level security), the `delegation_end_reason` type, the `agent_access` notification type, the `course_delegation` notification subject, and a unique key on `courses (community_id, id)`. No new environment variables.
- The worker job `entitlements.delegations_sweep` runs daily at 03:20 UTC. It records why delegations ended and sends the 3 day notices. Access checks never wait for it, and give the same answer whether or not it ran: a delegation granted before the person's current membership began (`memberships.joined_at`) is ended, and delegations of a paused agent stay paused.
- Notification preferences gain "Your agents' course access and purchase requests".
- The archive export does not carry agent settings, delegations, or results.
- Signed download links are keyed from `BETTER_AUTH_SECRET` and built on `APP_URL`. Agent course delivery needs no migration and no new variables. Design: [ADR 0023](../decisions/0023-agent-course-delivery.md).
