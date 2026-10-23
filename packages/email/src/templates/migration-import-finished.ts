import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { emailGreeting } from "../names";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

interface OwnerInput {
  readonly name: string;
  readonly communityName: string;
  readonly migrationUrl: string;
  readonly communityBrand?: CommunityBrandInput;
}

export interface MigrationImportFinishedInput extends OwnerInput {
  readonly source: string;
  readonly reportUrl: string;
  readonly outcome?: string;
}

export interface MigrationImportFailedInput extends OwnerInput {
  readonly source: string | null;
}

export interface MigrationExportReadyInput extends OwnerInput {
  readonly downloadUrl: string;
  readonly lifetimeDays: number;
}

function ownerFooter(communityName: string, started: string) {
  return {
    why: `You received this email because you started ${started} as the owner of ${communityName} on ${instanceName()}.`,
  };
}

export function migrationImportFinishedEmail(input: MigrationImportFinishedInput): EmailContent {
  return buildEmail({
    template: "migration-import-finished",
    subject: "Your import is done",
    preheader:
      input.outcome ??
      `The ${input.source} import finished. The report lists what moved and what did not.`,
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      emailGreeting(input.name),
      `The ${input.source} import into ${input.communityName} is done. The report lists what moved and what was skipped. You need to be signed in to download it.`,
      ...(input.outcome ? [input.outcome] : []),
    ],
    cta: { label: "Download the report", url: input.reportUrl },
    after: [{ kind: "link", label: "Open Migration", url: input.migrationUrl }],
    footer: ownerFooter(input.communityName, "an import"),
  });
}

export function migrationImportFailedEmail(input: MigrationImportFailedInput): EmailContent {
  return buildEmail({
    template: "migration-import-failed",
    subject: input.source === null ? "Your export stopped" : "Your import stopped",
    preheader:
      input.source === null
        ? "Start a new export on the Migration page."
        : "Nothing more will change until you try again or start over.",
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      emailGreeting(input.name),
      input.source === null
        ? `The export of ${input.communityName} stopped before it finished. Start a new export on the Migration page.`
        : `The ${input.source} import into ${input.communityName} stopped before it finished. Nothing more will change until you try again or start over on the Migration page.`,
    ],
    cta: { label: "Open Migration", url: input.migrationUrl },
    footer: ownerFooter(input.communityName, input.source === null ? "an export" : "an import"),
  });
}

export function migrationExportReadyEmail(input: MigrationExportReadyInput): EmailContent {
  return buildEmail({
    template: "migration-export-ready",
    subject: "Your export is ready",
    preheader: `The download works for ${input.lifetimeDays} days.`,
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      emailGreeting(input.name),
      `The archive of ${input.communityName} is ready. It holds member emails, so keep it somewhere safe. You need to be signed in to download it.`,
    ],
    cta: { label: "Download the export", url: input.downloadUrl },
    after: [
      `The download works for ${input.lifetimeDays} days.`,
      { kind: "link", label: "Open Migration", url: input.migrationUrl },
    ],
    footer: ownerFooter(input.communityName, "an export"),
  });
}
