import { ScopeNotAvailableError } from "@cohory/agents";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const regeneratePersonalToken = vi.fn();
const createPersonalToken = vi.fn();
const limiter = createRateLimiter({
  rules: { ...rateLimitDefaults, tokenRegenerate: { max: 1, windowSeconds: 3600 } },
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../session", () => ({ currentSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("../actor", () => ({
  actorFor: () => ({ kind: "user", userId: "u1", platformAdmin: false }),
}));
vi.mock(import("@cohory/rate-limit"), async (original) => ({
  ...(await original()),
  getRateLimiter: () => limiter,
}));
vi.mock("@cohory/agents", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getAgentsService: () => ({ regeneratePersonalToken, createPersonalToken }),
}));

const { createPersonalTokenAction, regeneratePersonalTokenAction } = await import("./actions");

const tokenId = "0192d3c0-0000-7000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("regeneratePersonalTokenAction", () => {
  it("limits how often a person regenerates tokens", async () => {
    regeneratePersonalToken.mockResolvedValue({
      token: "cohory_secret",
      view: { prefix: "cohory_secre", community: { slug: "makers" } },
    });
    await expect(regeneratePersonalTokenAction(tokenId)).resolves.toMatchObject({ ok: true });
    const limited = await regeneratePersonalTokenAction(tokenId);
    expect(limited).toMatchObject({ ok: false, message: expect.stringMatching(/too often/) });
    expect(regeneratePersonalToken).toHaveBeenCalledOnce();
  });
});

describe("createPersonalTokenAction", () => {
  it("says plainly when a permission does not fit the person's role", async () => {
    createPersonalToken.mockRejectedValue(new ScopeNotAvailableError(["members:export"]));
    const result = await createPersonalTokenAction({
      communityId: "0192d3c0-0000-7000-8000-000000000002",
      name: "Export",
      scopes: ["members:export"],
      expiresInDays: 30,
    });
    expect(result).toEqual({
      ok: false,
      message: 'Your role cannot use "Export members". Choose only the permissions shown.',
    });
  });
});
