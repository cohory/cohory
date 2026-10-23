import {
  DeletionBlockedByBillingError,
  ExitInProgressError,
  ManualCancellationRequiredError,
} from "@cohory/payments";
import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import {
  CommunityDeletionConflictError,
  CommunityNotArchivedError,
  CommunityValidationError,
  createCommunitiesService,
  deriveAppearanceTokens,
  appearanceToCssVariables,
  InviteUnavailableError,
  PaymentRequiredError,
  type AppearanceView,
  type GalleryItemView,
  type InviteLinkView,
  type ManageSettingsView,
} from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { beforeEach, describe, expect, it } from "vitest";
import { apiDeps } from "../services";

import { createApi, createOpenApiDocument } from "../app";
import { createManageStub, type ManageStub as Stub } from "../test/manage-stub";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

const at = new Date("2026-10-18T10:00:00.000Z");

let stub: Stub;
let api: ReturnType<typeof createApi>;
let communityId: string;
let owner: string;

function settings(): ManageSettingsView {
  return {
    id: communityId,
    slug: "makers",
    name: "Makers",
    description: null,
    privacy: "private",
    gamificationEnabled: true,
    pointsForLessons: false,
    pointsForEvents: false,
    reviewsEnabled: false,
    levelNames: Array.from({ length: 9 }, (_, i) => `Level ${i + 1}`),
    joinMode: "approval",
    joinQuestions: [],
    refundPolicy: null,
    archivedAt: null,
  };
}

function appearance(): AppearanceView {
  const tokens = deriveAppearanceTokens({ accent: "#0F766E" });
  return {
    accent: "#0F766E",
    logoUrl: null,
    coverUrl: "/api/uploads/cover.png",
    font: "inter",
    cardStyle: "minimal",
    theme: "system",
    tokens,
    cssVariables: appearanceToCssVariables(tokens),
    notices: [],
    detailedDescription: null,
    about: { whatYouGet: [], host: null, faq: [] },
  };
}

const videoItem: GalleryItemView = {
  id: newId(),
  kind: "video_embed",
  provider: "youtube",
  url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  altText: null,
  position: 0,
};

function invite(): InviteLinkView {
  return {
    id: newId(),
    token: "t".repeat(43),
    path: `/join/${"t".repeat(43)}`,
    createdBy: owner,
    expiresAt: null,
    maxUses: 3,
    useCount: 0,
    requiresApproval: false,
    label: null,
    revokedAt: null,
    createdAt: at,
    status: "active",
  };
}

beforeEach(() => {
  const communitiesRepo = createFakeRepository();
  const community = communitiesRepo.addCommunity({
    slug: communitySlugSchema.parse("makers"),
    privacy: "private",
  });
  communityId = community.id;
  owner = newId();
  communitiesRepo.addMembership({ communityId, userId: owner, role: "owner", status: "active" });
  stub = createManageStub();
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(communitiesRepo),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
      manage: stub,
    }),
  );
});

