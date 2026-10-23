import { signInPath } from "@cohory/auth";
import type { Actor, CommunityRole } from "@cohory/authz";
import { notFound, redirect } from "next/navigation";

import { loadCommunityPage, type FullCommunityPage } from "../communities/load";
import { manageEntry, type ManageQuery, type ManageSection } from "./sections";

export interface ManagePage {
  readonly page: FullCommunityPage;
  readonly actor: Extract<Actor, { kind: "user" }>;
  readonly role: CommunityRole;
  readonly communityId: string;
  readonly slug: string;
  readonly sections: readonly ManageSection[];
}

export async function requireManagePage(
  slug: string,
  section?: ManageSection,
  query: ManageQuery = {},
): Promise<ManagePage> {
  const page = await loadCommunityPage(slug);
  const role = page.access === "full" ? page.role : null;
  const entry = manageEntry(page.community.slug, page.actor.kind, role, section, query);
  if (entry.kind === "sign_in") {
    redirect(signInPath(entry.next));
  }
  if (page.access === "limited") {
    redirect(`/c/${page.community.slug}`);
  }
  if (entry.kind === "not_found" || page.actor.kind !== "user" || page.role === null) {
    notFound();
  }
  if (entry.kind === "redirect") {
    redirect(entry.href);
  }
  return {
    page,
    actor: page.actor,
    role: page.role,
    communityId: page.community.id,
    slug: page.community.slug,
    sections: entry.sections,
  };
}

// The layout cannot see the query string, so a signed out visitor is sent to sign in by the page.
export async function loadManageShell(slug: string): Promise<ManagePage | null> {
  const page = await loadCommunityPage(slug);
  return page.actor.kind === "guest" ? null : requireManagePage(slug);
}
