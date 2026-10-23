import type { ManageMember } from "@cohory/communities";
import type { ReportGroupView } from "@cohory/posts";
import { describe, expect, it } from "vitest";

import {
  appUrl,
  inviteUrl,
  personActions,
  toInviteRow,
  toPersonRow,
  toReportRow,
  type Viewer,
} from "./views";

const ownerId = "0192f2a4-0000-7000-8000-0000000000a1";
const adminId = "0192f2a4-0000-7000-8000-0000000000a2";
const modId = "0192f2a4-0000-7000-8000-0000000000a3";

function viewer(role: Viewer["role"], userId = ownerId): Viewer {
  return { actor: { kind: "user", userId, platformAdmin: false }, role };
}

function member(overrides: Partial<ManageMember> = {}): ManageMember {
  return {
    userId: "0192f2a4-0000-7000-8000-0000000000b1",
    name: "Ada Lovelace",
    username: "ada",
    image: null,
    email: "ada@cohory.local",
    role: "member",
    status: "active",
    joinedAt: new Date("2026-10-01T09:00:00.000Z"),
    lastActiveAt: new Date("2026-10-12T08:00:00.000Z"),
    signedIn: true,
    access: null,
    level: 2,
    points: 12,
    ...overrides,
  };
}

describe("personActions", () => {
  it("offers a points reset to admins and the owner for members who have points", () => {
    expect(personActions(viewer("admin", adminId), member()).resetPoints).toBe(true);
    expect(personActions(viewer("owner"), member({ points: 0 })).resetPoints).toBe(false);
    expect(personActions(viewer("moderator", modId), member()).resetPoints).toBe(false);
  });

  it("lets the owner set any non owner role and remove or ban", () => {
    expect(personActions(viewer("owner"), member())).toEqual({
      roles: ["admin", "moderator"],
      remove: true,
      ban: true,
      unban: false,
      resetPoints: true,
    });
    expect(personActions(viewer("owner"), member({ role: "admin" })).roles).toEqual([
      "moderator",
      "member",
    ]);
  });

  it("lets admins set moderator or member, never admin, and not act on admins", () => {
    const admin = viewer("admin", adminId);
    expect(personActions(admin, member()).roles).toEqual(["moderator"]);
    expect(personActions(admin, member({ role: "moderator" })).roles).toEqual(["member"]);
    expect(personActions(admin, member({ role: "admin", userId: ownerId }))).toMatchObject({
      roles: [],
      remove: false,
      ban: false,
      unban: false,
    });
  });

  it("lets moderators remove and ban members but not change roles", () => {
    const mod = viewer("moderator", modId);
    expect(personActions(mod, member())).toEqual({
      roles: [],
      remove: true,
      ban: true,
      unban: false,
      resetPoints: false,
    });
    expect(personActions(mod, member({ role: "moderator" })).remove).toBe(false);
  });

  it("offers only a points reset on the owner's own row", () => {
    expect(personActions(viewer("owner"), member({ userId: ownerId, role: "owner" }))).toEqual({
      roles: [],
      remove: false,
      ban: false,
      unban: false,
      resetPoints: true,
    });
  });

  it("offers unban only for banned people and no role change for removed people", () => {
    expect(personActions(viewer("owner"), member({ status: "banned" }))).toEqual({
      roles: [],
      remove: false,
      ban: false,
      unban: true,
      resetPoints: false,
    });
    expect(personActions(viewer("owner"), member({ status: "removed" }))).toEqual({
      roles: [],
      remove: false,
      ban: true,
      unban: false,
      resetPoints: false,
    });
  });
});

describe("toPersonRow", () => {
  it("serializes dates and keeps the email the service returned", () => {
    expect(toPersonRow(viewer("owner"), member())).toMatchObject({
      joinedAt: "2026-10-01T09:00:00.000Z",
      lastActiveAt: "2026-10-12T08:00:00.000Z",
      email: "ada@cohory.local",
    });
    expect(
      toPersonRow(viewer("moderator", modId), member({ email: null, joinedAt: null })),
    ).toMatchObject({ email: null, joinedAt: null });
  });

  it("carries the access with its end date and whether they signed in", () => {
    expect(
      toPersonRow(
        viewer("owner"),
        member({
          signedIn: false,
          access: { kind: "cancelling", until: new Date("2026-11-30T00:00:00.000Z") },
        }),
      ),
    ).toMatchObject({
      signedInYet: false,
      access: "cancelling",
      accessUntil: "2026-11-30T00:00:00.000Z",
    });
    expect(toPersonRow(viewer("moderator", modId), member())).toMatchObject({
      access: null,
      accessUntil: null,
    });
  });
});

