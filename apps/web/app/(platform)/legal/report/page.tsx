import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReportForm } from "./report-form";

export const metadata: Metadata = {
  title: "Report content",
  alternates: { canonical: "/legal/report" },
};

export default function ReportContentPage() {
  if (!getLegalConfig().contactEmail) {
    notFound();
  }
  const { instance } = getPlatformConfig();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">Report content</h1>
        <p className="text-base text-text-muted">
          Tell the people who run {instance.name} about illegal content or content that breaks
          someone&apos;s rights. You do not need an account. For a post that only breaks a
          community&apos;s own rules, use Report on the post so its moderators see it.
        </p>
      </header>
      <ReportForm />
    </div>
  );
}
