import type { ArchiveRecords } from "../format/records";
import type { ImporterId } from "./catalog";
import type { DateOrder } from "./tabular";

export interface ImportFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface DetectedFile {
  readonly name: string;
  readonly kind: string | null;
  readonly label: string;
}

export interface ReportedRow {
  readonly file: string;
  readonly row: string;
  readonly reason: string;
  readonly values?: Readonly<Record<string, string>>;
}

export interface AuthorCandidate {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface AmbiguousAuthor {
  readonly name: string;
  readonly placeholderId: string;
  readonly candidates: readonly AuthorCandidate[];
}

export interface RoleMapping {
  readonly name: string;
  readonly email: string;
  readonly role: "admin" | "moderator";
  readonly sourceRole: string | null;
}

export interface CategoryMapping {
  readonly source: string;
  readonly target: string | null;
  readonly existing: boolean;
}

export interface SamplePost {
  readonly title: string | null;
  readonly author: string;
  readonly category: string | null;
  readonly excerpt: string;
}

export interface ImportMapping {
  readonly roles: readonly RoleMapping[];
  readonly rolesTotal: number;
  readonly categories: readonly CategoryMapping[];
  readonly sample: SamplePost | null;
}

export interface UnknownColumns {
  readonly file: string;
  readonly columns: readonly string[];
}

export interface ImportReport {
  readonly importer: { readonly id: ImporterId; readonly version: string };
  readonly files: readonly (DetectedFile & { readonly rows: number })[];
  readonly warnings: readonly string[];
  readonly skipped: readonly ReportedRow[];
  readonly skippedTotal: number;
  readonly unknownColumns: readonly UnknownColumns[];
  readonly formerMemberAuthors: number;
  readonly ambiguousAuthors: readonly AmbiguousAuthor[];
  readonly dateOrder: DateOrder | null;
  readonly suggestedImporter: ImporterId | null;
  readonly mapping: ImportMapping;
  readonly paying: readonly string[];
}

export interface ExistingCategory {
  readonly slug: string;
  readonly name: string;
  readonly color: "neutral" | "accent" | "info" | "success" | "warning" | "danger";
  readonly position: number;
  readonly staffOnly: boolean;
}

export interface ImporterContext {
  readonly community: { readonly id: string; readonly slug: string; readonly name: string };
  readonly existingCategories: readonly ExistingCategory[];
  readonly now: Date;
  readonly newId: () => string;
}

export interface ImporterResult {
  readonly records: ArchiveRecords;
  readonly report: ImportReport;
}

export interface Importer {
  readonly id: ImporterId;
  readonly name: string;
  readonly version: string;
  readonly accept: readonly string[];
  detect(file: ImportFile): DetectedFile;
  parse(files: readonly ImportFile[], context: ImporterContext): ImporterResult;
}
