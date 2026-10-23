import { describe, expect, it } from "vitest";

import { AgentsValidationError } from "./errors";
import {
  createAgentInputSchema,
  createPersonalTokenInputSchema,
  parseInput,
  updateAgentInputSchema,
} from "./schemas";

const communityId = "0192f0a0-0000-7000-8000-0000000000c1";

describe("token and agent input", () => {
  it("defaults a personal token to 90 days", () => {
    const parsed = parseInput(createPersonalTokenInputSchema, {
      communityId,
      name: "Zapier",
      scopes: ["posts:read"],
    });

    expect(parsed.expiresInDays).toBe(90);
  });

  it("refuses an empty scope list, unknown scopes, and a wildcard", () => {
    for (const scopes of [[], ["admin"], ["*"]]) {
      expect(() =>
        parseInput(createPersonalTokenInputSchema, { communityId, name: "x", scopes }),
      ).toThrow(AgentsValidationError);
    }
  });

  it("refuses tokens that last longer than a year", () => {
    expect(() =>
      parseInput(createPersonalTokenInputSchema, {
        communityId,
        name: "x",
        scopes: ["posts:read"],
        expiresInDays: 366,
      }),
    ).toThrow(AgentsValidationError);
  });

  it("keeps the agent description optional and trims it", () => {
    expect(
      parseInput(createAgentInputSchema, { name: " Helper ", scopes: ["posts:write"] }),
    ).toEqual({ name: "Helper", description: null, scopes: ["posts:write"], communityWide: false });
  });

  it("refuses an empty agent update and the revoked status", () => {
    expect(() => parseInput(updateAgentInputSchema, {})).toThrow(AgentsValidationError);
    expect(() => parseInput(updateAgentInputSchema, { status: "revoked" })).toThrow(
      AgentsValidationError,
    );
  });
});
