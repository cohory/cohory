import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CloudGuidelines } from "../../../components/legal/cloud-guidelines";
import { OperatorTemplate } from "../../../components/legal/legal-document";
import { legalPageView } from "../../../lib/legal/pages";

export const metadata: Metadata = {
  title: "Community Guidelines",
  alternates: { canonical: "/guidelines" },
};

export default function GuidelinesPage() {
  const view = legalPageView("guidelines", getLegalConfig(), getPlatformConfig().edition);
  switch (view.kind) {
    case "operator":
      return redirect(view.url);
    case "cloud_draft":
      return <CloudGuidelines />;
    case "template":
      return <OperatorTemplate title="Community Guidelines" subject="community guidelines" />;
  }
}