describe("invite rows", () => {
  it("builds the invite URL on the app URL without doubling slashes", () => {
    expect(inviteUrl("https://cohory.example/", "/join/abc")).toBe(
      "https://cohory.example/join/abc",
    );
    expect(inviteUrl("http://localhost:3000", "/join/abc")).toBe("http://localhost:3000/join/abc");
  });

  it("maps an invite view to a serializable row", () => {
    const row = toInviteRow("http://localhost:3000", {
      id: "0192f2a4-0000-7000-8000-0000000000c1",
      token: "t".repeat(43),
      path: `/join/${"t".repeat(43)}`,
      createdBy: ownerId,
      expiresAt: new Date("2026-11-01T00:00:00.000Z"),
      maxUses: 5,
      useCount: 1,
      requiresApproval: true,
      label: "Instagram bio",
      revokedAt: null,
      createdAt: new Date("2026-10-18T00:00:00.000Z"),
      status: "active",
    });
    expect(row).toEqual({
      id: "0192f2a4-0000-7000-8000-0000000000c1",
      url: `http://localhost:3000/join/${"t".repeat(43)}`,
      expiresAt: "2026-11-01T00:00:00.000Z",
      maxUses: 5,
      useCount: 1,
      requiresApproval: true,
      label: "Instagram bio",
      revokedAt: null,
      status: "active",
    });
  });
});

describe("appUrl", () => {
  it("prefers the runtime APP_URL over the build time NEXT_PUBLIC_APP_URL", () => {
    expect(
      appUrl({
        APP_URL: "http://127.0.0.1:3920/",
        BETTER_AUTH_URL: "http://localhost:3000",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toBe("http://127.0.0.1:3920");
  });

  it("falls back to BETTER_AUTH_URL and then to localhost", () => {
    expect(appUrl({ BETTER_AUTH_URL: "https://community.example.com" })).toBe(
      "https://community.example.com",
    );
    expect(appUrl({})).toBe("http://localhost:3000");
  });
});

describe("toReportRow", () => {
  it("flattens a report group for the queue with ISO dates", () => {
    const at = new Date("2026-10-18T10:00:00.000Z");
    expect(
      toReportRow(viewer("owner"), {
        content: {
          type: "comment",
          id: "0192f2a4-0000-7000-8000-0000000000c1",
          postId: "0192f2a4-0000-7000-8000-0000000000c2",
          postTitle: "Hello",
          excerpt: "Rude",
          author: { id: modId, name: "Mo", role: "moderator" },
          deletedAt: at,
        },
        status: "dismissed",
        reportCount: 2,
        reasons: ["spam"],
        notes: ["Again"],
        firstReportedAt: at,
        lastReportedAt: at,
        resolvedAt: at,
        resolvedBy: "Ada",
      }),
    ).toEqual({
      type: "comment",
      id: "0192f2a4-0000-7000-8000-0000000000c1",
      postId: "0192f2a4-0000-7000-8000-0000000000c2",
      postTitle: "Hello",
      excerpt: "Rude",
      authorId: modId,
      authorName: "Mo",
      canBan: true,
      deleted: true,
      status: "dismissed",
      reportCount: 2,
      reasons: ["spam"],
      notes: ["Again"],
      lastReportedAt: at.toISOString(),
      resolvedAt: at.toISOString(),
      resolvedBy: "Ada",
    });
  });

  it("offers the ban only when the viewer may ban this author", () => {
    const at = new Date("2026-10-18T10:00:00.000Z");
    const group = (role: ReportGroupView["content"]["author"]["role"]): ReportGroupView => ({
      content: {
        type: "post",
        id: "0192f2a4-0000-7000-8000-0000000000c2",
        postId: "0192f2a4-0000-7000-8000-0000000000c2",
        postTitle: null,
        excerpt: "Spam",
        author: { id: adminId, name: "Al", role },
        deletedAt: null,
      },
      status: "open",
      reportCount: 1,
      reasons: ["spam"],
      notes: [],
      firstReportedAt: at,
      lastReportedAt: at,
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(toReportRow(viewer("moderator", modId), group("member")).canBan).toBe(true);
    expect(toReportRow(viewer("moderator", modId), group("moderator")).canBan).toBe(false);
    expect(toReportRow(viewer("admin", adminId), group("admin")).canBan).toBe(false);
    expect(toReportRow(viewer("owner"), group("admin")).canBan).toBe(true);
    expect(toReportRow(viewer("owner"), group(null)).canBan).toBe(false);
  });
});
