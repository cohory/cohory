export type MigrationJobState = "ready" | "queued" | "running" | "succeeded" | "failed";

export interface MigrationProgress {
  readonly phase: string;
  readonly done: number;
  readonly total: number;
  readonly startedAt?: string | null;
}

export interface ExportJobItem {
  readonly id: string;
  readonly status: MigrationJobState;
  readonly createdAt: string;
  readonly fileBytes: number | null;
  readonly progress: MigrationProgress | null;
  readonly downloadHref: string | null;
  readonly errorMessage: string | null;
  readonly contents?: string | null;
  readonly expiresAt?: string | null;
  readonly deletedAt?: string | null;
}

export interface ArchivePreview {
  readonly communityName: string;
  readonly exportedAt: string;
  readonly schemaVersion: string;
  readonly edition: "community" | "cloud";
  readonly counts: Readonly<Record<string, number>>;
  readonly people: {
    readonly total: number;
    readonly existing: number;
    readonly new: number;
    readonly keptApart?: number;
    readonly inviteOnly?: boolean;
  };
  readonly uploads: number;
  readonly warnings: readonly string[];
}

export interface ArchiveResult {
  readonly imported: Readonly<Record<string, number>>;
  readonly createdAccounts: number;
  readonly linkedAccounts: number;
  readonly invitedAccounts?: number;
  readonly ownerImportedAs: "owner" | "admin" | "none";
  readonly skipped: readonly ArchiveSkippedItem[];
  readonly skippedTotal: number;
  readonly warnings: readonly string[];
  readonly subscriptionsToLink: number;
  readonly emailsSent: number;
  readonly emailsNotSent?: number;
  readonly emailsOverLimit?: number;
  readonly emailChoice?: "now" | "later" | "never" | null;
}

export interface ArchiveSkippedItem {
  readonly entity: string;
  readonly sourceId?: string;
  readonly reason: string;
  readonly values?: Readonly<Record<string, string>>;
}

export type CsvRowStatus =
  | "ready"
  | "new_account"
  | "existing_account"
  | "already_member"
  | "invited"
  | "left_out"
  | "error";

export interface CsvPreviewRow {
  readonly line: number;
  readonly email: string;
  readonly name: string | null;
  readonly role: string | null;
  readonly status: CsvRowStatus;
  readonly message: string | null;
  readonly values?: Readonly<Record<string, string>>;
}

export interface CsvPreview {
  readonly rows: readonly CsvPreviewRow[];
  readonly ready: number;
  readonly errors: number;
  readonly alreadyMembers: number;
  readonly invited: number;
  readonly leftOut: number;
  readonly notes: readonly string[];
  readonly newAccounts: number | null;
  readonly memberLimit: number | null;
  readonly activeMembers: number;
  readonly addAllowed: boolean;
}

export interface CsvResult {
  readonly mode: "invite" | "add";
  readonly added: number;
  readonly invited: number;
  readonly skipped: number;
  readonly emailsSent: number;
  readonly notSent?: number;
  readonly limitReached: boolean;
  readonly skippedRows?: readonly { readonly line: number; readonly reason: string }[];
}

export interface PlatformSourceOption {
  readonly id: "skool" | "circle";
  readonly name: string;
  readonly version: string;
  readonly accept: string;
  readonly limitsHref: string;
  readonly files: readonly { readonly label: string; readonly description: string }[];
}

export interface PlatformImportPreview {
  readonly sourceName: string;
  readonly version: string;
  readonly limitsHref: string;
  readonly files: readonly {
    readonly name: string;
    readonly label: string;
    readonly recognized: boolean;
    readonly rows: number;
  }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly people: {
    readonly total: number;
    readonly existing: number;
    readonly new: number;
    readonly keptApart: number;
    readonly inviteOnly?: boolean;
  };
  readonly formerMemberAuthors: number;
  readonly ambiguousAuthors: readonly PlatformAmbiguousAuthor[];
  readonly dateOrder: "dmy" | "mdy" | null;
  readonly suggestedSource: { readonly id: "skool" | "circle"; readonly name: string } | null;
  readonly mapping: PlatformImportMapping;
  readonly warnings: readonly string[];
  readonly skipped: readonly {
    readonly file: string;
    readonly row: string;
    readonly reason: string;
    readonly values?: Readonly<Record<string, string>>;
  }[];
  readonly skippedTotal: number;
  readonly unknownColumns: readonly {
    readonly file: string;
    readonly columns: readonly string[];
  }[];
  readonly overMemberLimit: boolean;
}

export interface PlatformAmbiguousAuthor {
  readonly name: string;
  readonly placeholderId: string;
  readonly candidates: readonly {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  }[];
}

export interface PlatformImportMapping {
  readonly roles: readonly {
    readonly name: string;
    readonly email: string;
    readonly role: "admin" | "moderator";
    readonly sourceRole: string | null;
  }[];
  readonly rolesTotal: number;
  readonly categories: readonly {
    readonly source: string;
    readonly target: string | null;
    readonly existing: boolean;
  }[];
  readonly sample: {
    readonly title: string | null;
    readonly author: string;
    readonly category: string | null;
    readonly excerpt: string;
  } | null;
}
