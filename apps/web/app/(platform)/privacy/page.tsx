import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CloudPrivacy } from "../../../components/legal/cloud-privacy";
import { OperatorTemplate } from "../../../components/legal/legal-document";
import { legalPageView } from "../../../lib/legal/pages";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const view = legalPageView("privacy", getLegalConfig(), getPlatformConfig().edition);
  switch (view.kind) {
    case "operator":
      return redirect(view.url);
    case "cloud_draft":
      return <CloudPrivacy />;
    case "template":
      return <OperatorTemplate title="Privacy Policy" subject="privacy policy" />;
  }
}
