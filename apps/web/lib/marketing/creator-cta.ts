import type { CommunityCreation, SignUpMode } from "@cohory/config/platform";

export type CreatorCta = "create" | "early-access" | "self-host" | "sign-in";

// ADR 0050: while only operators may create communities, Cloud asks creators to request
// early access, or to self-host when the request form cannot send email.
export function creatorCta(input: {
  readonly signUpMode: SignUpMode;
  readonly communityCreation: CommunityCreation;
  readonly earlyAccess: boolean;
}): CreatorCta {
  if (input.communityCreation.mode !== "anyone") {
    return input.earlyAccess ? "early-access" : "self-host";
  }
  return input.signUpMode === "open" ? "create" : "sign-in";
}
