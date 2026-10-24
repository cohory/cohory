# Archive format

The public, versioned file format that Cohory uses to export a whole community and import it into another instance (REQ-MIG-001, REQ-MIG-002, REQ-CRS-007).

This page describes format version **1.6.0**, which is built: the owner exports it from Manage, Migration, or with `pnpm migration` (`apps/worker/src/migration-cli.ts`), and imports it the same way. Other tools may read and write the format. Linking existing Stripe subscriptions ([payments.md](payments.md) section 12.9) and third party importers (Skool, Circle) are not part of this format version.

## 1. Versioning

**Confirmed** (0.4.0): the archive is a zip with a manifest, JSON lines per entity type, and an uploads folder, versioned with semantic versioning starting at 1.0.0.

- `schemaVersion` follows semver. A patch release fixes documentation or adds nothing a reader must handle. A minor release adds optional fields or new files; a 1.x reader ignores fields and files it does not know. A major release renames, removes, or changes the meaning of a field.
- An importer accepts any archive with the same major version and a minor version less than or equal to its own. It refuses a newer minor or a different major with the error `unsupported_schema_version` and names both versions.
- `cohoryVersion` records the application release that wrote the archive. It is informational; compatibility is decided by `schemaVersion` alone.

## 2. Layout

```
manifest.json
data/community.jsonl
data/community_gallery.jsonl
data/users.jsonl
data/memberships.jsonl
data/categories.jsonl
data/posts.jsonl
data/post_images.jsonl
data/comments.jsonl
data/reactions.jsonl
data/courses.jsonl
data/course_modules.jsonl
data/lessons.jsonl
data/lesson_progress.jsonl
data/lesson_agent_layers.jsonl
data/course_agent_versions.jsonl
data/course_agent_settings.jsonl
data/events.jsonl
data/event_occurrences.jsonl
data/event_rsvps.jsonl
data/points_ledger.jsonl
data/member_stats.jsonl
data/membership_plans.jsonl
data/subscriptions.jsonl
data/comped_memberships.jsonl
data/invite_links.jsonl
data/membership_requests.jsonl
data/reviews.jsonl
data/review_replies.jsonl
data/audit_log.jsonl
uploads/<storage key>
README.txt                 (1.5.0)
spreadsheets/members.csv   (1.5.0)
spreadsheets/posts.csv     (1.5.0)
spreadsheets/comments.csv  (1.5.0)
```

Every data file exists, even when it has no lines. Each line is one JSON object terminated by `\n`, encoded as UTF-8 without a byte order mark. Field names are camelCase. Timestamps are ISO 8601 strings in UTC (`2026-10-18T09:30:00.000Z`). Ids are the UUIDs of the exporting instance; an importer must not reuse them (section 5). Money is an integer in minor units with a lowercase ISO 4217 currency code, as everywhere in Cohory.

Version 1.1.0 adds `lesson_agent_layers.jsonl`, `course_agent_versions.jsonl`, and `course_agent_settings.jsonl` (Allow agent access and the license terms per course) and puts the agent files they refer to under `uploads/`. A 1.1.0 reader accepts a 1.0.0 archive without those three files and treats them as empty. On import, layer files are rewritten to the new storage keys, and each version snapshot is rebased: course id, lesson ids, storage keys, and the source URL (`APP_URL/c/{new slug}/classroom/{course slug}`) change, and `contentSha256` and the version `checksum` are recomputed. Version numbers, changelogs, licenses, and dates stay. A layer or version whose lesson or files are not in the archive is skipped and listed in the import summary. Course delegations (`course_delegations`) and agent results (`agent_submissions`) are not exported: they are personal grants tied to agent identities and API tokens, which the archive does not carry either.

Version 1.2.0 adds `scheduledAt` to `posts.jsonl` and exports scheduled posts, which 1.1.0 left out. A scheduled post is imported with the same publish time and stays hidden until the worker publishes it; a publish time that has already passed is published on the worker's next run. A 1.2.0 reader treats a missing `scheduledAt` (1.0.0 and 1.1.0 archives) as `null`.

