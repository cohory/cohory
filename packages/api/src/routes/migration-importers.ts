import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import {
  importerCatalog,
  importerIds,
  importerMaxBytes,
  importerMaxFiles,
} from "@cohory/migration";
import { clientIp } from "@cohory/rate-limit";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor } from "../middleware/session";
import { migrationJobJson, migrationJobSchema, type MigrationRouteDeps } from "./migration";
import { errorResponse, json, slugParams, tooManyRequests } from "./posts-schemas";

const security = [{ sessionCookie: [] }];
const tags = ["Migration"];
const base = "/communities/{slug}/manage/migration/importers";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("Only the owner can do this."),
  404: errorResponse("The community does not exist or is not visible to the caller."),
  409: errorResponse("The community is not empty or archived."),
  422: errorResponse("The files are invalid, too large, or hold nothing to import."),
};

const importerSchema = z
  .object({
    id: z.enum(importerIds),
    name: z.string(),
    version: z.string().openapi({ description: "Importer version (semver)." }),
    accept: z.array(z.string()),
    limitsPath: z.string().openapi({ description: "Published limits page in the app." }),
    files: z.array(z.object({ label: z.string(), description: z.string() })),
    transfers: z.array(z.string()),
    doesNotTransfer: z.array(z.string()),
  })
  .openapi("Importer");

const importerListSchema = z
  .object({
    data: z.array(importerSchema),
    ...pageCursor,
    maxFiles: z.int(),
    maxBytes: z.int(),
  })
  .openapi("ImporterList");

const fileSchema = z.custom<File>((value) => value instanceof File, { message: "Attach a file." });

const uploadFormSchema = z.object({
  files: z
    .union([fileSchema, z.array(fileSchema).min(1).max(importerMaxFiles)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .openapi({
      type: "array",
      items: { type: "string", format: "binary" },
      description: `Up to ${importerMaxFiles} CSV or JSON files, 25 MB together. Repeat the field for each file.`,
    }),
});

const importerParams = slugParams.extend({
  importer: z.enum(importerIds).openapi({ param: { name: "importer", in: "path" } }),
});

const listImporters = createRoute({
  method: "get",
  path: base,
  operationId: "listImporters",
  "x-cohory": routeMeta("listImporters"),
  tags,
  security,
  summary: "List platform importers",
  description:
    "The Skool and Circle importers with their versions, the files they read, and what transfers. Owner only.",
  request: { params: slugParams },
  responses: { 200: json(importerListSchema, "The importers."), ...errors },
});

const uploadPlatformImport = createRoute({
  method: "post",
  path: `${base}/{importer}/uploads`,
  operationId: "uploadPlatformImport",
  "x-cohory": routeMeta("uploadPlatformImport"),
  tags,
  security,
  summary: "Upload a Skool or Circle export",
  description:
    "Reads the export files in the `files` field, detects each file, converts members, categories, posts, and comments into the archive format, and returns an import job with a preview, warnings, skipped rows, and unknown columns. Files are read as data and never run; HTML is sanitized. Nothing is imported until you confirm with confirmArchiveImport. The community must be empty. Fair use member limits apply when you confirm. Owner only.",
  middleware: [bodyLimit({ maxSize: importerMaxBytes + 256 * 1024 })] as const,
  request: {
    params: importerParams,
    body: { required: true, content: { "multipart/form-data": { schema: uploadFormSchema } } },
  },
  responses: {
    201: json(migrationJobSchema, "The validated import with its preview."),
    429: tooManyRequests,
    ...errors,
  },
});

export function createMigrationImporterRoutes(getDeps: () => MigrationRouteDeps) {
  const app = createRouter();
  app.use(
    "/communities/:slug/manage/migration/importers",
    resolveActor(() => getDeps().resolveSession),
  );
  app.use(
    "/communities/:slug/manage/migration/importers/*",
    resolveActor(() => getDeps().resolveSession),
  );
  const migration = () => getDeps().migration;

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(listImporters, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      await migration().importAvailability(caller, id);
      const data = importerIds.map((importer) => {
        const entry = importerCatalog[importer];
        return {
          id: entry.id,
          name: entry.name,
          version: entry.version,
          accept: [...entry.accept],
          limitsPath: entry.limitsPath,
          files: entry.files.map((file) => ({ ...file })),
          transfers: [...entry.transfers],
          doesNotTransfer: [...entry.doesNotTransfer],
        };
      });
      return c.json(
        { data, nextCursor: null, maxFiles: importerMaxFiles, maxBytes: importerMaxBytes },
        200,
      );
    })
    .openapi(uploadPlatformImport, async (c) => {
      const caller = c.get("actor");
      const { slug, importer } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const key = caller.kind === "user" ? caller.userId : clientIp(c.req.raw.headers);
      getDeps().rateLimiter.consume("migrationPreview", key);
      const files = await Promise.all(
        c.req.valid("form").files.map(async (file) => ({
          name: (file.name || "upload").slice(0, 200),
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const view = await migration().uploadPlatformImport(caller, id, importer, files);
      return c.json(migrationJobJson(view), 201);
    });
}
