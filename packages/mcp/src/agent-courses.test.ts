import { describe, expect, it } from "vitest";

import { caller, harness, json, rpc } from "./test/harness";

interface ListBody {
  result?: { tools?: { name: string; description?: string }[] };
}

interface CallBody {
  result?: { structuredContent?: { untrusted_content?: { notice: string; source: string } } };
}

const noApi = () => json({ error: { code: "unexpected", message: "not called" } }, 500);

async function names(standing: "member" | "lapsed", scopes: Parameters<typeof caller>[0]) {
  const { handle } = harness(caller(scopes, { role: "member", standing }), noApi);
  const body = (await (await handle(rpc("tools/list"))).json()) as ListBody;
  return (body.result?.tools ?? []).map((tool) => tool.name);
}

describe("agent course tools", () => {
  it("shows a delegated reader the course tools and a proposer the purchase tool", async () => {
    const reader = await names("member", ["courses:read"]);
    expect(reader).toEqual(
      expect.arrayContaining([
        "list_courses",
        "get_course",
        "get_lesson",
        "list_my_courses",
        "get_course_agent_material",
        "get_agent_task",
        "get_agent_material_file",
        "get_skill_export",
        "submit_task_result",
        "list_my_submissions",
      ]),
    );
    expect(reader).not.toContain("propose_course_purchase");
    expect(await names("member", ["courses:read", "proposals:write"])).toContain(
      "propose_course_purchase",
    );
  });

  it("shows an agent whose person is no longer a member only the purchase and approval tools", async () => {
    expect((await names("lapsed", ["courses:read", "proposals:write"])).sort()).toEqual([
      "get_approval_status",
      "list_my_approval_requests",
      "propose_course_purchase",
    ]);
  });

  it("wraps course material in untrusted_content with the sandbox notice", async () => {
    const { handle } = harness(caller(["courses:read"], { role: "member" }), () =>
      json({ notice: "data", data: [] }, 200),
    );
    const response = await handle(rpc("tools/call", { name: "list_my_courses", arguments: {} }));
    const body = (await response.json()) as CallBody;
    expect(body.result?.structuredContent?.untrusted_content).toMatchObject({
      source: "Cohory course material",
      notice: expect.stringContaining("own sandbox"),
    });
  });
});