async function call(
  path: string,
  init: { method?: string; userId?: string; body?: unknown; form?: FormData } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("manage settings routes", () => {
  it("returns the overview stats for the community id", async () => {
    const stats = {
      memberCount: 4,
      newMembers7d: 1,
      posts7d: 2,
      comments7d: 3,
      upcomingEvents: 1,
      publishedCourses: 0,
    };
    stub.getOverviewStats.mockResolvedValue(stats);

    const response = await call("/communities/makers/manage/overview", { userId: owner });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(stats);
    expect(stub.getOverviewStats.mock.calls[0]?.[1]).toBe(communityId);
  });

  it("returns usage against the fair use limits", async () => {
    const usage = {
      tier: "free" as const,
      members: { used: 4, limit: 1000, state: "ok" as const },
      storageBytes: { used: 10, limit: null, state: "ok" as const },
      uploadBytes: null,
    };
    stub.getUsage.mockResolvedValue(usage);

    const response = await call("/communities/makers/manage/usage", { userId: owner });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(usage);
    expect(stub.getUsage.mock.calls[0]?.[1]).toBe(communityId);
  });

  it("patches settings and serializes dates", async () => {
    stub.updateSettings.mockResolvedValue({ ...settings(), archivedAt: at });

    const response = await call("/communities/makers/manage/settings", {
      method: "PATCH",
      userId: owner,
      body: { name: "New", gamificationEnabled: false },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ archivedAt: at.toISOString() });
    expect(stub.updateSettings.mock.calls[0]?.[2]).toEqual({
      name: "New",
      gamificationEnabled: false,
    });
  });

  it("passes the learning point switches to the service and returns them", async () => {
    stub.updateSettings.mockResolvedValue({ ...settings(), pointsForLessons: true });

    const response = await call("/communities/makers/manage/settings", {
      method: "PATCH",
      userId: owner,
      body: { pointsForLessons: true, pointsForEvents: false },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pointsForLessons: true, pointsForEvents: false });
    expect(stub.updateSettings.mock.calls[0]?.[2]).toEqual({
      pointsForLessons: true,
      pointsForEvents: false,
    });
  });

  it("answers 403 when the service refuses a moderator's learning point change", async () => {
    stub.updateSettings.mockRejectedValueOnce(new ForbiddenError("update", "settings"));

    const response = await call("/communities/makers/manage/settings", {
      method: "PATCH",
      userId: owner,
      body: { pointsForEvents: true },
    });

    expect(response.status).toBe(403);
  });

  it("answers 422 for a wrong type before calling the service", async () => {
    const response = await call("/communities/makers/manage/settings", {
      method: "PATCH",
      userId: owner,
      body: { gamificationEnabled: "no" },
    });

    expect(response.status).toBe(422);
    expect(stub.updateSettings).not.toHaveBeenCalled();
  });

  it("maps service refusals to 401, 403, and 409", async () => {
    stub.getSettings.mockRejectedValueOnce(new UnauthenticatedError());
    expect((await call("/communities/makers/manage/settings")).status).toBe(401);

    stub.getSettings.mockRejectedValueOnce(new ForbiddenError("read", "settings"));
    expect((await call("/communities/makers/manage/settings", { userId: owner })).status).toBe(403);

    stub.deleteCommunity.mockRejectedValueOnce(new CommunityNotArchivedError());
    const response = await call("/communities/makers/manage", { method: "DELETE", userId: owner });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("community_not_archived");
  });

  it("answers 202 while subscriptions are cancelled and passes the delete options", async () => {
    stub.deleteCommunity.mockResolvedValueOnce({ kind: "deleting" });

    const response = await call("/communities/makers/manage", {
      method: "DELETE",
      userId: owner,
      body: { includeLinked: false, confirmedManualCancellation: true },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "deleting" });
    expect(stub.deleteCommunity.mock.calls.at(-1)?.[2]).toEqual({
      includeLinked: false,
      confirmedManualCancellation: true,
    });
  });

  it("refuses a delete with the paid member conflict codes", async () => {
    stub.deleteCommunity.mockRejectedValueOnce(new ManualCancellationRequiredError(3));
    const manual = await call("/communities/makers/manage", { method: "DELETE", userId: owner });
    expect(manual.status).toBe(409);
    expect(await manual.json()).toMatchObject({
      error: { code: "manual_cancellation_required", details: { count: 3 } },
    });

    stub.deleteCommunity.mockRejectedValueOnce(new DeletionBlockedByBillingError("unpaid_invoice"));
    const billing = await call("/communities/makers/manage", { method: "DELETE", userId: owner });
    expect(billing.status).toBe(409);
    expect(await billing.json()).toMatchObject({
      error: {
        code: "deletion_blocked_billing",
        message: "Pay the open Cohory invoice before deleting this community.",
      },
    });

    stub.deleteCommunity.mockRejectedValueOnce(new ExitInProgressError());
    const running = await call("/communities/makers/manage", { method: "DELETE", userId: owner });
    expect(running.status).toBe(409);
    expect(await errorCode(running)).toBe("exit_in_progress");

    stub.deleteCommunity.mockRejectedValueOnce(new CommunityDeletionConflictError());
    const conflict = await call("/communities/makers/manage", { method: "DELETE", userId: owner });
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("deletion_conflict");
  });

  it("deletes with 204 and transfers, archives, and unarchives", async () => {
    stub.deleteCommunity.mockResolvedValue({ kind: "deleted" });
    stub.transferOwnership.mockResolvedValue(settings());
    stub.archiveCommunity.mockResolvedValue(settings());
    stub.unarchiveCommunity.mockResolvedValue(settings());
    const target = newId();

    expect(
      (await call("/communities/makers/manage", { method: "DELETE", userId: owner })).status,
    ).toBe(204);
    expect(
      (
        await call("/communities/makers/manage/transfer", {
          method: "POST",
          userId: owner,
          body: { userId: target },
        })
      ).status,
    ).toBe(200);
    expect(stub.transferOwnership.mock.calls[0]?.[2]).toBe(target);
    expect(
      (await call("/communities/makers/manage/archive", { method: "POST", userId: owner })).status,
    ).toBe(200);
    expect(
      (await call("/communities/makers/manage/unarchive", { method: "POST", userId: owner }))
        .status,
    ).toBe(200);
  });

  it("passes the paid member choice to archive and maps a running exit to 409", async () => {
    stub.archiveCommunity.mockResolvedValue(settings());

    await call("/communities/makers/manage/archive", { method: "POST", userId: owner });
    await call("/communities/makers/manage/archive", {
      method: "POST",
      userId: owner,
      body: { paidMembers: "keep_billing", includeLinked: false },
    });
    const invalid = await call("/communities/makers/manage/archive", {
      method: "POST",
      userId: owner,
      body: { paidMembers: "cancel_now" },
    });

    expect(stub.archiveCommunity.mock.calls[0]?.[2]).toEqual({});
    expect(stub.archiveCommunity.mock.calls[1]?.[2]).toEqual({
      paidMembers: "keep_billing",
      includeLinked: false,
    });
    expect(invalid.status).toBe(422);

    stub.archiveCommunity.mockRejectedValueOnce(new ExitInProgressError());
    const busy = await call("/communities/makers/manage/archive", {
      method: "POST",
      userId: owner,
    });
    expect(busy.status).toBe(409);
    expect(await errorCode(busy)).toBe("exit_in_progress");
  });

  it("answers 404 for an unknown community", async () => {
    expect((await call("/communities/nowhere/manage/overview", { userId: owner })).status).toBe(
      404,
    );
  });
});

describe("manage appearance routes", () => {
  it("serves the public appearance to a signed out visitor", async () => {
    stub.getAppearance.mockResolvedValue(appearance());

    const response = await call("/communities/makers/appearance");

    expect(response.status).toBe(200);
    const body = (await response.json()) as AppearanceView;
    expect(body.cssVariables.light["--color-accent"]).toBe("#0F766E");
    expect(stub.getAppearance).toHaveBeenCalledWith(communityId);
  });

  it("patches appearance", async () => {
    stub.updateAppearance.mockResolvedValue(appearance());

    const response = await call("/communities/makers/manage/appearance", {
      method: "PATCH",
      userId: owner,
      body: { accent: "#0F766E", cardStyle: "soft", logo: null },
    });

    expect(response.status).toBe(200);
    expect(stub.updateAppearance.mock.calls[0]?.[2]).toEqual({
      accent: "#0F766E",
      cardStyle: "soft",
      logo: null,
    });
  });

  it.each(["logo", "cover"] as const)("uploads a %s as multipart", async (kind) => {
    stub.uploadBranding.mockResolvedValue(appearance());
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0x89, 0x50])], "x.png", { type: "image/png" }));

    const response = await call(`/communities/makers/manage/appearance/${kind}`, {
      method: "POST",
      userId: owner,
      form,
    });

    expect(response.status).toBe(200);
    const [, id, calledKind, upload] = stub.uploadBranding.mock.calls[0] ?? [];
    expect(id).toBe(communityId);
    expect(calledKind).toBe(kind);
    expect(upload?.declaredType).toBe("image/png");
  });
});

