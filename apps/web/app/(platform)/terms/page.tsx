import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CloudTerms } from "../../../components/legal/cloud-terms";
import { OperatorTemplate } from "../../../components/legal/legal-document";
import { legalPageView } from "../../../lib/legal/pages";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const view = legalPageView("terms", getLegalConfig(), getPlatformConfig().edition);
  switch (view.kind) {
    case "operator":
      return redirect(view.url);
    case "cloud_draft":
      return <CloudTerms />;
    case "template":
      return <OperatorTemplate title="Terms of Service" subject="terms of service" />;
  }
}
