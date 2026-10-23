import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  communitySlugSchema,
  createCommunityWithOwner,
  getCommunityBySlug,
  newId,
  type Community,
} from "@cohory/db";
import { memberships, users } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { MigrationError } from "./errors";
import { readArchive } from "./format/archive";
import { runExportJob, runImportJob } from "./runner";
import { archiveKey, readStoredFile, type Runtime } from "./runtime";
import { inMigrationScope } from "./scope";

export const cliUsage = `Usage:
  migration export --slug <community slug> --out <file.zip>
  migration import --file <file.zip> [--slug <new slug>] [--owner-email <email>] [--notify]

export writes the community archive (format 1.0.0) to a file.
import restores an archive into an empty community. When no community has the slug,
it creates one owned by --owner-email, or by the owner named in the archive.
--notify emails new accounts a link to choose a password.`;

export interface CliIo {
  readonly cwd: string;
  readonly out: (line: string) => void;
}

function resolvePath(io: CliIo, file: string): string {
  return path.resolve(io.cwd, file);
}

async function ownerOf(runtime: Runtime, community: Community): Promise<string> {
  const [owner] = await inMigrationScope(runtime.db, community.id, ({ tx, where }) =>
    tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        where(memberships, and(eq(memberships.role, "owner"), eq(memberships.status, "active"))),
      ),
  );
  if (!owner) {
    throw new MigrationError("not_found", `The community ${community.slug} has no owner.`);
  }
  return owner.userId;
}

async function findOrCreateUser(runtime: Runtime, email: string, name: string): Promise<string> {
  const [existing] = await runtime.db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email}::text)`, email.toLowerCase()))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await runtime.db
    .insert(users)
    .values({ id: newId(), email, name, emailVerified: false })
    .returning({ id: users.id });
  if (!created) throw new Error("user insert returned no row");
  return created.id;
}

export async function exportCommand(
  runtime: Runtime,
  io: CliIo,
  options: { slug: string; out: string },
): Promise<void> {
  const community = await getCommunityBySlug(runtime.db, communitySlugSchema.parse(options.slug));
  if (!community) {
    throw new MigrationError("not_found", `No community has the slug ${options.slug}.`);
  }
  const job = await runtime.jobs.create(community.id, {
    kind: "export",
    status: "queued",
    requestedBy: await ownerOf(runtime, community),
  });
  await runExportJob(runtime, { jobId: job.id, communityId: community.id });
  const bytes = await readStoredFile(
    runtime.archiveStorage,
    archiveKey(community.id, "exports", job.id),
  );
  if (!bytes) throw new Error("the export did not write an archive");
  const target = resolvePath(io, options.out);
  await writeFile(target, bytes);
  io.out(
    JSON.stringify({
      level: "info",
      msg: "archive exported",
      file: target,
      bytes: bytes.byteLength,
      jobId: job.id,
    }),
  );
}

export async function importCommand(
  runtime: Runtime,
  io: CliIo,
  options: { file: string; slug?: string; ownerEmail?: string; notify: boolean },
): Promise<void> {
  const bytes = new Uint8Array(await readFile(resolvePath(io, options.file)));
  const archive = readArchive(bytes, {
    maxBytes: runtime.config.archiveMaxBytes,
    maxUploadBytes: runtime.config.archiveMaxBytes,
  });
  const slug = communitySlugSchema.parse(options.slug ?? archive.manifest.community.slug);
  let community = await getCommunityBySlug(runtime.db, slug);
  let ownerId: string;
  if (community) {
    ownerId = await ownerOf(runtime, community);
  } else {
    const archiveOwner = archive.records.memberships.find((row) => row.role === "owner");
    const ownerRecord = archive.records.users.find((row) => row.id === archiveOwner?.userId);
    const email = options.ownerEmail ?? ownerRecord?.email;
    if (!email) {
      throw new MigrationError(
        "validation_failed",
        "Pass --owner-email: the archive names no owner.",
      );
    }
    ownerId = await findOrCreateUser(runtime, email, ownerRecord?.name ?? email);
    const created = await createCommunityWithOwner(runtime.db, {
      ownerUserId: ownerId,
      slug,
      name: archive.manifest.community.name,
    });
    if (created.kind !== "created") {
      throw new MigrationError("validation_failed", `The slug ${slug} is taken.`);
    }
    community = created.community;
  }
  const id = newId();
  const key = archiveKey(community.id, "imports", id);
  await runtime.archiveStorage.put({ key, body: bytes, contentType: "application/zip" });
  await runtime.jobs.create(community.id, {
    id,
    kind: "import",
    status: "queued",
    requestedBy: ownerId,
    fileKey: key,
    fileName: path.basename(options.file),
    fileBytes: bytes.byteLength,
    options: { notifyNewUsers: options.notify },
  });
  await runImportJob(runtime, { jobId: id, communityId: community.id });
  const job = await runtime.jobs.get(community.id, id);
  io.out(
    JSON.stringify({
      level: "info",
      msg: "archive imported",
      community: community.slug,
      jobId: id,
      summary: job?.summary,
    }),
  );
}

export async function runCli(
  runtime: Runtime,
  io: CliIo,
  argv: readonly string[],
): Promise<number> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: [...rest],
    options: {
      slug: { type: "string" },
      out: { type: "string" },
      file: { type: "string" },
      "owner-email": { type: "string" },
      notify: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (command === "export" && values.slug && values.out) {
    await exportCommand(runtime, io, { slug: values.slug, out: values.out });
    return 0;
  }
  if (command === "import" && values.file) {
    await importCommand(runtime, io, {
      file: values.file,
      ...(values.slug ? { slug: values.slug } : {}),
      ...(values["owner-email"] ? { ownerEmail: values["owner-email"] } : {}),
      notify: values.notify,
    });
    return 0;
  }
  io.out(cliUsage);
  return 2;
}