Version 1.3.0 adds `community_gallery.jsonl` and `detailedDescription` on the community line, for the About page of Step 17, and puts gallery images under `uploads/`. A 1.3.0 reader treats a missing gallery file and a missing `detailedDescription` (1.0.0 to 1.2.0 archives) as empty. On import the detailed description goes through the same content parser as new writes (mentions become plain text, images are refused), gallery image keys are rewritten to the new community, a video is kept only when its URL is a normalized embed URL of an allowed provider, items beyond 10 are skipped, and positions are renumbered from 0. Anything skipped is listed in the import summary. Video posters (`thumbnail_url`, migration 0028) are not part of the archive: after an import YouTube posters are rebuilt from the video id, and Vimeo and Loom videos show a provider tile until they are added again.

Version 1.4.0 (Step 17, 0.10.0) adds `reviews.jsonl`, `review_replies.jsonl`, and `reviewsEnabled` on the community line. A 1.4.0 reader accepts older archives without those files and treats a missing `reviewsEnabled` as `false`.

Version 1.5.0 adds copies for people who leave Cohory or open the archive without it: `README.txt`, which explains each file, and `spreadsheets/members.csv` (email, name, username, role, status, join date), `spreadsheets/posts.csv`, and `spreadsheets/comments.csv` (posts and comments that were not deleted, as plain text, with author and category or post). The CSV files are UTF-8 with a byte order mark and RFC 4180 quoting, and a field that starts with a spreadsheet formula character gets an apostrophe in front. Erased people have an empty email. All four files are listed in the manifest with checksums. A reader checks them like any other file and imports nothing from them; the `data/` files stay the source. A 1.5.0 reader accepts older archives without them.

Version 1.6.0 adds `pointsForLessons` and `pointsForEvents` on the community line and `requiredLevel` on course lines ([0045](../decisions/0045-levels-that-unlock-and-learning-points.md)). A 1.6.0 reader treats missing values (older archives) as `false` and `null`.

## 3. manifest.json

| Field | Type | Meaning |
|-------|------|---------|
| `format` | `"cohory-archive"` | Fixed marker |
| `schemaVersion` | string | Format version, `"1.6.0"` (readers also accept `"1.0.0"` to `"1.5.0"`) |
| `cohoryVersion` | string | Release that wrote the archive, for example `"0.2.0"` |
| `edition` | `"community"` or `"cloud"` | Edition of the exporting instance |
| `exportedAt` | timestamp | When the export finished reading the database |
| `community` | object | `id`, `slug`, and `name` of the exported community |
| `counts` | object | Number of lines in each data file, keyed by entity name (`posts`, `comments`, and so on) |
| `uploads` | object | `count` and `bytes` of the files in `uploads/` |
| `missingUploads` | string array | Storage keys referenced by the data that the exporter could not read; the importer reports them as skipped |
| `files` | array | One entry per file in the zip other than the manifest: `path`, `bytes`, and `sha256` (lowercase hex) |

The importer recomputes every checksum and refuses the archive with `checksum_mismatch` if one differs, a listed file is missing, or the zip holds a file the manifest does not list.

## 4. Entities

Each table below lists the fields of one line. Fields marked "nullable" are present with the value `null` when empty.

### 4.1 Community and people

