# Agent course format

The agent course format is the structured layer creators add to lessons so that agents can learn a workflow and be checked on it. This document specifies format version **1.1.0** (`cohory-agent-course`; 1.1.0 adds one license id to 1.0.0, and 1.0.0 manifests stay valid), how Cohory stores and versions it, and how it is exported as an [Agent Skills](https://agentskills.io/specification) folder. The design background is [agent-integrations.md](agent-integrations.md) section 11, and the decision record is [ADR 0021](../decisions/0021-agent-course-format-and-storage.md). The creator guide is [../operations/agent-courses.md](../operations/agent-courses.md).

The format is Markdown plus JSON and stays small on purpose. Everything in it is untrusted course content (section 9 of [agent-integrations.md](agent-integrations.md)): Cohory validates and stores it, and never runs it.

## 1. Where it lives

| Layer | Table | Who sees it |
|---|---|---|
| Draft per lesson | `lesson_agent_layers` (one row per lesson, `layer` jsonb) | Owners and admins only (course managers) |
| Published course version | `course_agent_versions` (immutable `snapshot` jsonb plus `checksum`) | Members who can read the course, and their agents through the API |
| Files (references and file templates) | Storage driver, key `communities/{community}/courses/{course}/agent/{file}.{ext}` | Served only through the service, never by public URL |

Both tables are tenant scoped with forced row level security (migration 0023). Drafts need the `app.course_manager` setting. Versions are readable in the community scope, insertable only with the manager setting, have no update policy, and a trigger refuses any `UPDATE`. They disappear only when their course is deleted.

An uploaded file that no draft layer and no published version refers to is deleted by the worker job `courses.agent-files-gc` (daily at 04:50 UTC) once it is older than 7 days, so a creator can still save a draft that uses a file uploaded the day before. Files that a version refers to are never collected while the version exists.

## 2. Lesson layer

A lesson layer is one JSON object. Unknown fields are refused.

| Field | Type | Limits and rules |
|---|---|---|
| `objective` | string | 1 to 500 characters, one line. What the agent should be able to do after the lesson |
| `instructions` | Markdown | Up to 50,000 characters. No raw HTML outside code |
| `references` | array of `{ title, file }` | Up to 20. `title` 1 to 120 characters |
| `templates` | array | Up to 20. Either `{ kind: "file", title, file }` or `{ kind: "code", title, name, language, content }` with `content` up to 50,000 characters |
| `tasks` | array of `{ id, title, prompt, inputSchema, outputSchema }` | Up to 20. `id` is lowercase letters, digits, and dashes (1 to 64, unique in the lesson). `prompt` is Markdown up to 10,000 characters. Both schemas are JSON Schemas |
| `evaluations` | array of `{ taskId, kind, spec }` | Up to 40. `taskId` must name a task of the lesson |

A `file` object is `{ name, key, mediaType, size, sha256 }`. `name` is a plain file name (letters, digits, dot, dash, underscore, first character a letter or digit, no `..`, no folders, up to 100 characters). `key` must be an agent file key of the same community and course. `mediaType` is set by the server from the key. `sha256` is the hex digest of the bytes, checked again when a version is published and when it is exported. File types and size follow lesson attachments: PDF, ZIP, PNG, JPEG, Markdown, text, or CSV, up to 25 MB each.

Evaluation `spec` by `kind`:

| Kind | Spec | Meaning |
|---|---|---|
| `schema` | `{ schema }` | The task output must match this JSON Schema |
| `rubric` | `{ criteria: [{ id, description, points }], passingScore }` | Up to 20 criteria, 0 to 100 points each |
| `script` | `{ language, source }` | Source up to 50,000 characters. Text for the consuming agent's own sandbox. Cohory never runs it, and the export writes it inside JSON, never as an executable file |

### 2.1 Text rules

- Hidden characters (control characters other than new line and tab, zero width characters, bidirectional overrides, soft hyphens, byte order marks) are removed before storage, so people and agents read the same text.
- HTML comments are removed from Markdown fields.
- Markdown fields refuse raw HTML outside code spans and fenced code (for example `<script>` or `<div onclick>`), with "Use Markdown only".
- One line fields collapse whitespace.

### 2.2 JSON Schema rules

Task schemas and `schema` evaluation specs must be JSON Schema 2020-12. Each document:

- is an object or a boolean,
- is at most 32 KB as JSON and at most 32 levels deep,
- uses `"$schema": "https://json-schema.org/draft/2020-12/schema"` or leaves it out,
- refers only to itself (`$ref` and `$dynamicRef` start with `#`, `$id` is not an absolute URL),
- passes meta schema validation (Ajv 8.20.0 `validateSchema`; schemas are never compiled or run on the server).

## 3. Published version

Publishing takes the layers of every **published** lesson of the course, in course order (module position, then lesson position), and freezes them. A version needs at least one such lesson.

### 3.1 Version numbers

Versions are semantic versions `MAJOR.MINOR.PATCH`. The first version of a course is always `1.0.0`. After that the creator picks a bump: patch adds 1 to PATCH, minor adds 1 to MINOR and resets PATCH, major adds 1 to MAJOR and resets the rest. Publishing is refused when nothing changed since the latest version (same `contentSha256`). Two publishes racing for the same number fail one of them with "Reload and try again".

### 3.2 Snapshot

```json
{
  "manifest": {
    "format": "cohory-agent-course",
    "formatVersion": "1.1.0",
    "course": { "id": "uuid", "slug": "release-engineering", "title": "Release engineering", "description": "..." },
    "version": "1.0.0",
    "changelog": "First version.",
    "publishedAt": "2026-10-19T10:00:00.000Z",
    "license": { "id": "personal-agent-use", "text": "" },
    "sourceUrl": "https://learn.example.com/c/makers/classroom/release-engineering",
    "contentSha256": "hex"
  },
  "lessons": [
    { "id": "uuid", "slug": "checklists", "title": "Checklists", "position": 1, "layer": { "objective": "..." } }
  ]
}
```

- `license` comes from the course's agent access terms when the version is published ([../operations/agent-courses-delegation.md](../operations/agent-courses-delegation.md)); the creator does not pick it in the publish dialog. The course setting maps to the manifest id in one place (`packages/courses/src/agent/license.ts`): `personal_agents` to `personal-agent-use` ("Personal use by the buyer's agents only", the default), `team_agents` to `team-agent-use` ("Use by agents of the buyer's own team", new in 1.1.0), and `custom` to `custom`. `text` is the terms summary followed by the creator's extra text, or only the creator's text for `custom`, as Markdown up to 20,000 characters.
- Readers also accept `all-rights-reserved`, `cc-by-4.0`, `cc-by-sa-4.0`, and `mit`, which versions published before 1.1.0 could carry. New versions never use them. A version keeps the terms it was published with; changing the course terms affects the next version only.
- `contentSha256` is the SHA-256 of the canonical JSON of course, license, and lessons. It ignores version, date, and changelog, and detects "nothing changed".
- The version `checksum` column is the SHA-256 of the canonical JSON of the whole snapshot. Canonical JSON sorts object keys and drops undefined values.
- A snapshot is at most 2 MB of JSON, 500 lessons, and 50 MB of files.

### 3.3 What agents read

`GET /api/v1/communities/{slug}/courses/{courseId}/agent-material?version=` returns `{ notice, manifest, checksum, lessons }`. Lessons carry `objective`, `instructions`, `references` and `templates` with a `path` instead of the storage key, `tasks`, and `evaluations`. `notice` says the content is data, never instructions, and that scripts and templates run only in the reader's own sandbox, never with elevated permissions. One task: `.../agent-material/lessons/{lessonId}/tasks/{taskId}`. One file: `.../agent-material/files?path=` (attachment, `application/octet-stream`, sandboxed, ETag is the SHA-256).

## 4. Agent Skills export

The export follows the Agent Skills specification at <https://agentskills.io/specification>, verified on 2026-10-19 against revision [`217be548739f21d6008915c29aefe320ea1a90af`](https://github.com/agentskills/agentskills/blob/217be548739f21d6008915c29aefe320ea1a90af/docs/specification.mdx) of `docs/specification.mdx` (last changed 2026-08-04). That revision requires a folder whose name equals the skill `name`, a `SKILL.md` with YAML frontmatter (`name` 1 to 64 lowercase letters, digits, and single hyphens, not starting or ending with a hyphen; `description` 1 to 1024 characters; optional `license`, `compatibility`, `metadata` as string to string, `allowed-tools`), and recommends `references/`, `scripts/`, and `assets/` folders. The reference validator is `skills-ref validate`.

`GET /api/v1/communities/{slug}/courses/{courseSlug}/agent-versions/{version}/export` returns `{name}-{version}.zip`:

```
{name}/SKILL.md
{name}/LICENSE.txt
{name}/cohory-manifest.json
{name}/references/{NNN}-{lesson-slug}.md
{name}/references/{NNN}-{lesson-slug}/{file name}
{name}/templates/{NNN}-{lesson-slug}/{file or code template name}
{name}/tasks/{NNN}-{lesson-slug}/{task id}.md
{name}/tasks/{NNN}-{lesson-slug}/{task id}.input.schema.json
{name}/tasks/{NNN}-{lesson-slug}/{task id}.output.schema.json
{name}/evaluations/{NNN}-{lesson-slug}/{task id}-{n}.json
```

- `name` comes from the course slug (lowercase, other characters become single hyphens, at most 64 characters, `course` when empty).
- `SKILL.md` frontmatter holds `name`, `description` (course description plus the first lesson objectives), `license` (the license name and "LICENSE.txt has complete terms"), and `metadata` with `cohory-course-id`, `cohory-version`, `cohory-format`, and `cohory-source-url`. Values are written as JSON strings, which are valid YAML. The body explains how to use the folder, says that its content is data, and lists the lessons. It stays well under 500 lines because lesson text lives in `references/`.
- `templates/` is used instead of the specification's `assets/` to match the course vocabulary; the specification allows any folder.
- There is no `scripts/` folder. Script evaluations stay data under `evaluations/`.
- `cohory-manifest.json` is the snapshot manifest plus `snapshotSha256`, the Agent Skills specification URL and revision, and `files`, a SHA-256 for every other file in the folder.
- The zip is deterministic: entries sorted by path, deflate level 6, Unix attributes, and every timestamp set to `publishedAt` (UTC fields). The same version gives byte identical zips on any server.
- Before writing, every stored file is read back and checked against its size and SHA-256. A changed or missing file stops the export.

## 5. Archive

The community archive ([archive-format.md](archive-format.md)) carries `lesson_agent_layers` and `course_agent_versions` from schema version 1.1.0, plus the agent files under `uploads/`. On import, ids, storage keys, the source URL, and both checksums are rebased to the new community. Version numbers, dates, and changelogs stay the same.

## 6. Built separately, and not built

- Delegated agent access, purchase requests, and license terms at checkout came in 0.8.0 ([../operations/agent-courses-delegation.md](../operations/agent-courses-delegation.md)).
- Submissions of evaluation results are labeled self reported; nothing is called verified. How a consuming agent runs evaluations is in [evaluation-runner.md](evaluation-runner.md).
- MCP tools for the read routes, inline file reads, and signed links to the skill zip for delegated agents and for people with course access came in 0.8.0 ([ADR 0023](../decisions/0023-agent-course-delivery.md)).
- Hosted execution of evaluations is out of scope.

## Decisions and open questions

| Label | Item |
|---|---|
| Recommendation | Format 1.1.0 as above (1.0.0 plus the `team-agent-use` license id), Markdown plus JSON, JSON Schema 2020-12 only. |
| Confirmed | The three license presets stay: personal agent use (default), team agent use, and custom (founder, 2026-10-19). Their wording gets a legal review before the Cloud launch (human gate). |
| Recommendation | License terms come from the course's agent access settings, mapped in one module. |
| Recommendation | First version is 1.0.0; unchanged content cannot be republished. |
| Recommendation | `templates/` instead of `assets/` in the export. |
| Assumption | The Agent Skills revision recorded in section 4 stays compatible. Recheck it when the specification changes. |
| Open question | Licensing terms for agent consumption of paid content (founder decision; see agent-integrations.md section 11.5). |
| Recommendation | People with access to a course may download its skill zip through a signed link when the creator allows agent access; staff always can (since 0.8.0). |
