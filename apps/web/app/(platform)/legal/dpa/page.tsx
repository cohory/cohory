import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CloudDpa } from "../../../../components/legal/cloud-dpa";

export const metadata: Metadata = {
  title: "Data Processing Agreement",
  alternates: { canonical: "/legal/dpa" },
};

export default function DpaPage() {
  if (getPlatformConfig().edition !== "cloud") {
    notFound();
  }
  return <CloudDpa />;
}