| File | Fields |
|------|--------|
| `community.jsonl` (one line) | `id`, `slug`, `name`, `description` (nullable), `privacy` (`private` or `public`), `joinMode` (`open`, `approval`, `invite`), `joinQuestions` (array of `{text, required}`, nullable), `appearance` (`accent`, `logoKey`, `coverKey`, `font`, `cardStyle`, `theme`, all optional), `gamificationEnabled`, `reviewsEnabled` (1.4.0, optional), `pointsForLessons` and `pointsForEvents` (1.6.0, optional), `levelNames` (9 strings), `detailedDescription` (1.3.0, content document without images, nullable), `archivedAt` (nullable), `createdAt` |
| `community_gallery.jsonl` (1.3.0) | `id`, `kind` (`image` or `video_embed`), `storageKey` (images, nullable), `embedUrl` (normalized YouTube, Vimeo, or Loom embed URL, nullable), `position`, `altText` (nullable), `createdAt` |
| `users.jsonl` | `id`, `email`, `name`, `username` (nullable), `emailVerified`, `erased` (true for an account erased under account deletion; its email is a placeholder), `createdAt` |
| `memberships.jsonl` | `id`, `userId`, `role` (`owner`, `admin`, `moderator`, `member`), `status` (`pending`, `active`, `removed`, `banned`), `bio`, `joinAnswers`, `bannedEmail`, `joinedAt`, `lastSeenAt` (nullable), `createdAt` |
| `membership_requests.jsonl` | `id`, `userId`, `status` (`pending`, `approved`, `declined`), `answers` (array of `{question, answer}`), `decisionNote`, `decidedBy`, `decidedAt` (nullable), `createdAt` |
| `invite_links.jsonl` | `id`, `token`, `createdBy`, `expiresAt`, `maxUses` (nullable), `useCount`, `requiresApproval`, `revokedAt` (nullable), `createdAt` |
| `audit_log.jsonl` | `id`, `actorId` (nullable), `action`, `target` (nullable), `metadata` (object, nullable), `createdAt` |

`users.jsonl` holds only people the community data refers to: members, authors, people who reacted, RSVP'd, or appear in the ledger, and actors in the audit log. It never contains password hashes, sessions, OAuth tokens, or avatars.

### 4.2 Feed

| File | Fields |
|------|--------|
| `categories.jsonl` | `id`, `name`, `slug`, `color`, `position`, `staffOnly`, `createdAt` |
| `posts.jsonl` | `id`, `authorId`, `categoryId`, `title` (nullable), `body` (content document, ADR 0012), `pinnedAt`, `scheduledAt` (1.2.0, nullable: the publish time of a post that is not published yet), `editedAt`, `deletedAt`, `deletedBy` (nullable), `lastActivityAt`, `createdAt`, `updatedAt` |
| `post_images.jsonl` | `id`, `postId`, `storageKey`, `width`, `height` (nullable), `position` |
| `comments.jsonl` | `id`, `postId`, `parentId` (nullable), `authorId`, `body`, `editedAt`, `deletedAt`, `deletedBy` (nullable), `createdAt`, `updatedAt` |
| `reactions.jsonl` | `id`, `userId`, `subjectType` (`post` or `comment`), `subjectId`, `subjectAuthorId`, `kind` (`like`), `createdAt` |

Post and comment bodies are the structured content document from [ADR 0012](../decisions/0012-post-content-format.md), never HTML. Rendered HTML, plain text, excerpts, search vectors, and like and comment counts are derived data and are not exported; the importer rebuilds them.

### 4.3 Classroom

| File | Fields |
|------|--------|
| `courses.jsonl` | `id`, `slug`, `title`, `description`, `coverKey` (nullable), `status` (`draft`, `published`, `archived`), `position`, `access`, `requiredLevel` (1.6.0, 1 to 9, nullable, optional), `createdAt`, `updatedAt` |
| `course_modules.jsonl` | `id`, `courseId`, `title`, `position` |
| `lessons.jsonl` | `id`, `courseId`, `moduleId`, `slug`, `title`, `bodyMarkdown`, `videoUrl` (nullable), `attachments` (array of `{key, name, size, contentType}`), `status` (`draft`, `published`), `position`, `createdAt`, `updatedAt` |
| `lesson_progress.jsonl` | `lessonId`, `courseId`, `userId`, `completedAt` (nullable), `lastViewedAt` |
| `lesson_agent_layers.jsonl` (1.1.0) | `lessonId`, `courseId`, `layer` (the agent lesson layer of [agent-course-format.md](agent-course-format.md) section 2), `updatedAt` |
| `course_agent_settings.jsonl` (1.1.0) | `courseId`, `allowAgentAccess`, `licenseId` (`personal_agents`, `team_agents`, `custom`), `licenseText` (nullable), `updatedAt` |
| `course_agent_versions.jsonl` (1.1.0) | `id`, `courseId`, `version`, `major`, `minor`, `patch`, `changelog`, `snapshot` (section 3.2 of the agent course format), `checksum`, `createdAt` |

