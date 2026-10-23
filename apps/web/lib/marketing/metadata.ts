import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";

export function marketingMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const { instance } = getPlatformConfig();
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: instance.name, title, description, url: path },
  };
}
