# 0021. Agent course format 1.0.0, immutable snapshots, and Agent Skills export

cohory stores a structured agent layer per lesson as validated JSON, freezes it into immutable, checksummed course versions, and exports each version as a deterministic Agent Skills folder.

Status: Accepted, 2026-10-19

- ADR status: Accepted (founder, 2026-10-19, as built)
- Date: 2026-10-19
- Deciders: Step 15 unit T1 (proposed)
- Related: [0006](0006-shared-database-multi-tenancy.md), [0011](0011-mcp-first-class-api-surface.md), [../architecture/agent-course-format.md](../architecture/agent-course-format.md), [../architecture/agent-integrations.md](../architecture/agent-integrations.md) sections 9 and 11

## Context

Phase 7 asks for courses that agents can read and be checked on, with Agent Skills compatibility and a format small enough to survive changes in agent ecosystems ([roadmap](../foundation/roadmap.md) Phase 7). Agents must be able to cite exactly which material they learned from, so the material an agent reads cannot change under it. Lesson bodies are edited freely by creators and are not versioned. Course content is untrusted input and must never be executed by cohory.

## Decision

- A lesson gets an optional layer (objective, Markdown instructions, references, templates, tasks with input and expected output JSON Schemas, evaluations of kind schema, rubric, or script) stored as jsonb in `lesson_agent_layers`, one row per lesson, staff only. It is separate from the lesson body, so the human lesson stays unchanged.
- The format is validated with zod at the service boundary, plus JSON Schema 2020-12 meta validation with Ajv (`validateSchema` only, never compiling user schemas). Ajv 8.20.0 is added to `@cohory/courses`; it was already in the lockfile through the MCP SDK.
- Publishing copies the layers of published lessons into `course_agent_versions.snapshot` with a semantic version, a changelog, a license, the source URL, and SHA-256 checksums. Rows are immutable: no update policy, and a trigger refuses `UPDATE`.
- Files are stored once in the storage driver under the course `agent/` folder with their SHA-256 in the layer, and are never overwritten, so a snapshot can keep referring to them. Exports and file reads verify the hash.
- The export is a zip generated on request from the snapshot, not stored. It is byte identical for the same version (sorted entries, fixed timestamps, fixed compression). `fflate` 0.8.3, already used by the migration archive, writes it.
- Authoring needs `course.update` (owners and admins), publishing needs the new policy action `course.publish_agent_version` (owners and admins; agents need a person's approval under the `publishing` category), and reading the published material uses the existing `course.read` and `lesson.read` entitlement checks so that delegated access can extend them in one place.

## Consequences

- Agents and evaluations can name a precise version and checksum. Creators fix mistakes by publishing a new version, never by editing an old one.
- Deleting a course removes its versions. Deleting a file reference from a draft does not delete the stored file, because older versions may need it; storage is reclaimed only with the course or community.
- Snapshots duplicate layer JSON per version (at most 2 MB each). This is acceptable for the expected number of versions.
- The export needs the files to still exist in storage. A missing file makes that version unexportable until restored from backup.

## Alternatives considered

- **Version every lesson edit.** Rejected: most edits are for humans, and a course level version is what an agent consumes.
- **Store the export zip.** Rejected: duplicate bytes and a second thing to keep consistent. Deterministic generation gives the same result.
- **A table per task and evaluation.** Rejected for 1.0.0: the layer is read and written as a whole, and jsonb keeps the format portable in the archive. A later version can normalize if queries need it.
- **Run evaluation scripts on the server.** Rejected by the security rules ([agent-integrations.md](../architecture/agent-integrations.md) section 9 rule 5).

## Decisions and open questions

| Label | Item |
|---|---|
| Recommendation | Everything in the Decision section. |
| Open question | Whether members may download the skill zip of courses they can read (staff only for now). |
| Open question | Licensing terms for agent consumption of paid content (founder decision). |
