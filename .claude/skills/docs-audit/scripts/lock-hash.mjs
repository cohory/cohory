// Compare skills-lock.json with the installed skill folders, the way the skills CLI hashes them:
// sha256 over every file sorted by relativePath.localeCompare, updating with the path then the content.
// Usage: node lock-hash.mjs [repo-root] [--write]
// Prints the stale entries and any symlinks under .claude/skills, exits 1 when either exists.
// --write rewrites the stale hashes; use it only after the skills CLI itself confirmed the folders.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const root = resolve(args.find((a) => !a.startsWith("--")) ?? ".");

async function collect(base, dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      await collect(base, path, out);
    } else if (entry.isFile()) {
      out.push({ relativePath: relative(base, path).split("\\").join("/"), content: await readFile(path) });
    }
  }
}

async function hashDir(dir) {
  const files = [];
  await collect(dir, dir, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

const lockPath = join(root, "skills-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const stale = [];
const symlinks = [];
const unverifiable = [];
for (const [name, entry] of Object.entries(lock.skills)) {
  const dir = join(root, ".claude/skills", name);
  if ((await lstat(dir)).isSymbolicLink()) symlinks.push(name);
  const hash = await hashDir(dir);
  if (hash === entry.computedHash) continue;
  if (String(entry.source).startsWith("vercel-labs/")) {
    unverifiable.push(name);
    continue;
  }
  stale.push(name);
  entry.computedHash = hash;
}
console.log(`lock-hash: ${Object.keys(lock.skills).length} entries, stale: ${stale.length ? stale.join(", ") : "none"}, symlinks: ${symlinks.length ? symlinks.join(", ") : "none"}, only the CLI can verify: ${unverifiable.length ? unverifiable.join(", ") : "none"}`);
if (write && stale.length) {
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");
  console.log("skills-lock.json rewritten");
}
process.exit(stale.length || symlinks.length ? 1 : 0);