describe("manage gallery routes", () => {
  const gallery = "/communities/makers/manage/appearance/gallery";

  it("adds a video link and answers 201 with the gallery", async () => {
    stub.addGalleryVideo.mockResolvedValue([videoItem]);

    const response = await call(`${gallery}/videos`, {
      method: "POST",
      userId: owner,
      body: { url: "https://youtu.be/dQw4w9WgXcQ" },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: [videoItem] });
    expect(stub.addGalleryVideo).toHaveBeenCalledWith(
      { kind: "user", userId: owner, platformAdmin: false },
      communityId,
      { url: "https://youtu.be/dQw4w9WgXcQ" },
    );
  });

  it("uploads an image as multipart with alt text", async () => {
    stub.addGalleryImage.mockResolvedValue([]);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0x89, 0x50])], "x.png", { type: "image/png" }));
    form.set("altText", "Our studio");

    const response = await call(`${gallery}/images`, { method: "POST", userId: owner, form });

    expect(response.status).toBe(201);
    const [, id, upload, altText] = stub.addGalleryImage.mock.calls[0] ?? [];
    expect(id).toBe(communityId);
    expect(upload?.declaredType).toBe("image/png");
    expect(altText).toBe("Our studio");
  });

  it("reorders, updates alt text, and removes items", async () => {
    stub.reorderGallery.mockResolvedValue([videoItem]);
    stub.updateGalleryItem.mockResolvedValue([videoItem]);
    stub.removeGalleryItem.mockResolvedValue([]);

    const reordered = await call(`${gallery}/order`, {
      method: "PUT",
      userId: owner,
      body: { itemIds: [videoItem.id] },
    });
    const updated = await call(`${gallery}/${videoItem.id}`, {
      method: "PATCH",
      userId: owner,
      body: { altText: "Intro" },
    });
    const removed = await call(`${gallery}/${videoItem.id}`, { method: "DELETE", userId: owner });

    expect([reordered.status, updated.status, removed.status]).toEqual([200, 200, 200]);
    expect(stub.reorderGallery.mock.calls[0]?.[2]).toEqual({ itemIds: [videoItem.id] });
    expect(stub.updateGalleryItem.mock.calls[0]?.slice(2)).toEqual([
      videoItem.id,
      { altText: "Intro" },
    ]);
    expect(await removed.json()).toEqual({ data: [] });
  });

  it("maps a refused link to 422 and a denied role to 403", async () => {
    stub.addGalleryVideo.mockRejectedValueOnce(
      new CommunityValidationError([{ path: "url", message: "Paste a YouTube link." }]),
    );
    stub.addGalleryVideo.mockRejectedValueOnce(new ForbiddenError("update", "appearance"));
    const body = { url: "https://evil.example/v" };

    const refused = await call(`${gallery}/videos`, { method: "POST", userId: owner, body });
    const denied = await call(`${gallery}/videos`, { method: "POST", userId: owner, body });

    expect(refused.status).toBe(422);
    expect(denied.status).toBe(403);
  });

  it("requires a session and a valid item id", async () => {
    stub.addGalleryVideo.mockRejectedValue(new UnauthenticatedError());
    const anonymous = await call(`${gallery}/videos`, {
      method: "POST",
      body: { url: "https://youtu.be/dQw4w9WgXcQ" },
    });
    const badId = await call(`${gallery}/not-a-uuid`, { method: "DELETE", userId: owner });

    expect(anonymous.status).toBe(401);
    expect(badId.status).toBe(422);
    expect(stub.removeGalleryItem).not.toHaveBeenCalled();
  });
});

