import { describe, expect, it } from "vitest";

import { activitySubject } from "./activity";

const agents = [
  { id: "a1", name: "Helper", tokens: [{ id: "t1", name: "Laptop" }] },
  { id: "a2", name: "Sync", tokens: [] },
];
const personal = [{ id: "p1", name: "My script" }];

describe("activitySubject", () => {
  it("names the agent, an agent token, or a personal token", () => {
    expect(activitySubject({ agentId: "a2" }, agents, personal)).toBe("Sync");
    expect(activitySubject({ tokenId: "t1" }, agents, personal)).toBe("Laptop");
    expect(activitySubject({ tokenId: "p1" }, agents, personal)).toBe("My script");
  });

  it("falls back when nothing is chosen or the id is unknown", () => {
    expect(activitySubject({}, agents, personal)).toBe("Your agents and tokens");
    expect(activitySubject({ tokenId: "zz" }, agents, personal)).toBe("A token you no longer have");
  });
});
