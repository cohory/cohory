import type * as CommunitiesModule from "@cohory/communities";
import { CommunityNotFoundError } from "@cohory/communities";
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ creatorsCommunity: null as string | null }));
const getCommunityBySlug = vi.hoisted(() => vi.fn());

vi.mock("@cohory/config/platform", () => ({ getPlatformConfig: () => config }));
vi.mock("@cohory/communities", async (original) => ({
  ...(await original<typeof CommunitiesModule>()),
  getCommunitiesService: () => ({ getCommunityBySlug }),
}));

const { loadCreatorsCommunityLink } = await import("./creators-community");

describe("loadCreatorsCommunityLink", () => {
  beforeEach(() => {
    getCommunityBySlug.mockReset();
  });

  it("shows nothing and reads nothing when CREATORS_COMMUNITY_SLUG is unset", async () => {
    config.creatorsCommunity = null;
    expect(await loadCreatorsCommunityLink()).toBeNull();
    expect(getCommunityBySlug).not.toHaveBeenCalled();
  });

  it("links to the community by its name, read as a guest", async () => {
    config.creatorsCommunity = "cohory-creators";
    getCommunityBySlug.mockResolvedValue({ slug: "cohory-creators", name: "Cohory Creators" });
    expect(await loadCreatorsCommunityLink()).toEqual({
      label: "Cohory Creators",
      href: "/c/cohory-creators",
    });
    expect(getCommunityBySlug).toHaveBeenCalledWith({ kind: "guest" }, "cohory-creators");
  });

  it("shows nothing when the community does not exist", async () => {
    config.creatorsCommunity = "cohory-creators";
    getCommunityBySlug.mockRejectedValue(new CommunityNotFoundError());
    expect(await loadCreatorsCommunityLink()).toBeNull();
  });
});