describe("manage people routes", () => {
  it("lists people with query filters", async () => {
    stub.listMembersForManage.mockResolvedValue({
      data: [
        {
          userId: owner,
          name: "Owner",
          username: null,
          image: null,
          email: "owner@example.test",
          role: "owner",
          status: "active",
          joinedAt: at,
          lastActiveAt: at,
          signedIn: true,
          access: null,
          level: 1,
          points: 0,
        },
      ],
      nextCursor: null,
    });

    const response = await call(
      "/communities/makers/manage/people?status=banned&role=member&limit=10",
      {
        userId: owner,
      },
    );

    expect(response.status).toBe(200);
    expect(stub.listMembersForManage.mock.calls[0]?.[2]).toEqual({
      status: "banned",
      role: "member",
      limit: 10,
    });
    expect(((await response.json()) as { data: { joinedAt: string }[] }).data[0]?.joinedAt).toBe(
      at.toISOString(),
    );
  });

  it("passes inactiveDays to the service and returns lastActiveAt", async () => {
    stub.listMembersForManage.mockResolvedValue({
      data: [
        {
          userId: owner,
          name: "Lurker",
          username: null,
          image: null,
          email: null,
          role: "member",
          status: "active",
          joinedAt: at,
          lastActiveAt: new Date("2026-05-01T00:00:00.000Z"),
          signedIn: true,
          access: null,
          level: 1,
          points: 0,
        },
      ],
      nextCursor: null,
    });

    const response = await call("/communities/makers/manage/people?inactiveDays=30", {
      userId: owner,
    });

    expect(response.status).toBe(200);
    expect(stub.listMembersForManage.mock.calls.at(-1)?.[2]).toEqual({ inactiveDays: 30 });
    const body = (await response.json()) as { data: { lastActiveAt: string }[] };
    expect(body.data[0]?.lastActiveAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it.each(["0", "3651", "soon"])("rejects inactiveDays=%s", async (value) => {
    const response = await call(`/communities/makers/manage/people?inactiveDays=${value}`, {
      userId: owner,
    });
    expect(response.status).toBe(422);
  });

  it("changes a role and refuses owner as a target role", async () => {
    const target = newId();
    stub.changeRole.mockResolvedValue({ userId: target, role: "moderator", status: "active" });

    const ok = await call(`/communities/makers/manage/people/${target}/role`, {
      method: "PATCH",
      userId: owner,
      body: { role: "moderator" },
    });
    const bad = await call(`/communities/makers/manage/people/${target}/role`, {
      method: "PATCH",
      userId: owner,
      body: { role: "owner" },
    });

    expect(ok.status).toBe(200);
    expect(stub.changeRole.mock.calls[0]?.slice(1)).toEqual([communityId, target, "moderator"]);
    expect(bad.status).toBe(422);
  });

  it.each([
    ["remove", "removeMember"],
    ["ban", "banMember"],
    ["unban", "unbanMember"],
  ] as const)("posts %s to %s", async (action, method) => {
    const target = newId();
    stub[method].mockResolvedValue({ userId: target, role: "member", status: "removed" });

    const response = await call(`/communities/makers/manage/people/${target}/${action}`, {
      method: "POST",
      userId: owner,
    });

    expect(response.status).toBe(200);
    expect(stub[method].mock.calls[0]?.slice(1)).toEqual([communityId, target]);
  });
});

describe("invite routes", () => {
  it("creates, lists, and revokes invite links", async () => {
    stub.createInviteLink.mockResolvedValue(invite());
    stub.listInviteLinks.mockResolvedValue([invite()]);
    stub.revokeInviteLink.mockResolvedValue({ ...invite(), revokedAt: at, status: "revoked" });

    const created = await call("/communities/makers/manage/invites", {
      method: "POST",
      userId: owner,
      body: { expiresAt: "2026-11-01T00:00:00.000Z", maxUses: 3 },
    });
    const listed = await call("/communities/makers/manage/invites", { userId: owner });
    const revokedId = newId();
    const revoked = await call(`/communities/makers/manage/invites/${revokedId}`, {
      method: "DELETE",
      userId: owner,
    });

    expect(created.status).toBe(201);
    expect(stub.createInviteLink.mock.calls[0]?.[2]).toEqual({
      expiresAt: new Date("2026-11-01T00:00:00.000Z"),
      maxUses: 3,
      requiresApproval: false,
    });
    expect(((await listed.json()) as { data: unknown[] }).data).toHaveLength(1);
    expect(revoked.status).toBe(200);
    expect(stub.revokeInviteLink.mock.calls[0]?.[2]).toBe(revokedId);
  });

  it("redeems a token and maps an unavailable invite to 410", async () => {
    stub.redeemInvite.mockResolvedValueOnce({
      community: { id: communityId, slug: "makers", name: "Makers" },
      membership: {
        id: newId(),
        communityId,
        userId: owner,
        role: "member",
        status: "active",
        joinedAt: at,
      },
      request: null,
    });
    stub.redeemInvite.mockRejectedValueOnce(new InviteUnavailableError());

    const ok = await call(`/invites/${"t".repeat(43)}/redeem`, { method: "POST", userId: owner });
    const gone = await call(`/invites/${"t".repeat(43)}/redeem`, { method: "POST", userId: owner });

    expect(ok.status).toBe(200);
    expect(stub.redeemInvite.mock.calls[0]?.[1]).toBe("t".repeat(43));
    expect(gone.status).toBe(410);
    expect(await errorCode(gone)).toBe("invite_unavailable");
  });

  it("answers 402 when the invite leads to a paid community", async () => {
    stub.redeemInvite.mockRejectedValueOnce(new PaymentRequiredError());

    const response = await call(`/invites/${"t".repeat(43)}/redeem`, {
      method: "POST",
      userId: owner,
    });

    expect(response.status).toBe(402);
    expect(await errorCode(response)).toBe("payment_required");
  });
});

describe("invite rate limits", () => {
  it("answers 429 with Retry-After once a member redeems too often", async () => {
    stub.redeemInvite.mockRejectedValue(new InviteUnavailableError());
    const rateLimiter = createRateLimiter({
      rules: { ...rateLimitDefaults, inviteRedeem: { max: 1, windowSeconds: 60 } },
    });
    const limitedApi = createApi(() =>
      apiDeps({
        resolveSession,
        communities: createCommunitiesService(createFakeRepository()),
        posts: createPostsService({
          repo: createFakePostsRepository(),
          storage: {
            put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
            publicUrl: (k) => k,
          },
        }),
        manage: stub,
        rateLimiter,
      }),
    );
    const redeem = () =>
      limitedApi.request(`/api/v1/invites/${"t".repeat(43)}/redeem`, {
        method: "POST",
        headers: { [sessionHeader]: owner },
      });

    const first = await redeem();
    const second = await redeem();

    expect(first.status).toBe(410);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
    expect(await errorCode(second)).toBe("rate_limited");
    expect(stub.redeemInvite).toHaveBeenCalledTimes(1);
  });
});

describe("members export route", () => {
  it("streams the CSV with an attachment filename", async () => {
    stub.exportMembersCsv.mockResolvedValue({
      filename: "makers-members-2026-10-18.csv",
      body: new Response("﻿email\r\n").body ?? new ReadableStream(),
    });

    const response = await call("/communities/makers/manage/export/members.csv", { userId: owner });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="makers-members-2026-10-18.csv"',
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("passes the list filters to the export", async () => {
    stub.exportMembersCsv.mockResolvedValue({
      filename: "makers-members-2026-10-18.csv",
      body: new Response("﻿email\r\n").body ?? new ReadableStream(),
    });

    const response = await call(
      "/communities/makers/manage/export/members.csv?inactiveDays=60&role=member",
      { userId: owner },
    );

    expect(response.status).toBe(200);
    expect(stub.exportMembersCsv.mock.calls.at(-1)?.[2]).toEqual({
      inactiveDays: 60,
      role: "member",
    });
  });

  it("passes the access and never signed in filters to the export", async () => {
    stub.exportMembersCsv.mockResolvedValue({
      filename: "makers-members-2026-10-18.csv",
      body: new Response("﻿email\r\n").body ?? new ReadableStream(),
    });

    const response = await call(
      "/communities/makers/manage/export/members.csv?access=past_due&neverSignedIn=true",
      { userId: owner },
    );

    expect(response.status).toBe(200);
    expect(stub.exportMembersCsv.mock.calls.at(-1)?.[2]).toEqual({
      access: "past_due",
      neverSignedIn: true,
    });
  });
});

describe("OpenAPI document for manage", () => {
  const document = createOpenApiDocument();

  it.each([
    ["/api/v1/communities/{slug}/manage/overview", "get", "getManageOverview"],
    ["/api/v1/communities/{slug}/manage/usage", "get", "getManageUsage"],
    ["/api/v1/communities/{slug}/manage/settings", "patch", "updateCommunitySettings"],
    ["/api/v1/communities/{slug}/manage/appearance", "patch", "updateCommunityAppearance"],
    ["/api/v1/communities/{slug}/manage/appearance/logo", "post", "uploadCommunityLogo"],
    ["/api/v1/communities/{slug}/manage/appearance/cover", "post", "uploadCommunityCover"],
    [
      "/api/v1/communities/{slug}/manage/appearance/gallery/images",
      "post",
      "addCommunityGalleryImage",
    ],
    [
      "/api/v1/communities/{slug}/manage/appearance/gallery/videos",
      "post",
      "addCommunityGalleryVideo",
    ],
    [
      "/api/v1/communities/{slug}/manage/appearance/gallery/order",
      "put",
      "reorderCommunityGallery",
    ],
    [
      "/api/v1/communities/{slug}/manage/appearance/gallery/{itemId}",
      "patch",
      "updateCommunityGalleryItem",
    ],
    [
      "/api/v1/communities/{slug}/manage/appearance/gallery/{itemId}",
      "delete",
      "removeCommunityGalleryItem",
    ],
    ["/api/v1/communities/{slug}/manage/people", "get", "listManagePeople"],
    ["/api/v1/communities/{slug}/manage/people/{userId}/role", "patch", "changeMemberRole"],
    ["/api/v1/communities/{slug}/manage/people/{userId}/remove", "post", "removeMember"],
    ["/api/v1/communities/{slug}/manage/people/{userId}/ban", "post", "banMember"],
    ["/api/v1/communities/{slug}/manage/people/{userId}/unban", "post", "unbanMember"],
    ["/api/v1/communities/{slug}/manage/invites", "get", "listInviteLinks"],
    ["/api/v1/communities/{slug}/manage/invites", "post", "createInviteLink"],
    ["/api/v1/communities/{slug}/manage/invites/{inviteId}", "delete", "revokeInviteLink"],
    ["/api/v1/communities/{slug}/manage/export/members.csv", "get", "exportMembersCsv"],
    ["/api/v1/communities/{slug}/manage/transfer", "post", "transferOwnership"],
    ["/api/v1/communities/{slug}/manage/archive", "post", "archiveCommunity"],
    ["/api/v1/communities/{slug}/manage/unarchive", "post", "unarchiveCommunity"],
    ["/api/v1/communities/{slug}/manage", "delete", "deleteCommunity"],
    ["/api/v1/communities/{slug}/appearance", "get", "getCommunityAppearance"],
    ["/api/v1/invites/{token}/redeem", "post", "redeemInvite"],
  ] as const)("documents %s %s as %s", (path, method, operationId) => {
    expect(document.paths?.[path]?.[method]?.operationId).toBe(operationId);
  });
});
