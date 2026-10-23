import type { LegalConfig } from "@cohory/config/legal";
import type { Edition } from "@cohory/config/platform";

export type LegalPage = "terms" | "privacy" | "guidelines";

export type LegalPageView =
  | { readonly kind: "operator"; readonly url: string }
  | { readonly kind: "cloud_draft" }
  | { readonly kind: "template" };

export function legalPageView(
  page: LegalPage,
  legal: LegalConfig,
  edition: Edition,
): LegalPageView {
  const url = legal.urls[page];
  if (url) {
    return { kind: "operator", url };
  }
  return edition === "cloud" ? { kind: "cloud_draft" } : { kind: "template" };
}