Lesson bodies are Markdown. Course export as Markdown files with front matter (REQ-CRS-007) is served by this JSON form in 1.0.0: `bodyMarkdown` is the lesson file body and the remaining lesson fields are its front matter. A folder of `.md` files is planned for a later minor version.

### 4.4 Calendar

| File | Fields |
|------|--------|
| `events.jsonl` | `id`, `slug`, `title`, `description`, `startsAtLocal` (wall clock, no offset), `timeZone` (IANA name), `durationMinutes`, `recurrence` (`weekly`, nullable), `recurrenceUntil` (date, nullable), `location`, `recordingUrl` (nullable), `createdAt` |
| `event_occurrences.jsonl` | `id`, `eventId`, `startsAt`, `endsAt`, `canceledAt` (nullable) |
| `event_rsvps.jsonl` | `occurrenceId`, `userId`, `status` (`going` or `not_going`), `reminderSentAt` (nullable) |

### 4.5 Gamification

| File | Fields |
|------|--------|
| `points_ledger.jsonl` | `id`, `userId`, `delta`, `reason`, `sourceType`, `sourceId` (nullable), `occurredAt` |
| `member_stats.jsonl` | `userId`, `pointsTotal`, `level`, `updatedAt` |

The ledger is append only and `member_stats` is its current total. Both are exported so that points survive the move exactly, including resets.

### 4.5.1 Reviews (1.4.0)

| File | Fields |
|------|--------|
| `reviews.jsonl` | `id`, `authorId` (null when the account was erased and the review anonymized), `rating` (1 to 5), `body` (20 to 2000 characters), `editedAt`, `hiddenAt`, `hiddenReason` (`spam`, `abuse`, `personal_data`, `off_topic`, nullable), `hiddenBy`, `authorRemovedAt`, `anonymizedAt` (all nullable), `createdAt` |
| `review_replies.jsonl` | `id`, `reviewId`, `authorId` (nullable), `body` (1 to 2000 characters), `editedAt` (nullable), `createdAt` |

Reports on reviews are not exported, like content reports. The reviewer status ("Paying member for N months") is not stored: it is computed from subscriptions on the target instance, where imported subscriptions are comped access until they are linked again, so imported reviews show "Former member" until then. A review whose author is not in the archive, or who already reviewed the target community, is skipped and listed in the summary. A reply whose review was skipped is skipped too; a reply author who is not in the archive becomes the importing owner.

### 4.6 Payments summary

| File | Fields |
|------|--------|
| `membership_plans.jsonl` | `id`, `name`, `currency`, `monthlyPriceMinor`, `annualPriceMinor` (nullable), `providerProductId`, `providerMonthlyPriceId`, `providerAnnualPriceId` (nullable), `archivedAt` (nullable) |
| `subscriptions.jsonl` | `id`, `userId`, `planId` (nullable), `externalSubscriptionId`, `externalCustomerId`, `providerStatus`, `accessState` (`none`, `granted`, `grace`, `revoked`), `interval` (nullable), `currentPeriodEnd` (nullable), `cancelAtPeriodEnd`, `endedAt` (nullable), `origin` |
| `comped_memberships.jsonl` | `id`, `userId`, `grantedBy`, `note`, `expiresAt`, `endedAt`, `endReason`, `endedBy` (nullable), `createdAt` |

The payment files are a summary for moving paying members, not a financial record. The Stripe ids let the creator, and the subscription link step ([payments.md](payments.md) section 12.9), find the same customers and subscriptions in the creator's own Stripe account.

### 4.7 Uploads

