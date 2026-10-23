import { ForbiddenError } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";
import { createManageStub, type ManageStub } from "../test/manage-stub";

const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get("x-test-user");
  return userId ? { userId } : null;
};

let manage: ManageStub;
let api: ReturnType<typeof createApi>;
let communityId: string;
let owner: string;

beforeEach(() => {
  const repo = createFakeRepository();
  const community = repo.addCommunity({ slug: communitySlugSchema.parse("makers") });
  communityId = community.id;
  owner = newId();
  repo.addMembership({ communityId, userId: owner, role: "owner" });
  manage = createManageStub();
  const posts = createPostsService({
    repo: createFakePostsRepository(),
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      publicUrl: (key) => `/files/${key}`,
    },
  });
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(repo),
      posts,
      manage,
    }),
  );
});

function call(path: string, userId: string = owner) {
  const headers = new Headers();
  headers.set("x-test-user", userId);
  return api.request(`/api/v1/communities/makers/manage${path}`, { headers });
}

describe("audit log routes", () => {
  it("lists entries with the filters passed through", async () => {
    const at = new Date("2026-10-18T10:00:00.000Z");
    manage.listAuditLog.mockResolvedValue({
      data: [
        {
          id: newId(),
          createdAt: at,
          actor: { id: owner, name: "Owner" },
          actorType: "user",
          via: "web",
          tokenId: null,
          agent: null,
          action: "member.banned",
          target: null,
          targetName: null,
          metadata: { reason: "spam" },
        },
      ],
      nextCursor: null,
      actions: ["member.banned"],
    });

    const response = await call("/audit-log?action=member.banned&from=2026-10-01&limit=10");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { createdAt: string }[]; actions: string[] };
    expect(body.data[0]?.createdAt).toBe(at.toISOString());
    expect(body.actions).toEqual(["member.banned"]);
    expect(manage.listAuditLog).toHaveBeenCalledWith(expect.anything(), communityId, {
      action: "member.banned",
      from: "2026-10-01",
      limit: 10,
    });
  });

  it("rejects a malformed date and maps a refusal to 403", async () => {
    expect((await call("/audit-log?from=yesterday")).status).toBe(422);
    manage.listAuditLog.mockRejectedValue(new ForbiddenError("read", "audit_log"));
    expect((await call("/audit-log")).status).toBe(403);
  });

  it("downloads CSV with a truncation header", async () => {
    manage.exportAuditLogCsv.mockResolvedValue({
      filename: "makers-audit-log-2026-10-18.csv",
      body: "﻿created_at\r\n",
      truncated: false,
    });

    const response = await call("/audit-log.csv?action=member.banned");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "makers-audit-log-2026-10-18.csv",
    );
    expect(response.headers.get("x-truncated")).toBe("false");
    expect(manage.exportAuditLogCsv).toHaveBeenCalledWith(expect.anything(), communityId, {
      action: "member.banned",
    });
  });

  it("passes the token filter to the list and the CSV", async () => {
    const tokenId = "0192a7c0-0000-7000-8000-0000000000aa";
    manage.listAuditLog.mockResolvedValue({ data: [], nextCursor: null, actions: [] });
    manage.exportAuditLogCsv.mockResolvedValue({
      filename: "makers-audit-log-2026-10-18.csv",
      body: "﻿created_at\r\n",
      truncated: false,
    });

    expect((await call(`/audit-log?tokenId=${tokenId}`)).status).toBe(200);
    expect((await call(`/audit-log.csv?tokenId=${tokenId}`)).status).toBe(200);
    expect((await call("/audit-log?tokenId=nope")).status).toBe(422);

    expect(manage.listAuditLog).toHaveBeenCalledWith(expect.anything(), communityId, { tokenId });
    expect(manage.exportAuditLogCsv).toHaveBeenCalledWith(expect.anything(), communityId, {
      tokenId,
    });
  });
});
