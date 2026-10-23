import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { readZip } from "../support/zip";
import { addLesson, createCourse, publishCourse } from "../pages/classroom";
import { createCommunity } from "../pages/community";
import { settle } from "../pages/feed";

const lessonBody = [
  "# Plan a release",
  "",
  "Releases go out every Tuesday. Keep them small.",
  "",
  "```bash",
  "git tag v1.0.0",
  "```",
  "",
  "## Exercises",
  "",
  "1. Write a release checklist for your team.",
  "2. Tag a release in a test repository.",
].join("\n");

const allowedFrontmatter = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

function frontmatter(skill: string): Map<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  expect(match, "SKILL.md starts with YAML frontmatter").not.toBeNull();
  const fields = new Map<string, string>();
  for (const line of (match?.[1] ?? "").split("\n")) {
    const top = /^([A-Za-z-]+):\s?(.*)$/.exec(line);
    if (!top?.[1]) continue;
    const raw = top[2] ?? "";
    fields.set(top[1], raw.startsWith('"') ? (JSON.parse(raw) as string) : raw);
  }
  return fields;
}

test("step 15: a creator authors agent material, publishes 1.0.0, and downloads the skill", async ({
  actor,
}) => {
  const owner = await actor("Grace", { desktop: true });
  const { page } = owner;
  const slug = await createCommunity(page, `Agents ${uniqueSuffix()}`, "private");
  const courseSlug = await createCourse(page, slug, "Release engineering");
  const lessonSlug = await addLesson(page, slug, courseSlug, "Module 1", {
    title: "Plan a release",
    body: lessonBody,
  });
  await publishCourse(page, slug, courseSlug);

  await test.step("draft agent material from the lesson and save it", async () => {
    await page.goto(`/c/${slug}/classroom/${courseSlug}/${lessonSlug}?edit=1`);
    await settle(page);
    await page.getByRole("tab", { name: "For agents" }).click();
    await page.getByRole("button", { name: "Draft from lesson" }).click();
    await expect(page.getByLabel("Objective")).toHaveValue("Plan a release");
    await expect(page.getByRole("textbox", { name: "Prompt" }).first()).toHaveValue(
      "Write a release checklist for your team.",
    );
    await page.locator('input[aria-label="Reference file"]').setInputFiles({
      name: "checklist.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Checklist\n\n- Test\n- Roll back\n"),
    });
    await expect(page.getByText("checklist.md", { exact: true })).toBeVisible({ timeout: 30_000 });
    const input = page.getByRole("textbox", { name: "Input schema" }).first();
    await input.fill('{ "type": "nope" }');
    await expect(page.getByText(/not a valid JSON Schema/).first()).toBeVisible();
    await input.fill('{ "type": "object" }');
    await expect(page.getByText(/not a valid JSON Schema/)).toHaveCount(0);
    await expectAccessible(page, "lesson editor, for agents");
    await page.getByRole("button", { name: "Save agent material" }).click();
    await expect(page.getByText(/Agent material saved/)).toBeVisible();
  });

  await test.step("publish agent version 1.0.0 from the course page", async () => {
    await page.goto(`/c/${slug}/classroom/${courseSlug}`);
    await settle(page);
    const section = page.getByRole("region", { name: "Agent material" });
    await expect(section.getByText("Included")).toBeVisible();
    await expectAccessible(page, "course with agent material");
    await section.getByRole("button", { name: "Publish agent version" }).click();
    await page.getByLabel("What changed").fill("First version for agents.");
    await page.getByRole("button", { name: "Publish 1.0.0" }).click();
    await expect(page.getByText("Version 1.0.0 published.")).toBeVisible();
    await expect(section.getByRole("link", { name: "Download skill 1.0.0" })).toBeVisible();
  });

  await test.step("download the skill and validate SKILL.md against the spec", async () => {
    const section = page.getByRole("region", { name: "Agent material" });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      section.getByRole("link", { name: "Download skill 1.0.0" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("release-engineering-1.0.0.zip");
    const target = test.info().outputPath(download.suggestedFilename());
    await download.saveAs(target);
    const files = readZip(await readFile(target));
    const names = [...files.keys()];
    expect(names.every((name) => name.startsWith("release-engineering/"))).toBe(true);
    const skill = files.get("release-engineering/SKILL.md")?.toString("utf8") ?? "";
    const meta = frontmatter(skill);
    for (const key of meta.keys()) expect(allowedFrontmatter.has(key), key).toBe(true);
    const name = meta.get("name") ?? "";
    expect(name).toBe("release-engineering");
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    const description = meta.get("description") ?? "";
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(names).toEqual(
      expect.arrayContaining([
        "release-engineering/cohory-manifest.json",
        "release-engineering/LICENSE.txt",
        `release-engineering/references/001-${lessonSlug}/checklist.md`,
        `release-engineering/templates/001-${lessonSlug}/snippet-1.sh`,
        `release-engineering/tasks/001-${lessonSlug}/task-1.input.schema.json`,
        `release-engineering/evaluations/001-${lessonSlug}/task-1-1.json`,
      ]),
    );
    const manifest = JSON.parse(
      files.get("release-engineering/cohory-manifest.json")?.toString("utf8") ?? "{}",
    ) as { files: Record<string, string>; version: string; sourceUrl: string };
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.sourceUrl).toContain(`/c/${slug}/classroom/${courseSlug}`);
    for (const [path, digest] of Object.entries(manifest.files)) {
      const bytes = files.get(`release-engineering/${path}`);
      expect(bytes && createHash("sha256").update(bytes).digest("hex"), path).toBe(digest);
    }

    const again = await page.request.get(
      `/api/v1/communities/${slug}/courses/${courseSlug}/agent-versions/1.0.0/export`,
    );
    expect(Buffer.compare(await again.body(), await readFile(target))).toBe(0);
  });

  await test.step("check the course page at phone width", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/c/${slug}/classroom/${courseSlug}`);
    await settle(page);
    await expect(page.getByRole("region", { name: "Agent material" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await expectAccessible(page, "course with agent material, phone");
  });
});
