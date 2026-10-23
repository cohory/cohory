import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CloudCreatorTerms } from "../../../../components/legal/cloud-creator-terms";

export const metadata: Metadata = {
  title: "Creator Terms",
  alternates: { canonical: "/legal/creator-terms" },
};

export default function CreatorTermsPage() {
  if (getPlatformConfig().edition !== "cloud") {
    notFound();
  }
  return <CloudCreatorTerms />;
}
