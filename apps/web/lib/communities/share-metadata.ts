import type { Metadata } from "next";

export interface ShareableCommunity {
  readonly name: string;
  readonly privacy: "public" | "private";
  readonly coverUrl: string | null;
}

// Empty image lists stop the instance image from the root opengraph-image file reaching private
// pages, and the instance name as title stops Next from filling the preview title with the page title.
function privatePreview(metadataBase: URL, instanceName: string): Metadata {
  return {
    metadataBase,
    openGraph: { type: "website", siteName: instanceName, title: instanceName, images: [] },
    twitter: { card: "summary", title: instanceName, images: [] },
  };
}

export function communityShareMetadata(
  community: ShareableCommunity,
  appUrl: string,
  instanceName: string,
): Metadata {
  const metadataBase = new URL(appUrl);
  if (community.privacy !== "public") {
    return privatePreview(metadataBase, instanceName);
  }
  if (!community.coverUrl) {
    return { metadataBase };
  }
  return {
    metadataBase,
    openGraph: { title: community.name, images: [community.coverUrl] },
    twitter: { card: "summary_large_image", images: [community.coverUrl] },
  };
}

export interface AboutShareableCommunity extends ShareableCommunity {
  readonly description: string | null;
}

const descriptionLimit = 160;

function previewDescription(text: string | null): string | undefined {
  const line = text?.replace(/\s+/g, " ").trim();
  if (!line) {
    return undefined;
  }
  if (line.length <= descriptionLimit) {
    return line;
  }
  const cut = line.slice(0, descriptionLimit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function aboutShareMetadata(
  community: AboutShareableCommunity,
  appUrl: string,
  instanceName: string,
): Metadata {
  const title = `About ${community.name}`;
  const metadataBase = new URL(appUrl);
  if (community.privacy !== "public") {
    return {
      ...privatePreview(metadataBase, instanceName),
      title: { absolute: `${title} · ${instanceName}` },
    };
  }
  const description = previewDescription(community.description);
  const images = community.coverUrl ? [community.coverUrl] : undefined;
  return {
    metadataBase,
    title: { absolute: `${title} · ${instanceName}` },
    ...(description ? { description } : {}),
    openGraph: { title, ...(description ? { description } : {}), ...(images ? { images } : {}) },
    twitter: images ? { card: "summary_large_image", images } : { card: "summary" },
  };
}

export interface InvitedCommunity {
  readonly name: string;
  readonly privacy: "public" | "private";
  readonly description: string | null;
  readonly coverUrl: string | null;
}

export const unlistedInvite = { index: false, follow: false } as const;

export function inviteShareMetadata(
  community: InvitedCommunity,
  appUrl: string,
  instanceName: string,
): Metadata {
  if (community.privacy !== "public") {
    return {
      ...privatePreview(new URL(appUrl), instanceName),
      title: { absolute: `Join with an invite · ${instanceName}` },
      robots: unlistedInvite,
    };
  }
  const title = `Join ${community.name} on ${instanceName}`;
  const description = previewDescription(community.description);
  const images = community.coverUrl ? { images: [community.coverUrl] } : {};
  return {
    metadataBase: new URL(appUrl),
    title: { absolute: title },
    ...(description ? { description } : {}),
    robots: unlistedInvite,
    openGraph: { title, ...(description ? { description } : {}), ...images },
    twitter: community.coverUrl
      ? { card: "summary_large_image", title, ...images }
      : { card: "summary", title },
  };
}
