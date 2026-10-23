# 0018. Approvals replay the recorded API request as the approving person

An agent's request that needs approval is stored with its validated input, and approving it sends that same request once through an in process copy of the API as the person who approved.

Status: Accepted, 2026-10-19

- ADR status: Accepted (founder, 2026-10-19, as built)
- Date: 2026-10-19
- Deciders: Step 13 unit R3 (proposed)
- Related: [0017](0017-bearer-api-tokens.md), [0011](0011-mcp-first-class-api-surface.md), [../architecture/authorization.md](../architecture/authorization.md) section 8, [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 5

## Context

Step 13 (R1) refused every approval classified action to agents with 403 `approval_required`. Phase 6 needs those refusals to become requests that a person decides (REQ-AGT-006), and authorization.md section 8 asks that approval "executes the exact recorded input, re-validated and re-authorized as the approving human at execution time". About 50 operations are classified (removals, roles, money, deletions, publishing, exports, settings, webhooks). Writing one executor per operation would copy the parsing and service calls that each route already has, and every new classified route would need a second implementation.

## Decision

- The bearer middleware decides before the route runs. When an agent token calls a classified operation and holds `proposals:write`, the middleware validates params, query, and JSON body with the route's own Zod schemas from the OpenAPI registry, stores an `approval_requests` row (migration 0021) with the recorded input, a plain language summary, and a before and after diff, and answers 202 `pending_approval`. The route handler does not run. The agent must also hold the route's own scope when it has one (added by the Step 13 verifier), so a proposal stays inside the agent's grants. Actions that a service refuses on its own (an agent's scheduled post) are caught after the handler throws `ApprovalRequiredError` and recorded the same way.
- Approving claims the row with a conditional update (pending to approved), so a double click runs nothing twice. The API then replays the recorded method, path, query, and body through a second instance of the same Hono app that has no bearer middleware and whose session resolver returns the approving person. Validation, the policy check with the approver's current role, rate limits, and audit entries all happen exactly as if the person had made the request. The replay runs inside an audit source with the agent's id, so the resulting entries name both the person and the agent.
- A 2xx answer marks the request executed and stores the response (secrets such as a new webhook signing secret are removed and shown once to the approver). A 403 puts the request back to pending and tells the approver they lack permission. Any other error marks it failed with the error code.
- Downloads (the members CSV, the audit log CSV) are approved without running; the agent then fetches the file once within 24 hours, and the export is produced at that moment by replaying the GET as the approver.
- Operations that cannot be recorded (file uploads, raw secrets such as own Stripe keys) or that only make sense in the approver's browser (Stripe onboarding links) are refused or marked "not supported yet" by name in `packages/api/src/approvals/catalog.ts`.

## Consequences

- Every classified route is executable through the queue without extra code, and a new classified route is too. The catalog only names exceptions and nicer summaries.
- The executor depends on the HTTP surface, so a breaking change to a route's input breaks pending requests for it; they fail safely with a validation error, and requests expire after 72 hours anyway.
- The internal app instance is never mounted on a network path; it can only be reached through the approvals gateway after a claim by a person who may decide.
- Step 14 (MCP) can reuse the same 202 answer and `GET /communities/{slug}/approvals/{id}` for its tools.
