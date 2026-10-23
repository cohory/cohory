export const previewParam = "preview";

export function aboutPreviewHref(slug: string): string {
  return `/c/${encodeURIComponent(slug)}/about?${previewParam}=1`;
}

export interface AboutPageParts {
  readonly hasCover: boolean;
  readonly galleryCount: number;
  readonly hasDetailedDescription: boolean;
  readonly reviewsOn: boolean;
}

export interface PreviewGap {
  readonly label: string;
  readonly href: string;
}

export function previewGaps(slug: string, parts: AboutPageParts): PreviewGap[] {
  const manage = `/c/${encodeURIComponent(slug)}/manage`;
  const appearance = `${manage}/appearance`;
  const gaps: [boolean, PreviewGap][] = [
    [!parts.hasCover, { label: "Cover image", href: appearance }],
    [parts.galleryCount === 0, { label: "Gallery", href: appearance }],
    [!parts.hasDetailedDescription, { label: "Detailed description", href: appearance }],
    [!parts.reviewsOn, { label: "Reviews", href: `${manage}/settings` }],
  ];
  return gaps.filter(([missing]) => missing).map(([, gap]) => gap);
}
