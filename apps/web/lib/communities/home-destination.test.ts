import { describe, expect, it } from "vitest";

import { homeDestination } from "./home-destination";

describe("homeDestination", () => {
  it("shows the neutral signed out home when the operator set no home community", () => {
    expect(
      homeDestination({ slugs: null, showList: false, homeCommunity: null, edition: "community" }),
    ).toEqual({
      kind: "signed-out",
    });
  });

  it("sends signed out visitors to the About page of the operator's home community", () => {
    expect(
      homeDestination({
        slugs: null,
        showList: false,
        homeCommunity: "acme",
        edition: "community",
      }),
    ).toEqual({
      kind: "redirect",
      href: "/c/acme/about",
    });
  });

  it("shows the creator landing to signed out visitors on the Cloud Edition", () => {
    expect(
      homeDestination({ slugs: null, showList: false, homeCommunity: null, edition: "cloud" }),
    ).toEqual({ kind: "landing" });
  });

  it("lets the operator's home community win over the Cloud landing", () => {
    expect(
      homeDestination({ slugs: null, showList: false, homeCommunity: "acme", edition: "cloud" }),
    ).toEqual({ kind: "redirect", href: "/c/acme/about" });
  });

  it("keeps the signed in home on the Cloud Edition", () => {
    expect(
      homeDestination({ slugs: ["acme"], showList: false, homeCommunity: null, edition: "cloud" }),
    ).toEqual({ kind: "redirect", href: "/c/acme" });
    expect(
      homeDestination({ slugs: [], showList: false, homeCommunity: null, edition: "cloud" }),
    ).toEqual({ kind: "list" });
  });

  it("lands a member of exactly one community inside it", () => {
    expect(
      homeDestination({
        slugs: ["acme"],
        showList: false,
        homeCommunity: null,
        edition: "community",
      }),
    ).toEqual({
      kind: "redirect",
      href: "/c/acme",
    });
  });

  it("shows My communities to a member of one community who asked for home", () => {
    expect(
      homeDestination({
        slugs: ["acme"],
        showList: true,
        homeCommunity: null,
        edition: "community",
      }),
    ).toEqual({
      kind: "list",
    });
  });

  it("shows My communities to people with none or several, ignoring the home community", () => {
    expect(
      homeDestination({ slugs: [], showList: false, homeCommunity: "acme", edition: "community" }),
    ).toEqual({
      kind: "list",
    });
    expect(
      homeDestination({
        slugs: ["a-1", "b-2"],
        showList: false,
        homeCommunity: null,
        edition: "community",
      }),
    ).toEqual({ kind: "list" });
  });
});
