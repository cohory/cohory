# Agent courses

Status: Draft, 2026-10-19

How creators prepare a course for agents: add agent material to lessons, publish a version, and download it as an Agent Skills folder. The format is specified in [../architecture/agent-course-format.md](../architecture/agent-course-format.md).

## Who can do what

| Person | Can |
|---|---|
| Owner, admin | Write agent material, draft it from a lesson, publish versions, download the skill zip |
| Moderator, member | Read the published agent material of courses they can open, through the API (and through MCP once its tools exist). Not the drafts |
| Agent with `courses:read` | Read published material, tasks, and files of courses its owner can open |
| Agent with `courses:write` | Edit drafts when its owner is an owner or admin. Publishing a version always waits for a person's approval |

## 1. Add agent material to a lesson

1. Open the lesson and choose **Edit lesson**.
2. Open the **For agents** tab.
3. Choose **Draft from lesson** to start from the lesson itself. Cohory builds a suggestion without any AI service: the objective from the first heading (or the first sentence), the instructions from the lesson text without raw HTML, one task for each item of a numbered list under a heading such as Exercises, Tasks, Practice, or Homework, and a code template for each fenced code block. Nothing is saved or published yet.
4. Edit the fields:
   - **Objective**: one sentence about what the agent should be able to do.
   - **Instructions**: Markdown. Raw HTML is refused.
   - **References**: upload files the agent should read (PDF, ZIP, PNG, JPEG, Markdown, text, or CSV, up to 25 MB each).
   - **Templates**: upload a file or add a code template (file name, language, code).
   - **Tasks**: an id (lowercase letters, digits, dashes), a title, a prompt, and two JSON Schemas for the input and the expected output. Invalid JSON is flagged as you type, and the schema is checked against JSON Schema 2020-12 after a short pause.
   - **Evaluations**: for a task, a JSON Schema check, a rubric, or a script. Scripts are text for the agent's own sandbox; Cohory never runs them.
5. Open **Preview what agents read** to check the outline, then choose **Save agent material**.

Only published lessons go into a version. A draft lesson with agent material shows "Lesson is a draft" on the course page.

## 2. Publish a version

1. Open the course page. The **Agent material** section lists every lesson with Included, Lesson is a draft, or No agent material.
2. Choose **Publish agent version**.
3. The first version is 1.0.0. Later, choose a patch (fixes), minor (new material), or major (changes that break earlier work) version.
4. Optionally describe what changed. The dialog shows the course's license for agents read only; these are the terms from the Agent access card below the lessons ([agent-courses-delegation.md](agent-courses-delegation.md)). To change them, change Agent access before you publish. The version keeps the terms it was published with.
5. Choose **Publish**.

Published versions never change. To fix something, edit the lesson and publish a new version. Publishing with no change since the latest version is refused.

## 3. Download the skill

Each published version has **Download skill {version}**. The zip holds one folder named after the course with `SKILL.md`, `LICENSE.txt`, `cohory-manifest.json` (checksums, license, source link), and `references/`, `templates/`, `tasks/`, and `evaluations/`. Downloading the same version twice gives the same bytes, so you can compare checksums.

To check a download with the Agent Skills reference validator:

```sh
unzip release-engineering-1.0.0.zip -d skill
uvx --from "git+https://github.com/agentskills/agentskills@217be548739f21d6008915c29aefe320ea1a90af#subdirectory=skills-ref" skills-ref validate skill/release-engineering
```

## 4. API

All routes are under `/api/v1/communities/{slug}`. Scopes are in `x-cohory` of `/api/openapi.json`.

| Route | Scope | Who |
|---|---|---|
| `GET /courses/{courseSlug}/agent-material/authoring` | `courses:read` | Owners and admins |
| `GET`, `PUT`, `DELETE /lessons/{lessonId}/agent-layer` | `courses:read`, `courses:write` | Owners and admins; agents need approval to delete |
| `POST /lessons/{lessonId}/agent-layer/draft` | `courses:read` | Owners and admins |
| `POST /courses/{courseId}/uploads/agent-file` | `courses:write` | Owners and admins |
| `GET`, `POST /courses/{courseSlug}/agent-versions` | `courses:read`, `courses:write` | Owners and admins; agents need approval to publish |
| `GET /courses/{courseSlug}/agent-versions/{version}/export` | `courses:read` | Owners and admins |
| `GET /courses/{courseId}/agent-export?version=` | `courses:read` | Delegated agents and agents of owners and admins; people with course access when the creator allows agent access. Returns a signed link valid for 5 minutes |
| `GET /courses/{courseId}/agent-material/file-content?path=&version=` | `courses:read` | Anyone who can read the lesson. Text up to 32 KiB inline, other files as a signed link |
| `GET /courses/{courseId}/agent-material?version=` | `courses:read` | Anyone who can read the course |
| `GET /courses/{courseId}/agent-material/lessons/{lessonId}/tasks/{taskId}?version=` | `courses:read` | Anyone who can read the lesson |
| `GET /courses/{courseId}/agent-material/files?path=&version=` | `courses:read` | Anyone who can read the lesson |

`POST /courses/{courseSlug}/agent-versions` takes `bump` and an optional `changelog`. `license` is optional: the terms always come from the course's agent access settings, and a body with a different license id answers 422.

## 5. Safety

- Agent material is course content written by a person. Agents get it with a notice that it is data, not instructions.
- Cohory never runs scripts, templates, or anything else from agent material or from skills, on the server or anywhere else.
- Files are private to the community, served as downloads with a sandboxing Content Security Policy, and checked against their SHA-256.
- Archive export and import carry agent material (archive format 1.1.0).
- How agents run tasks and report results: [../architecture/evaluation-runner.md](../architecture/evaluation-runner.md).

## Troubleshooting

| Message | What to do |
|---|---|
| "Use Markdown only. Raw HTML such as <script> or <div> is not allowed." | Remove the HTML tags, or put the code inside a fenced code block |
| "This is not a valid JSON Schema at /type" | Fix the schema; `type` must be one of string, number, integer, boolean, object, array, or null |
| "Refer only to definitions inside this schema" | Replace links to other schemas with `$defs` inside the schema |
| "Add agent material to at least one published lesson." | Publish a lesson that has agent material, or add material to a published lesson |
| "The license terms changed in Agent access. Reload to publish with the current terms." | Reload the course page and publish again |
| "Nothing changed since version 1.2.0." | Edit something first, or keep using the existing version |
| "The file ... is missing or changed. Upload it again." | The stored file is gone or differs from its checksum; upload it again and save |
