import { api, operationEntries, routeScopes, tokenDecision } from "@cohory/api";
import { scopes, type ApiCredential, type Scope } from "@cohory/authz";
import { describe, expect, it } from "vitest";

import { mcpTools } from "./default";

const tools = mcpTools(api);
const entries = operationEntries(api);
const everything: ApiCredential = {
  type: "agent",
  tokenId: "token",
  agentId: "agent",
  communityId: "community",
  scopes,
  via: "mcp",
};

// Reviewed by hand: the scope a token needs for each tool, and whether the tool is destructive.
const security: Record<string, readonly [scope: Scope | null, destructive: boolean]> = {
  ban_member: ["members:moderate", true],
  cancel_event_series: ["events:write", true],
  create_draft_post: ["posts:write", false],
  create_event: ["events:write", false],
  find_inactive_members: ["members:read", false],
  get_agent_material_file: ["courses:read", false],
  get_agent_task: ["courses:read", false],
  get_approval_status: ["proposals:write", false],
  get_community: ["community:read", false],
  get_community_settings: ["settings:read", false],
  get_course: ["courses:read", false],
  get_course_agent_material: ["courses:read", false],
  get_event: ["events:read", false],
  get_event_occurrence: ["events:read", false],
  get_lesson: ["courses:read", false],
  get_member: ["members:read", false],
  get_payments_summary: ["payments:read", false],
  get_post: ["posts:read", false],
  get_review_summary: ["community:read", false],
  get_skill_export: ["courses:read", false],
  list_comments: ["comments:read", false],
  list_courses: ["courses:read", false],
  list_event_rsvps: ["events:read", false],
  list_events: ["events:read", false],
  list_members: ["members:read", false],
  list_my_approval_requests: ["proposals:write", false],
  list_my_courses: ["courses:read", false],
  list_my_submissions: ["courses:read", false],
  list_post_drafts: ["posts:read", false],
  list_posts: ["posts:read", false],
  list_reviews: ["community:read", false],
  list_scheduled_posts: ["posts:read", false],
  propose_course_purchase: [null, false],
  propose_settings_change: [null, true],
  remove_member: ["members:moderate", true],
  schedule_post: ["posts:write", false],
  search_community: ["posts:read", false],
  submit_task_result: ["courses:read", false],
};

describe("MCP tool registry", () => {
  it("requires the reviewed scope and marks the reviewed destructive tools", () => {
    expect(
      Object.fromEntries(
        tools.map((tool) => [
          tool.name,
          [tool.entry.meta.scope, tool.annotations.destructiveHint] as const,
        ]),
      ),
    ).toEqual(security);
  });

  it("generates the same tool shapes from the route metadata", () => {
    expect(
      tools.map((tool) => ({
        name: tool.name,
        operation: `${tool.operation.method} ${tool.operation.path}`,
        action: tool.entry.meta.action,
        userContent: tool.userContent,
        inputs: tool.inputSchema.properties,
        required: tool.inputSchema.required ?? [],
      })),
    ).toMatchSnapshot();
  });

  it("maps every tool to a REST operation with the same authorization", () => {
    for (const tool of tools) {
      const entry = entries.find(
        (candidate) => candidate.meta.operationId === tool.entry.meta.operationId,
      );
      expect(entry, tool.name).toBeDefined();
      expect(tool.entry.meta).toBe(entry?.meta);
      expect(tool.entry.request).toStrictEqual(entry?.request);
      expect(`/api${entry?.path}`).toBe(tool.operation.path);
      expect(entry?.method).toBe(tool.operation.method);
      expect({ scope: tool.entry.meta.scope, action: tool.entry.meta.action }).toEqual(
        routeScopes[tool.entry.meta.operationId],
      );
      expect(tokenDecision(everything, tool.entry, tool.operation.method).kind, tool.name).not.toBe(
        "refuse",
      );
    }
  });

  it("exposes each tool named in the route metadata exactly once", () => {
    const declared = entries.flatMap((entry) => (entry.meta.mcp ?? []).map((meta) => meta.tool));
    expect(tools.map((tool) => tool.name).sort()).toEqual([...declared].sort());
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("offers no tool that connects Stripe, so Creator Terms are accepted only by a person", () => {
    const connectOperations = ["connectStripe", "connectOwnStripeKeys"];
    for (const tool of tools) {
      expect(connectOperations, tool.name).not.toContain(tool.entry.meta.operationId);
    }
  });

  it("never asks for the community, which comes from the token", () => {
    for (const tool of tools) {
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("slug");
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("communityId");
    }
  });

  it("marks reads as read only and every member content tool in its description", () => {
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(tool.operation.method === "GET");
      if (tool.userContent) expect(tool.description).toContain("untrusted_content");
    }
  });

  it("never offers create_event the notify members flag, which only a signed in person may set", () => {
    const createEvent = tools.find((tool) => tool.name === "create_event");
    expect(Object.keys(createEvent?.inputSchema.properties ?? {})).not.toContain("notifyMembers");
    expect(Object.keys(createEvent?.inputSchema.properties ?? {})).toContain("coverKey");
  });

  it("lets write tools return a pending approval in their output schema", () => {
    const removal = tools.find((tool) => tool.name === "remove_member");
    expect(JSON.stringify(removal?.outputSchema)).toContain("#/$defs/ApprovalPending");
  });

  it("gives agents the course level lock that REST returns", () => {
    for (const name of ["list_courses", "get_course"]) {
      const output = JSON.stringify(tools.find((tool) => tool.name === name)?.outputSchema);
      expect(output, name).toContain('"requiredLevel"');
      expect(output, name).toContain('"locked"');
    }
  });
});