`uploads/` holds every community file the data refers to, at its original storage key: the community logo and cover (`appearance.logoKey`, `appearance.coverKey`), gallery images (1.3.0), course covers, lesson attachments, and post images. A key such as `communities/<community id>/posts/abc.png` is stored at `uploads/communities/<community id>/posts/abc.png`. The importer rewrites the community id and any course id inside the key to the new ids and copies the bytes unchanged.

## 5. Import rules

The importer in `@cohory/migration` follows these rules. Another implementation should follow them too.

1. **Validate first.** Check the manifest, schema version, checksums, file list, line schemas, and size limits before writing anything. Zip entries outside the documented layout, absolute paths, and `..` segments are refused.
2. **New ids.** Every row gets a new UUIDv7. The importer keeps a mapping from archive id to new id per import job (`migration_id_map`), so a retry of the same job continues where it stopped instead of duplicating rows. Course, lesson, and event slugs go through the same `slugify` and `nextFreeSlug` as new ones (`packages/courses/src/slug.ts`, `packages/calendar/src/slug.ts`), so they are lower case letters, digits, and hyphens, never reserved words, and unique (lessons per course). A slug that is already in that form keeps it; any other gets the next free one, from the title when nothing is left. Every change is listed in the job summary as `renamedSlugs` (`entity`, `from`, `to`). Courses, lessons, and events have no slug redirects, and links inside imported content are not rewritten, so the summary is where the owner finds an old address that moved.
3. **People by email.** On Cloud every person except the importing owner becomes an unlinked placeholder ([0043](../decisions/0043-import-invitations-and-emails.md)): a new account with the archive name, the address `imported-{id}@import.invalid` that nobody can sign in with, and no username. Their membership, posts, comments, reviews, and other rows are attributed to the placeholder, so nobody is added to a community or shown as an author without acting themselves. A placeholder's membership is stored as `removed` (or `banned`), never `active`, so it holds no member slot and grants no access; `placeholder_member` in the id map records who was active at the source. The real address is kept only in the import's id map (`placeholder_email`), and each person can get a single use invite link (30 days) to join with their own account. On the Community Edition a user whose email already exists is linked to that account when it is the importing owner's own account or its email is confirmed; an account with an unconfirmed email becomes a placeholder as above, and anyone without an account gets a new account with no password and an unverified email. The preview counts as existing only the people who will be linked, and the summary counts placeholders as invited (`users.invited`), so on Cloud neither says whether an address has an account on the instance. Erased accounts become new erased placeholders named Former member.
4. **One owner.** The person importing stays the owner of the target community. The archive owner is linked as owner when it is the same email, otherwise imported as an admin.
5. **Dependency order.** Users, community settings, gallery, memberships, categories, posts, post images, comments, reactions, courses, modules, lessons, progress, events, occurrences, RSVPs, ledger, stats, comped access, invite links, join requests, reviews, review replies, audit log, uploads. Rows are written in batches of 500, each batch in one transaction with its id mapping rows.
6. **Content is data.** Post and comment bodies go through the same parser and renderer as new posts, so only allowlisted nodes, marks, links, and embeds survive. Mentions and image keys are rewritten to the new ids. HTML in the archive is never trusted because the archive contains none. Lesson Markdown is rendered by the classroom pipeline when read. Nothing in an archive is executed or followed as an instruction.
7. **Entitlements.** Comped access is restored as is. A subscription with access `granted` or `grace` becomes comped access with a note naming the Stripe subscription id, so the member keeps access without paying twice. It has no end date unless the subscription was set to cancel at the period end. Linking the real Stripe subscription replaces it ([payments.md](payments.md) section 12.9). Plans are not recreated, because a plan needs a connected payment account on the new instance; the import summary lists them.
8. **Invite links.** Tokens are kept so shared links keep working after a move. A token that already exists on the target instance gets a new token, and the summary says so.
9. **Emails.** The owner confirms the import with `emailChoice`: `now` emails people when the import finishes, `later` waits until the owner sends the emails from Import history, and `never` sends none (`notifyNewUsers: true` is the older spelling of `now`). Only people who were active members at the source get an email. A new account gets a direct link to choose a password (valid 7 days; a new link deletes the earlier ones) and a placeholder gets its invite link. The owner's optional note (up to 500 characters, links and addresses removed) is added as plain text. Each person is emailed at most once per import, recorded in the id map as `moved_email` or `moved_email_suppressed`; an address on the suppression list counts as not sent (`emailsNotSent`). The owner can resend one person's email from People. On Cloud one import emails at most as many people as the plan allows members (`emailsOverLimit` counts the rest), and a community sends at most 1,000 import emails per UTC day (`emailsByDay`); the rest go out the next day.
10. **Report, do not guess.** Anything skipped (an invalid body, a missing upload, a reference to a row that is not in the archive) is listed in the job summary with its entity, archive id, and reason.

