import type { Actor } from "@cohory/authz";
import { getPlatformConfig } from "@cohory/config/platform";
import { getEmailOutbox } from "@cohory/email";
import {
  dataExportLinkDays,
  getDataExportService,
  type DataExportLink,
  type DataExportService,
} from "@cohory/identity";

export function dataExportPath(exportId: string): string {
  return `/account/data-export/${exportId}`;
}

async function sendLink(link: DataExportLink): Promise<void> {
  await getEmailOutbox().send({
    template: "data-export-ready",
    to: link.email,
    data: {
      name: link.name,
      url: `${getPlatformConfig().appUrl}${dataExportPath(link.exportId)}`,
      expiresInDays: dataExportLinkDays,
    },
  });
}

export function dataExports(): DataExportService {
  return getDataExportService(sendLink);
}

const expiryFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export async function loadReadyDataExport(
  actor: Actor,
): Promise<{ href: string; expiresOn: string } | null> {
  const latest = await dataExports().latestExport(actor);
  if (!latest || latest.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return {
    href: dataExportPath(latest.exportId),
    expiresOn: expiryFormat.format(latest.expiresAt),
  };
}
