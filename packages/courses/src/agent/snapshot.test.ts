import { describe, expect, it } from "vitest";

import { referenceBytes, sampleSnapshot } from "../test/agent-layers";
import { canonicalJson } from "./canonical";
import { agentSnapshotSchema } from "./format";
import { rebaseSnapshot, snapshotChecksum, toAgentMaterial } from "./snapshot";

describe("agent material snapshots", () => {
  it("has a checksum that ignores key order", () => {
    const { snapshot, checksum } = sampleSnapshot();
    const shuffled = JSON.parse(canonicalJson(snapshot)) as unknown;
    const reordered = agentSnapshotSchema.parse(
      Object.fromEntries(Object.entries(shuffled as Record<string, unknown>).reverse()),
    );
    expect(snapshotChecksum(reordered)).toBe(checksum);
  });

  it("keeps the content checksum when only the version and date change", () => {
    const first = sampleSnapshot();
    const second = sampleSnapshot(new Date("2026-11-01T00:00:00.000Z"));
    expect(second.snapshot.manifest.contentSha256).toBe(first.snapshot.manifest.contentSha256);
    expect(second.checksum).not.toBe(first.checksum);
  });

  it("hides storage keys from the material agents read", () => {
    const { snapshot, checksum } = sampleSnapshot();
    const material = toAgentMaterial(snapshot, checksum);
    expect(JSON.stringify(material)).not.toContain("communities/");
    expect(material.lessons[0]?.references[0]?.file.path).toBe(
      "references/001-checklists/checklist.md",
    );
    expect(material.lessons[0]?.references[0]?.file.size).toBe(referenceBytes.byteLength);
  });

  it("rebases ids and keys for an imported community", () => {
    const { snapshot } = sampleSnapshot();
    const rebased = rebaseSnapshot(snapshot, {
      courseId: "0190b000-0000-7000-8000-000000000002",
      lessonId: () => "0190b000-0000-7000-8000-000000000010",
      key: (key) =>
        key.replace("0190a000-0000-7000-8000-000000000001", "0190b000-0000-7000-8000-000000000001"),
      sourceUrl: "https://other.example/c/copy/classroom/release-engineering",
    });
    expect(rebased?.snapshot.manifest.course.id).toBe("0190b000-0000-7000-8000-000000000002");
    expect(rebased?.snapshot.lessons[0]?.layer.references[0]?.file.key).toContain(
      "0190b000-0000-7000-8000-000000000001",
    );
    expect(rebased?.snapshot.manifest.version).toBe("1.0.0");
    expect(
      rebaseSnapshot(snapshot, {
        courseId: "x",
        lessonId: () => undefined,
        key: (k) => k,
        sourceUrl: "https://a.example",
      }),
    ).toBeNull();
  });
});
