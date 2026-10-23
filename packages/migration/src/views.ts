import type {
  MigrationEmailChoice,
  MigrationJob,
  MigrationJobKind,
  MigrationJobStatus,
  MigrationProgressJson,
} from "@cohory/db/schema";

import type { ImportSummary } from "./import/summary";
import type { ImportReport } from "./importers/types";
import type { MembersCsvRole } from "./csv/parse";

export type ExportSummary = {
  readonly counts: Readonly<Record<string, number>>;
  readonly uploads: { readonly count: number; readonly bytes: number };
  readonly missingUploads: readonly string[];
  readonly schemaVersion: string;
};

export type ImportPreview = {
  readonly schemaVersion: string;
  readonly cohoryVersion: string;
  readonly edition: "community" | "cloud";
  readonly exportedAt: string;
  readonly community: { readonly id: string; readonly slug: string; readonly name: string };
  readonly counts: Readonly<Record<string, number>>;
  readonly uploads: { readonly count: number; readonly bytes: number };
  readonly missingUploads: number;
  readonly people: {
    readonly total: number;
    readonly existing: number;
    readonly new: number;
    readonly keptApart: number;
    readonly inviteOnly?: boolean;
  };
  readonly activeSubscriptions: number;
  readonly plans: number;
  readonly warnings: readonly string[];
  readonly source?: PlatformImportSource;
};

export type PlatformImportSource = ImportReport & {
  readonly name: string;
  readonly limitsPath: string;
  readonly overMemberLimit: boolean;
};

export type MembersCsvPreviewRowStatus =
  | "ready"
  | "new_account"
  | "existing_account"
  | "already_member"
  | "invited"
  | "left_out"
  | "error";

export type MembersCsvPreviewRow = {
  readonly line: number;
  readonly email: string;
  readonly name: string | null;
  readonly role: MembersCsvRole | null;
  readonly status: MembersCsvPreviewRowStatus;
  readonly message: string | null;
  readonly values?: Readonly<Record<string, string>>;
};

export type MembersCsvPreview = {
  readonly rows: readonly MembersCsvPreviewRow[];
  readonly totals: {
    readonly rows: number;
    readonly ready: number;
    readonly newAccounts: number | null;
    readonly alreadyMembers: number;
    readonly invited: number;
    readonly leftOut: number;
    readonly errors: number;
  };
  readonly notes: readonly string[];
  readonly memberLimit: number | null;
  readonly activeMembers: number;
  readonly addAllowed: boolean;
};

export type MembersImportMode = "invite" | "add";

export type MembersImportSummary = {
  readonly mode: MembersImportMode;
  readonly added: number;
  readonly invited: number;
  readonly skipped: number;
  readonly emailsSent: number;
  readonly notSent?: number;
  readonly limitReached: boolean;
  readonly skippedRows?: readonly MembersSkippedRow[];
};

export type MembersSkippedRow = {
  readonly line: number;
  readonly reason: string;
};

interface JobBase {
  readonly id: string;
  readonly status: MigrationJobStatus;
  readonly fileName: string | null;
  readonly fileBytes: number | null;
  readonly progress: MigrationProgressJson | null;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly deletedAt: Date | null;
  readonly emailChoice: MigrationEmailChoice | null;
  readonly emailsSentAt: Date | null;
}

export type MigrationJobView =
  | (JobBase & {
      readonly kind: "export";
      readonly preview: null;
      readonly summary: ExportSummary | null;
      readonly downloadable: boolean;
    })
  | (JobBase & {
      readonly kind: "import";
      readonly preview: ImportPreview | null;
      readonly summary: ImportSummary | null;
      readonly downloadable: false;
    })
  | (JobBase & {
      readonly kind: "members_csv";
      readonly preview: MembersCsvPreview | null;
      readonly summary: MembersImportSummary | null;
      readonly downloadable: false;
    });

function base(job: MigrationJob): JobBase {
  return {
    id: job.id,
    status: job.status,
    fileName: job.fileName,
    fileBytes: job.fileBytes,
    progress: job.progress,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    expiresAt: job.expiresAt,
    deletedAt: job.deletedAt,
    emailChoice: job.emailChoice,
    emailsSentAt: job.emailsSentAt,
  };
}

export function toJobView(job: MigrationJob): MigrationJobView {
  const kind: MigrationJobKind = job.kind;
  switch (kind) {
    case "export":
      return {
        ...base(job),
        kind,
        preview: null,
        summary: (job.summary as ExportSummary | null) ?? null,
        downloadable: job.status === "succeeded" && job.fileKey !== null,
      };
    case "import":
      return {
        ...base(job),
        kind,
        preview: (job.preview as ImportPreview | null) ?? null,
        summary: (job.summary as ImportSummary | null) ?? null,
        downloadable: false,
      };
    case "members_csv":
      return {
        ...base(job),
        kind,
        preview: (job.preview as MembersCsvPreview | null) ?? null,
        summary: (job.summary as MembersImportSummary | null) ?? null,
        downloadable: false,
      };
  }
}
