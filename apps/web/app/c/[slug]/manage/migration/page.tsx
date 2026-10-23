import { can } from "@cohory/authz";
import { getPlatformConfig } from "@cohory/config/platform";
import {
  getMigrationService,
  importerCatalog,
  importerIds,
  importerMaxBytes,
  importerMaxFiles,
  membersCsvMaxBytes,
  parseMigrationEnv,
} from "@cohory/migration";
import { getPaymentsService } from "@cohory/payments";
import { ExistingSubscribersCard } from "@cohory/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MigrationSection } from "../../../../../components/migration/migration-section";
import { PlatformImportSection } from "../../../../../components/migration/platform-import-section";
import { requireManagePage } from "../../../../../lib/manage/load";
import { isPlatformJob, sourceOptions } from "../../../../../lib/migration/platform";
import { paymentsActionFailure } from "../../../../../lib/payments/errors";
import { subscribersHref } from "../../../../../lib/payments/linking";
import { importedReason } from "../../../../../lib/migration/jobs";
import { migrationJobJson } from "../../../../../lib/migration/serialize";

export const metadata: Metadata = { title: "Migration" };

async function subscribersCard(
  manage: Awaited<ReturnType<typeof requireManagePage>>,
): Promise<{ href: string; connected: boolean; linking: boolean } | null> {
  if (!can(manage.actor, "link_subscriptions", "payment", { role: manage.role })) {
    return null;
  }
  try {
    const overview = await getPaymentsService().getPaymentsOverview(
      manage.actor,
      manage.communityId,
    );
    return {
      href: subscribersHref(manage.slug),
      connected: overview.connection?.externalAccountId != null,
      linking: overview.edition === "community",
    };
  } catch (error) {
    if (!paymentsActionFailure(error, "creator")) throw error;
    return {
      href: subscribersHref(manage.slug),
      connected: false,
      linking: getPlatformConfig().edition === "community",
    };
  }
}

function Heading() {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-2xl font-semibold text-text">Migration</h2>
      <p className="text-sm text-text-muted">
        Move your community in or out of {getPlatformConfig().instance.name}. Your data is yours to
        keep.
      </p>
    </div>
  );
}

export default async function MigrationPage({ params }: PageProps<"/c/[slug]/manage/migration">) {
  const manage = await requireManagePage((await params).slug, "migration");
  const ownerTools = can(manage.actor, "export", "migration", { role: manage.role });
  if (!ownerTools) {
    const subscribers = await subscribersCard(manage);
    if (!subscribers) {
      notFound();
    }
    return (
      <>
        <Heading />
        <ExistingSubscribersCard
          href={subscribers.href}
          connected={subscribers.connected}
          linking={subscribers.linking}
        />
        <p className="text-sm text-text-muted">
          Exporting and importing the community, and importing members from a spreadsheet, is for
          the owner.
        </p>
      </>
    );
  }
  const service = getMigrationService();
  const [subscribers, jobs, availability] = await Promise.all([
    subscribersCard(manage),
    service.listJobs(manage.actor, manage.communityId),
    service.importAvailability(manage.actor, manage.communityId),
  ]);

  const jobJson = jobs.map(migrationJobJson);
  const platformJob =
    jobJson.find((job) => isPlatformJob(job) && job.status !== "succeeded") ?? null;
  const imported = jobJson.some((job) => job.kind === "import" && job.status === "succeeded");
  const unavailableReason = imported ? importedReason : availability.reason;

  return (
    <>
      <Heading />
      <MigrationSection
        slug={manage.slug}
        initialJobs={jobJson}
        importAvailable={availability.available}
        importUnavailableReason={unavailableReason}
        subscribers={subscribers}
        limits={{ archiveBytes: parseMigrationEnv().archiveMaxBytes, csvBytes: membersCsvMaxBytes }}
        platformImport={
          <PlatformImportSection
            slug={manage.slug}
            sources={sourceOptions(importerIds.map((id) => importerCatalog[id]))}
            maxFiles={importerMaxFiles}
            maxBytes={importerMaxBytes}
            initialJob={platformJob}
            available={availability.available}
            unavailableReason={unavailableReason}
          />
        }
      />
    </>
  );
}
