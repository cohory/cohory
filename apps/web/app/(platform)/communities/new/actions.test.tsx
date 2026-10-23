import * as communities from "@cohory/communities";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkSlugAction, createCommunityAction } from "./actions";

type Communities = typeof communities;
const { CommunityCreationRestrictedError, CommunityNotFoundError } = communities;

const service = vi.hoisted(() => ({
  createCommunity: vi.fn(),
  findMovedSlug: vi.fn(),
  getCommunityBySlug: vi.fn(),
}));

vi.mock("@cohory/auth/next", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "0192f0c0-0000-7000-8000-000000000001" } })),
}));
vi.mock("@cohory/communities", async (importOriginal) => ({
  ...(await importOriginal<Communities>()),
  getCommunitiesService: () => service,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function form(pricing: string): FormData {
  const data = new FormData();
  data.set("name", "Makers Guild");
  data.set("slug", "makers-guild");
  data.set("description", "");
  data.set("privacy", "public");
  data.set("pricing", pricing);
  return data;
}

describe("createCommunityAction", () => {
  it("lands a free community on its feed", async () => {
    await expect(createCommunityAction({ status: "idle" }, form("free"))).rejects.toThrow(
      "redirect:/c/makers-guild",
    );
    expect(service.createCommunity.mock.calls[0]?.[1]).not.toHaveProperty("pricing");
  });

  it("lands a paid community on Manage, Payments", async () => {
    await expect(createCommunityAction({ status: "idle" }, form("paid"))).rejects.toThrow(
      "redirect:/c/makers-guild/manage/payments?setup=connect",
    );
  });

  it("says only operators can create communities when the service refuses the person", async () => {
    service.createCommunity.mockRejectedValue(new CommunityCreationRestrictedError());

    const state = await createCommunityAction({ status: "idle" }, form("free"));

    expect(state).toMatchObject({
      status: "error",
      message: "Only the people who run this server can create communities.",
    });
  });

  it("asks for free or paid when the choice is missing", async () => {
    const state = await createCommunityAction({ status: "idle" }, form(""));

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { pricing: "Choose free or paid." },
    });
    expect(service.createCommunity).not.toHaveBeenCalled();
  });
});

describe("checkSlugAction", () => {
  it("reports a free URL", async () => {
    service.findMovedSlug.mockResolvedValue(null);
    service.getCommunityBySlug.mockRejectedValue(new CommunityNotFoundError());

    expect(await checkSlugAction("makers-guild")).toEqual({ status: "available" });
  });

  it("treats a URL a community moved away from as taken", async () => {
    service.findMovedSlug.mockImplementation(async (slug: string) =>
      slug === "makers-guild" ? "new-home" : null,
    );
    service.getCommunityBySlug.mockRejectedValue(new CommunityNotFoundError());

    expect(await checkSlugAction("makers-guild")).toMatchObject({ status: "taken" });
  });

  it("reports a reserved URL", async () => {
    service.findMovedSlug.mockResolvedValue(null);
    service.getCommunityBySlug.mockRejectedValue(new CommunityNotFoundError());

    expect(await checkSlugAction("settings")).toMatchObject({ status: "reserved" });
  });

  it("ignores a URL that is not valid", async () => {
    expect(await checkSlugAction("Not Valid")).toBeNull();
    expect(service.getCommunityBySlug).not.toHaveBeenCalled();
  });
});