## 6. What is excluded and why

| Data | Why it is not in the archive |
|------|------------------------------|
| Password hashes, sessions, OAuth accounts, verification tokens | Credentials must not leave the instance that issued them. Members set a password on the new instance. |
| Avatars | They belong to the account, not the community. Members upload them again. |
| Notifications, notification preferences, email deliveries | Per account and short lived. They start empty and fill again with new activity. |
| Payment connections, encrypted API keys, webhook secrets | Secrets are bound to the instance and its encryption key. The creator connects Stripe again. |
| Payments, invoices, fee ledger entries, provider events | Financial history stays with the platform that charged and with Stripe, which is the source of truth. |
| Content reports and review reports | They identify reporters, who were promised anonymity, and describe a moderation queue for the old instance. |
| Outbox rows, job queues, search vectors, rendered HTML, counts | Derived or operational data, rebuilt on import. |

## 7. Limits

| Limit | Default | Setting |
|-------|---------|---------|
| Archive size | 512 MiB | `MIGRATION_ARCHIVE_MAX_BYTES` |
| One upload inside the archive | `STORAGE_MAX_UPLOAD_BYTES` (25 MiB when unset; `.env.example` sets 10 MB) | same as uploads |

Stored files do not stay forever. An export is deleted 30 days after it finishes (the owner can delete it sooner), and an uploaded archive or platform preview that is not confirmed is deleted after 7 days, together with its preview. A finished import deletes its upload at once. The worker job `migration.files-expiry` does this once a day. When an import succeeds, the worker job `migration.import-finished` emails the owner once with links to the import report and to Manage, Migration, and says whether the import emails went out. It also sends emails chosen for later, tells the owner when an import stops after its last retry, and emails the owner a download link when an export is ready or a note when it stops. A members spreadsheet import keeps only the counts of its preview once it succeeds, fails, or expires, so no emails stay in the history. The sweep also marks a job failed when it has been running for more than 6 hours, and a job whose file was deleted cannot be tried again.

Format 1.0.0 is assembled and read in memory by the worker, so the worker needs free memory of about twice the archive size. Larger communities should use the command line on the server (section 8). Streaming archives is planned for a later minor version and will not change the format.

## 8. Tools

| Tool | Use |
|------|-----|
| Manage, Migration | Owner exports, downloads, deletes exports, uploads, previews, discards or confirms an import into an empty community, and downloads the report of each import |
| `pnpm migration export --slug <slug> --out <file.zip>` | Command line export on the server, for self hosters |
| `pnpm migration import --file <file.zip> [--slug <slug>] [--owner-email <email>]` | Command line import that creates the community when the slug is free |

The commands are described in [../operations/offboarding.md](../operations/offboarding.md).

## Decisions and open questions

- **Confirmed** (gate): zip with manifest, JSON lines per entity, uploads folder, semver from 1.0.0, public format.
- **Recommendation:** subscriptions become comped access until the Stripe link step ([payments.md](payments.md) section 12.9) replaces them.
- **Recommendation:** invite link tokens are exported so shared links keep working after a move.
- **Recommendation:** content reports, payments history, and credentials are excluded (section 6).
- **Open question:** whether a later minor version should carry password hashes for same software moves, so members can keep their passwords.
