import type { ApiCredential } from "@cohory/authz";
import { newId } from "@cohory/db";
import { z } from "@hono/zod-openapi";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { routeMeta, type OperationId } from "../route-meta";
import { courseParams } from "../routes/courses-schemas";
import { personParams, updateSettingsBodySchema } from "../routes/manage-schemas";
import { approvalView, createApprovalsStub } from "../test/approvals-stub";
import { containedPath, createApprovalGateway, type RouteRequestSchemas } from "./gateway";
import type { ReplayRequest } from "./replay";

const slug = "makers";
const communityId = newId();
const slugBase = `/api/v1/communities/${slug}`;
const idBase = `/api/v1/communities/${communityId}`;
const approvals = createApprovalsStub();
let reads: ReplayRequest[] = [];

const credential: ApiCredential = {
  type: "agent",
  tokenId: newId(),
  agentId: newId(),
  communityId,
  scopes: ["proposals:write", "courses:write", "members:moderate"],
  via: "api",
};

const currentSettings = { name: "Makers", privacy: "private", description: null };

const gateway = createApprovalGateway({
  approvals: () => approvals,
  replay: async (request) => {
    reads.push(request);
    if (request.path.endsWith("/manage/settings")) {
      return Response.json(currentSettings);
    }
    return Response.json({ title: "Read through the owner", name: "Someone", role: "member" });
  },
});

function app(operationId: OperationId, request: RouteRequestSchemas) {
  return new Hono().all("*", (c) => {
    const segments = c.req.path.split("/").map((part) => decodeURIComponent(part));
    const params: Record<string, string> =
      operationId === "deleteCourse"
        ? { slug, courseSlug: segments[6] ?? "" }
        : operationId === "removeMember"
          ? { slug, userId: segments[7] ?? "" }
          : { slug };
    return gateway.propose(c, {
      meta: routeMeta(operationId),
      request,
      params,
      credential,
      userId: newId(),
      communitySlug: slug,
      category: "removal",
    });
  });
}

beforeEach(() => {
  reads = [];
  approvals.propose.mockReset();
  approvals.propose.mockImplementation(async () => approvalView());
});

describe("containedPath", () => {
  it.each([
    [`${slugBase}/courses/intro`, `${slugBase}/courses/intro`],
    [slugBase, slugBase],
    [`${idBase}/payments/plan`, `${idBase}/payments/plan`],
    [`${slugBase}/courses/a%2Fb`, `${slugBase}/courses/a%2Fb`],
  ])("keeps %s inside the proposal's community", (path, expected) => {
    expect(containedPath(path, [slugBase, idBase])).toBe(expected);
  });

  it.each([
    [`${slugBase}/courses/../../other/courses/x`],
    [`${slugBase}/courses/%2e%2e/%2e%2e/other`],
    [`${slugBase}-other/courses/x`],
    ["/api/v1/communities/other"],
    [`${slugBase}/courses/x?as=owner`],
    ["//evil.example/api"],
    ["http://evil.example/api/v1/communities/makers"],
  ])("refuses %s", (path) => {
    expect(containedPath(path, [slugBase, idBase])).toBeNull();
  });
});

describe("proposals with path traversal", () => {
  it("refuses a course slug that leaves the community and reads nothing", async () => {
    const response = await app("deleteCourse", { params: courseParams, multipart: false }).request(
      `${slugBase}/courses/..%2F..%2Fother%2Fcourses%2Fsecret`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(422);
    expect(reads).toEqual([]);
    expect(approvals.propose).not.toHaveBeenCalled();
  });

  it("refuses a member id that is not a user id and reads nothing", async () => {
    const response = await app("removeMember", { params: personParams, multipart: false }).request(
      `${slugBase}/manage/people/..%2F..%2F..%2Fother%2Fmembers%2Fx/remove`,
      { method: "POST" },
    );

    expect(response.status).toBe(422);
    expect(reads).toEqual([]);
    expect(approvals.propose).not.toHaveBeenCalled();
  });

  it("never reads outside the community even when the route schema allows the value", async () => {
    const response = await app("deleteCourse", { multipart: false }).request(
      `${slugBase}/courses/..%2F..%2Fother%2Fcourses%2Fsecret`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(202);
    expect(reads.map((read) => read.path)).toEqual([
      `${slugBase}/courses/..%2F..%2Fother%2Fcourses%2Fsecret`,
    ]);
  });

  it("reads the named course of the community for a valid slug", async () => {
    const response = await app("deleteCourse", { params: courseParams, multipart: false }).request(
      `${slugBase}/courses/getting-started`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(202);
    expect(reads.map((read) => read.path)).toEqual([`${slugBase}/courses/getting-started`]);
    expect(approvals.propose.mock.calls[0]?.[2].summary).toBe(
      'delete the course "Read through the owner"',
    );
  });
});

function proposal() {
  const call = approvals.propose.mock.calls[0];
  if (!call) throw new Error("no proposal");
  return call[2];
}

function patchSettings(
  body: unknown,
  json: RouteRequestSchemas["json"] = updateSettingsBodySchema,
) {
  return app("updateCommunitySettings", { json, multipart: false }).request(
    `${slugBase}/manage/settings?ignored=1`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const junk = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`x${index}`, "noise"]));

describe("recorded input and diff", () => {
  it("records and shows only the fields the route keeps when junk keys come first", async () => {
    const response = await patchSettings({ ...junk, privacy: "public" });

    expect(response.status).toBe(202);
    expect(proposal().input).toEqual({ params: { slug }, query: {}, body: { privacy: "public" } });
    expect(proposal().diff).toEqual([{ label: "Privacy", before: "private", after: "public" }]);
  });

  it("drops a look alike key so the diff shows the change that runs", async () => {
    const response = await patchSettings({ "privacy ": "private", privacy: "public" });

    expect(response.status).toBe(202);
    expect(proposal().input.body).toEqual({ privacy: "public" });
    expect(proposal().diff).toEqual([{ label: "Privacy", before: "private", after: "public" }]);
  });

  it("stores the parsed body, not the raw one", async () => {
    const response = await patchSettings({ name: "Renamed", unknown: { nested: true } });

    expect(response.status).toBe(202);
    expect(proposal().input.body).toEqual({ name: "Renamed" });
  });

  it("refuses a proposal whose diff would not fit instead of cutting it", async () => {
    const wide = z.object(
      Object.fromEntries(
        Array.from({ length: 13 }, (_, index) => [`field${index}`, z.number().optional()]),
      ),
    );
    const body = Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => [`field${index}`, index]),
    );

    const response = await patchSettings(body, wide);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
    expect(approvals.propose).not.toHaveBeenCalled();
  });
});
