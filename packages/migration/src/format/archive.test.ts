import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { MigrationError } from "../errors";
import { emptyArchiveRecords } from "../test/records";
import { readArchive, sha256, writeArchive, type ArchiveContents } from "./archive";
import { isSupportedSchemaVersion, schemaVersion } from "./manifest";

const communityId = "0199f0a0-0000-7000-8000-000000000001";
const limits = { maxBytes: 10 * 1024 * 1024, maxUploadBytes: 1024 * 1024 };

function contents(): ArchiveContents {
  const records = emptyArchiveRecords(communityId);
  return {
    meta: {
      edition: "community",
      exportedAt: new Date("2026-10-18T10:00:00.000Z"),
      community: { id: communityId, slug: "makers", name: "Makers" },
      missingUploads: [],
    },
    records: {
      ...records,
      users: [
        {
          id: "0199f0a0-0000-7000-8000-000000000002",
          email: "ada@example.test",
          name: "Ada",
          username: "ada",
          emailVerified: true,
          erased: false,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    },
    uploads: new Map([[`communities/${communityId}/posts/a.png`, new Uint8Array([1, 2, 3])]]),
  };
}

function rezip(bytes: Uint8Array, change: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(bytes);
  change(files);
  return zipSync(files);
}

function failure(run: () => unknown): MigrationError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof MigrationError) return error;
    throw error;
  }
  throw new Error("expected a migration error");
}

