import { describe, expect, it } from "vitest";

import { creatorCta } from "./creator-cta";

const anyone = { mode: "anyone", operators: [] } as const;
const operators = { mode: "operators", operators: ["founder@example.com"] } as const;

describe("creatorCta", () => {
  it("asks creators to create a community when sign up and creation are open", () => {
    expect(creatorCta({ signUpMode: "open", communityCreation: anyone, earlyAccess: true })).toBe(
      "create",
    );
  });

  it("asks for early access when only operators may create communities", () => {
    expect(
      creatorCta({ signUpMode: "open", communityCreation: operators, earlyAccess: true }),
    ).toBe("early-access");
    expect(
      creatorCta({ signUpMode: "invite", communityCreation: operators, earlyAccess: true }),
    ).toBe("early-access");
  });

  it("falls back to self-hosting when creation is restricted and the request form is off", () => {
    expect(
      creatorCta({ signUpMode: "open", communityCreation: operators, earlyAccess: false }),
    ).toBe("self-host");
  });

  it("only offers sign in when sign up is not open to everyone", () => {
    expect(creatorCta({ signUpMode: "invite", communityCreation: anyone, earlyAccess: true })).toBe(
      "sign-in",
    );
  });
});
