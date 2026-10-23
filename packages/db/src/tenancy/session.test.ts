import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { migrationsFolder } from "../migrations";
import { rlsFlags, rlsSettingName, rlsValues } from "./session";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function settingsReadByMigrations(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(migrationsFolder).filter((name) => name.endsWith(".sql"))) {
    const text = readFileSync(join(migrationsFolder, file), "utf8");
    for (const match of text.matchAll(/current_setting\(\s*'app\.([a-z_]+)'/g)) {
      names.add(match[1] ?? "");
    }
  }
  return names;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "test" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("RLS session settings", () => {
  it("names exactly the settings the migrations read", () => {
    expect([...rlsFlags, ...rlsValues].sort()).toEqual([...settingsReadByMigrations()].sort());
  });

  it("prefixes every setting with app.", () => {
    expect(rlsSettingName("calendar_manager")).toBe("app.calendar_manager");
    expect(rlsSettingName("user_id")).toBe("app.user_id");
  });

  it("is the only source module that calls set_config", () => {
    const callers = ["packages", "apps"]
      .flatMap((top) =>
        readdirSync(join(repoRoot, top), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .flatMap((entry) =>
            ["src", "lib", "app"].map((sub) => join(repoRoot, top, entry.name, sub)),
          ),
      )
      .filter((dir) => existsSync(dir))
      .flatMap(sourceFiles)
      .filter((file) => readFileSync(file, "utf8").includes("set_config("))
      .map((file) => relative(repoRoot, file));
    expect(callers).toEqual(["packages/db/src/tenancy/session.ts"]);
  });
});
