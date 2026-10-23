import { describe, expect, it } from "vitest";

import {
  canCreateCommunities,
  parseAppUrl,
  parseEdition,
  parsePlatformEnv,
  type CommunityCreation,
} from "./platform";

describe("parseEdition", () => {
  it("defaults to the Community Edition when COHORY_EDITION is unset or blank", () => {
    expect(parseEdition({})).toBe("community");
    expect(parseEdition({ COHORY_EDITION: "" })).toBe("community");
  });

  it("reads the Cloud Edition", () => {
    expect(parseEdition({ COHORY_EDITION: "cloud" })).toBe("cloud");
  });

  it("rejects an unknown edition instead of falling back", () => {
    expect(() => parseEdition({ COHORY_EDITION: "enterprise" })).toThrow(/COHORY_EDITION/);
  });
});

describe("parseAppUrl", () => {
  it("prefers APP_URL and strips trailing slashes", () => {
    expect(
      parseAppUrl({ APP_URL: "https://acme.example.com//", BETTER_AUTH_URL: "https://auth.test" }),
    ).toBe("https://acme.example.com");
  });

  it("falls back to BETTER_AUTH_URL when APP_URL is blank", () => {
    expect(parseAppUrl({ APP_URL: "", BETTER_AUTH_URL: "https://community.example.com/" })).toBe(
      "https://community.example.com",
    );
  });

  it("keeps a path prefix", () => {
    expect(parseAppUrl({ APP_URL: "https://example.com/community/" })).toBe(
      "https://example.com/community",
    );
  });

  it("uses localhost on port 3000 when neither variable is set", () => {
    expect(parseAppUrl({})).toBe("http://localhost:3000");
  });

  it("rejects a value that is not an http or https URL", () => {
    expect(() => parseAppUrl({ APP_URL: "not a url" })).toThrow(/APP_URL/);
    expect(() => parseAppUrl({ APP_URL: "ftp://example.com" })).toThrow(/APP_URL/);
  });
});

describe("parsePlatformEnv", () => {
  it("names the instance Cohory with no logo or home community by default", () => {
    expect(parsePlatformEnv({})).toEqual({
      edition: "community",
      appUrl: "http://localhost:3000",
      instance: { name: "Cohory", logoUrl: null },
      homeCommunity: null,
      creatorsCommunity: null,
      signUpMode: "open",
      communityCreation: { mode: "anyone", operators: [] },
    });
  });

  it("reads the operator's instance name, logo, home community, and creators community", () => {
    expect(
      parsePlatformEnv({
        COHORY_EDITION: "cloud",
        APP_URL: "https://acme.example.com",
        INSTANCE_NAME: "  Acme Academy ",
        INSTANCE_LOGO_URL: "/brand/logo.svg",
        HOME_COMMUNITY: "acme-academy",
        CREATORS_COMMUNITY_SLUG: "acme-creators",
      }),
    ).toEqual({
      edition: "cloud",
      appUrl: "https://acme.example.com",
      instance: { name: "Acme Academy", logoUrl: "/brand/logo.svg" },
      homeCommunity: "acme-academy",
      creatorsCommunity: "acme-creators",
      signUpMode: "open",
      communityCreation: { mode: "anyone", operators: [] },
    });
  });

  it("treats blank optional values as unset", () => {
    const config = parsePlatformEnv({
      INSTANCE_NAME: " ",
      INSTANCE_LOGO_URL: "",
      HOME_COMMUNITY: "",
      CREATORS_COMMUNITY_SLUG: " ",
    });
    expect(config.instance).toEqual({ name: "Cohory", logoUrl: null });
    expect(config.homeCommunity).toBeNull();
    expect(config.creatorsCommunity).toBeNull();
  });

  it("accepts a logo URL on the app's own origin, which the content security policy allows", () => {
    expect(
      parsePlatformEnv({
        APP_URL: "https://acme.example.com",
        INSTANCE_LOGO_URL: "https://acme.example.com/logo.png",
      }).instance.logoUrl,
    ).toBe("https://acme.example.com/logo.png");
  });

  it("rejects a logo on another origin because the browser would block it", () => {
    expect(() =>
      parsePlatformEnv({
        APP_URL: "https://acme.example.com",
        INSTANCE_LOGO_URL: "https://cdn.example.net/logo.png",
      }),
    ).toThrow(/INSTANCE_LOGO_URL/);
  });

  it("rejects a protocol relative logo path", () => {
    expect(() => parsePlatformEnv({ INSTANCE_LOGO_URL: "//cdn.example.net/logo.png" })).toThrow(
      /INSTANCE_LOGO_URL/,
    );
  });

  it("rejects a home community that is not a valid slug", () => {
    expect(() => parsePlatformEnv({ HOME_COMMUNITY: "Acme Academy" })).toThrow(/HOME_COMMUNITY/);
  });

  it("rejects a creators community that is not a valid slug", () => {
    expect(() => parsePlatformEnv({ CREATORS_COMMUNITY_SLUG: "Cohory Creators" })).toThrow(
      /CREATORS_COMMUNITY_SLUG/,
    );
  });

  it("ignores a MARKETING_URL left over from an older .env", () => {
    expect(parsePlatformEnv({ MARKETING_URL: "not a url" })).not.toHaveProperty("marketingUrl");
  });

  it("rejects an instance name longer than 60 characters", () => {
    expect(() => parsePlatformEnv({ INSTANCE_NAME: "a".repeat(61) })).toThrow(/INSTANCE_NAME/);
  });

  it("reads the sign up mode and treats a blank value as open", () => {
    expect(parsePlatformEnv({ SIGNUP_MODE: "invite" }).signUpMode).toBe("invite");
    expect(parsePlatformEnv({ SIGNUP_MODE: "closed" }).signUpMode).toBe("closed");
    expect(parsePlatformEnv({ SIGNUP_MODE: "" }).signUpMode).toBe("open");
  });

  it("rejects an unknown sign up mode instead of falling back to open", () => {
    expect(() => parsePlatformEnv({ SIGNUP_MODE: "approval" })).toThrow(/SIGNUP_MODE/);
  });

  it("reads the operator list in lower case when only operators may create communities", () => {
    expect(
      parsePlatformEnv({
        COMMUNITY_CREATION: "operators",
        OPERATOR_EMAILS: " Owner@Example.com, team@example.com ,",
      }).communityCreation,
    ).toEqual({ mode: "operators", operators: ["owner@example.com", "team@example.com"] });
  });

  it("refuses operator only creation without any operator email", () => {
    expect(() => parsePlatformEnv({ COMMUNITY_CREATION: "operators" })).toThrow(/OPERATOR_EMAILS/);
  });

  it("rejects an operator entry that is not an email address", () => {
    expect(() =>
      parsePlatformEnv({ COMMUNITY_CREATION: "operators", OPERATOR_EMAILS: "owner" }),
    ).toThrow(/OPERATOR_EMAILS/);
  });
});

describe("canCreateCommunities", () => {
  const operators: CommunityCreation = { mode: "operators", operators: ["owner@example.com"] };

  it("lets every signed in person create a community when creation is open to anyone", () => {
    expect(canCreateCommunities({ mode: "anyone", operators: [] }, "member@example.com")).toBe(
      true,
    );
  });

  it("lets a listed operator create a community whatever the case of the address", () => {
    expect(canCreateCommunities(operators, "Owner@Example.com")).toBe(true);
  });

  it("refuses a person who is not on the operator list", () => {
    expect(canCreateCommunities(operators, "member@example.com")).toBe(false);
  });
});