describe("archive format", () => {
  it("round trips records, uploads, and a manifest with counts and checksums", () => {
    const parsed = readArchive(writeArchive(contents()), limits);

    expect(parsed.manifest.schemaVersion).toBe(schemaVersion);
    expect(parsed.manifest.format).toBe("cohory-archive");
    expect(parsed.manifest.counts.users).toBe(1);
    expect(parsed.manifest.uploads).toEqual({ count: 1, bytes: 3 });
    expect(parsed.records.users[0]?.email).toBe("ada@example.test");
    expect([...(parsed.uploads.get(`communities/${communityId}/posts/a.png`) ?? [])]).toEqual([
      1, 2, 3,
    ]);
    expect(parsed.manifest.files.find((file) => file.path === "data/users.jsonl")?.sha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("adds a README and spreadsheet copies of members, posts, and comments", () => {
    const base = contents();
    const userId = base.records.users[0]?.id ?? "";
    const postId = "0199f0a0-0000-7000-8000-000000000010";
    const paragraph = (text: string) => ({
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const at = "2026-10-02T00:00:00.000Z";
    const bytes = writeArchive({
      ...base,
      records: {
        ...base.records,
        memberships: [
          {
            id: "0199f0a0-0000-7000-8000-000000000003",
            userId,
            role: "member",
            status: "active",
            bio: null,
            joinAnswers: null,
            bannedEmail: null,
            joinedAt: at,
            lastSeenAt: null,
            createdAt: at,
          },
        ],
        posts: [
          {
            id: postId,
            authorId: userId,
            categoryId: null,
            title: "Hello, makers",
            body: paragraph("=SUM(A1) is text here"),
            pinnedAt: null,
            editedAt: null,
            deletedAt: null,
            deletedBy: null,
            lastActivityAt: at,
            createdAt: at,
            updatedAt: at,
          },
        ],
        comments: [
          {
            id: "0199f0a0-0000-7000-8000-000000000011",
            postId,
            parentId: null,
            authorId: userId,
            body: paragraph("Nice"),
            editedAt: null,
            deletedAt: null,
            deletedBy: null,
            createdAt: at,
            updatedAt: at,
          },
        ],
      },
    });
    const files = unzipSync(bytes);
    const text = (path: string) =>
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(files[path]);

    expect(text("README.txt")).toContain("spreadsheets/members.csv");
    expect(text("spreadsheets/members.csv")).toBe(
      `\uFEFFemail,name,username,role,status,joined_at\r\nada@example.test,Ada,ada,member,active,${at}\r\n`,
    );
    expect(text("spreadsheets/posts.csv")).toContain(`"Hello, makers",'=SUM(A1) is text here,no`);
    expect(text("spreadsheets/comments.csv")).toContain(`,ada@example.test,Nice\r\n`);
    const parsed = readArchive(bytes, limits);
    expect(parsed.manifest.files.map((file) => file.path)).toContain("spreadsheets/posts.csv");
    expect(parsed.records.posts).toHaveLength(1);
  });

  it("refuses a file whose bytes do not match the manifest checksum", () => {
    const tampered = rezip(writeArchive(contents()), (files) => {
      files["data/users.jsonl"] = strToU8(`${JSON.stringify({ id: "x" })}\n`);
    });

    expect(failure(() => readArchive(tampered, limits)).code).toBe("checksum_mismatch");
  });

  it("refuses files the format does not define", () => {
    const extra = rezip(writeArchive(contents()), (files) => {
      files["scripts/run.sh"] = strToU8("echo hi");
    });

    expect(failure(() => readArchive(extra, limits)).code).toBe("invalid_archive");
  });

  it("refuses paths that climb out of the archive", () => {
    const climbing = rezip(writeArchive(contents()), (files) => {
      files["uploads/../../etc/passwd"] = strToU8("root");
    });

    expect(failure(() => readArchive(climbing, limits)).code).toBe("invalid_archive");
  });

  it("refuses a newer minor or another major schema version", () => {
    expect(isSupportedSchemaVersion("1.0.0")).toBe(true);
    expect(isSupportedSchemaVersion("1.1.0")).toBe(true);
    expect(isSupportedSchemaVersion("1.2.0")).toBe(true);
    expect(isSupportedSchemaVersion("1.3.0")).toBe(true);
    expect(isSupportedSchemaVersion("1.4.0")).toBe(true);
    expect(isSupportedSchemaVersion("1.5.0")).toBe(true);
    expect(isSupportedSchemaVersion("1.6.0")).toBe(true);
    expect(isSupportedSchemaVersion("1.7.0")).toBe(false);
    expect(isSupportedSchemaVersion("2.0.0")).toBe(false);
    expect(isSupportedSchemaVersion("0.9.0")).toBe(false);

    const future = rezip(writeArchive(contents()), (files) => {
      const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as object;
      files["manifest.json"] = strToU8(JSON.stringify({ ...manifest, schemaVersion: "2.0.0" }));
    });

    expect(failure(() => readArchive(future, limits)).code).toBe("unsupported_schema_version");
  });

  it("refuses an archive larger than the limit and bytes that are not a zip", () => {
    const bytes = writeArchive(contents());

    expect(failure(() => readArchive(bytes, { ...limits, maxBytes: 10 })).code).toBe(
      "archive_too_large",
    );
    expect(failure(() => readArchive(strToU8("not a zip"), limits)).code).toBe("invalid_archive");
  });

  it("reports the line of a record that does not match the schema", () => {
    const line = `${JSON.stringify({ id: "nope" })}\n`;
    const bytes = rezip(writeArchive(contents()), (files) => {
      const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as {
        files: { path: string; bytes: number; sha256: string }[];
      };
      const data = strToU8(line);
      files["data/categories.jsonl"] = data;
      for (const file of manifest.files) {
        if (file.path === "data/categories.jsonl") {
          file.bytes = data.byteLength;
          file.sha256 = sha256(data);
        }
      }
      files["manifest.json"] = strToU8(JSON.stringify(manifest));
    });

    const error = failure(() => readArchive(bytes, limits));

    expect(error.code).toBe("invalid_archive");
    expect(error.issues[0]?.path).toMatch(/^data\/categories\.jsonl:1/);
  });

  it("reads a 1.0.0 archive that has no agent material files", () => {
    const old = rezip(writeArchive(contents()), (files) => {
      const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as {
        files: { path: string }[];
        counts: Record<string, number>;
      };
      delete files["data/lesson_agent_layers.jsonl"];
      delete files["data/course_agent_versions.jsonl"];
      delete files["data/course_agent_settings.jsonl"];
      manifest.files = manifest.files.filter((file) => !file.path.includes("agent"));
      files["manifest.json"] = strToU8(JSON.stringify({ ...manifest, schemaVersion: "1.0.0" }));
    });

    const parsed = readArchive(old, limits);

    expect(parsed.records.lesson_agent_layers).toEqual([]);
    expect(parsed.records.course_agent_versions).toEqual([]);
    expect(parsed.records.course_agent_settings).toEqual([]);
  });

  it("reads a 1.2.0 archive without a gallery file or a detailed description", () => {
    const old = rezip(writeArchive(contents()), (files) => {
      const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as {
        files: { path: string; bytes: number; sha256: string }[];
      };
      delete files["data/community_gallery.jsonl"];
      manifest.files = manifest.files.filter((file) => !file.path.includes("community_gallery"));
      files["manifest.json"] = strToU8(JSON.stringify({ ...manifest, schemaVersion: "1.2.0" }));
    });

    const parsed = readArchive(old, limits);

    expect(parsed.records.community_gallery).toEqual([]);
    expect(parsed.records.community[0]?.detailedDescription).toBeNull();
  });

  it("reads a 1.4.0 archive that has no README or spreadsheet copies", () => {
    const old = rezip(writeArchive(contents()), (files) => {
      const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as {
        files: { path: string }[];
      };
      const readable = (path: string) => path === "README.txt" || path.startsWith("spreadsheets/");
      delete files["README.txt"];
      delete files["spreadsheets/members.csv"];
      delete files["spreadsheets/posts.csv"];
      delete files["spreadsheets/comments.csv"];
      manifest.files = manifest.files.filter((file) => !readable(file.path));
      files["manifest.json"] = strToU8(JSON.stringify({ ...manifest, schemaVersion: "1.4.0" }));
    });

    const parsed = readArchive(old, limits);

    expect(parsed.manifest.schemaVersion).toBe("1.4.0");
    expect(parsed.records.users.map((user) => user.email)).toEqual(["ada@example.test"]);
    expect(parsed.uploads.size).toBe(1);
  });

  it("requires the agent material files in a 1.1.0 archive", () => {
    const broken = rezip(writeArchive(contents()), (files) => {
      const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as {
        files: { path: string }[];
      };
      delete files["data/course_agent_versions.jsonl"];
      manifest.files = manifest.files.filter(
        (file) => file.path !== "data/course_agent_versions.jsonl",
      );
      files["manifest.json"] = strToU8(JSON.stringify(manifest));
    });

    expect(failure(() => readArchive(broken, limits)).code).toBe("invalid_archive");
  });
});
