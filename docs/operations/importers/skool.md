# Importing from Skool

What the Skool importer reads, what it brings into a cohory community, and what stays behind (REQ-MIG-004).

Status: Draft, 2026-10-18

Importer `skool`, version 1.0.0. **Best effort, versioned, no promise:** Skool does not publish a full export format, so this importer reads the files described below as they were documented on 2026-10-18. If Skool or a third party tool changes its output, rows can be skipped or columns ignored; the preview tells you before anything changes. This page is also published in the app at `/importers/skool`.

## 1. What Skool exports

- **Members CSV (official).** Owners and admins download the member list from the Members tab of the Skool admin panel with the Export button. The documented header is `FirstName, LastName, Email, Invited By, JoinedDate, Question1 to Question3, Answer1 to Answer3, Price, Recurring Interval, Tier, LTV`. Dates look like `2026-04-12 18:14:56`.
- **No official content export.** Skool has no export for posts, comments, or the classroom, and no public API.
- **Posts and comments JSON (third party).** Some creators run a scraper (for example the Apify actors listed in section 7) on their own community. These produce a JSON array of posts with a title, a body, the author, the category, the date, and optionally the comments. The importer accepts the common shape described in section 3.

## 2. What cohory imports

| Skool data | cohory result |
|---|---|
| Members with name, email, join date | On Cloud, an invitation to join with their own account; their history is kept under their name until then ([0043](../../decisions/0043-import-invitations-and-emails.md)). On the Community Edition, accounts (new ones without a password, linked by email when the person already has a confirmed account) and active memberships |
| Join question answers | Join answers on the membership, as `question: answer` |
| Points, or level when points are missing | Points total, with the level from cohory's thresholds |
| Role column, when present | Admin, moderator, or member; a Skool owner becomes an admin and you stay the owner |
| Post categories | Categories (up to 10 in the community, extra ones leave their posts without a category) |
| Posts with title and body | Posts, with markdown or HTML turned into cohory's post format |
| Comments and replies | Comments; replies to replies are attached to the top comment, because cohory threads are one level deep |
| Pinned posts | Pinned, up to 3 (the newest ones) |

The import runs through the same pipeline as a cohory archive import: you see a preview with counts and warnings, nothing changes until you confirm, and it works on a new, empty community only.

## 3. Field mapping

Column names are matched without case, spaces, or punctuation, so `JoinedDate`, `Joined date`, and `joined_date` are the same column.

### Members CSV

| Skool column | cohory field | Notes |
|---|---|---|
| `FirstName` and `LastName`, or `Name` | user name | Required: a row without a name uses the part of the email before `@` |
| `Email` | user email | Required; rows with a missing, invalid, or repeated email are skipped |
| `JoinedDate` (also `Joined`, `Join date`) | membership joined at | Read as UTC; a date that does not exist (such as `13/45/2025`) is unreadable, uses the import time, and is reported. Dates written with slashes are read month first unless a value in the file has a first part over 12, then the whole file is read day first; the preview says which |
| `Question1` to `Question3`, `Answer1` to `Answer3` | join answers | Only answered questions, up to 3 |
| `Points` | points total | Whole numbers from 0 |
| `Level` | points total at that level's threshold | Only when there is no `Points` column |
| `Role` | membership role | `admin`, `moderator`, `member`; `owner` becomes `admin`; anything else is `member` and reported |
| `Bio` | membership bio | Up to 500 characters |
| `Invited By`, `Price`, `Recurring Interval`, `Tier`, `LTV` | not imported | Payment and referral data do not transfer |
| any other column | not imported | Listed in the preview as an unknown column |

### Posts JSON

The file is a JSON array of posts, or an object with a `posts`, `items`, or `data` array. Field names are matched the same way as columns.

| Field | cohory field | Notes |
|---|---|---|
| `id` or `post_id` | used to connect comments | Optional |
| `title` or `name` | post title | Cut at 120 characters |
| `html`, `body_html`, or `content_html` | post body | Sanitized (section 6) |
| `content`, `body`, `text`, or `markdown` | post body | Read as markdown when there is no HTML field |
| `author` (object with `name`, `email`, `handle`), or `author_name`, `author_email`, `author_handle` | post author | Matched to a member by email, then by a name only one member has. When two or more members share the name, the preview lists them and you choose who wrote the posts |
| `category` or `category_name` | category | |
| `created_at`, `createdAt`, `posted_at`, or `date` | created at | |
| `pinned` or `is_pinned` | pinned | |
| `comments` | comments | Each with `id`, a body field as above, an author, `created_at`, and nested `replies` or `children` |
| `likes`, `comment_count`, `post_url`, `url` | not imported | Likes do not transfer |

### Comments JSON (optional)

A separate array of comments with the same fields as nested comments plus `post_id` or `post_url` pointing at a post in the posts file, and an optional `parent_id`.

## 4. What does not transfer

- Payments, payment methods, and subscriptions. Skool does not let anyone export payment methods. Price, tier, and lifetime value columns are read but ignored. Members who paid on Skool join as regular members; set up plans and invite them to subscribe (see [../offboarding.md](../offboarding.md) and the payment migration options in the Migration section).
- Likes by identity. Like counts in scraped files say how many, not who, so they are not imported. Points carry over as a total instead.
- Private messages and chat.
- The classroom: courses, modules, lessons, and progress. Skool has no classroom export, and the scraped shapes are not stable enough to import. Recreate courses in cohory.
- Video and files hosted on Skool or elsewhere. Images inside posts are not copied; links to them are dropped. YouTube, Vimeo, Loom, and Wistia links in iframes become embeds.
- Events and the calendar, avatars, passwords, notification settings, and member handles.
- Posts by people who are not in the members CSV keep the author name with a former member marker, for example "Someone Who Left (former member)". No account to sign in to is created for them.

## 5. Preview and result

Before you confirm, the preview shows:

- each file and what it was read as. When the files look like another platform's export, the preview offers to read the same files with that importer, and Import is off while most files are not Skool files.
- the people numbers: members, authors kept as former member, and on the Community Edition people linked by email, people kept apart until they accept an invitation, and new accounts. On Cloud the preview says that each person gets an invitation and nobody is added as a member until they accept. The result counts people the same way.
- **Email these people?** Email everyone now (when the import finishes), I will send emails later (the default), or Do not email. With an email choice you can add a note (plain text, up to 500 characters, links are removed), **Preview email**, and **Send me a test** to your own address. New accounts get a link to choose a password (7 days) and invited people get their invitation (30 days). Only active members are emailed, and each person at most once. On Cloud an import emails at most as many people as your plan allows members, and a community sends at most 1,000 import emails a day; the rest go out the next day. Invited people are not members until they accept, so they do not use member slots; People lists them under Removed.
- the roles: who becomes admin or moderator, with the role in the file when it differs (a Skool owner becomes an admin).
- the categories: each Skool category and whether it is merged into an existing category, becomes a new one, or is left out at the limit.
- a sample post, with its author and category.
- authors whose name more than one member has, each with a choice of member.
- whether dates were read day first or month first.
- warnings, columns left out, and rows left out with the reason. **Download rows to fix (CSV)** gives the left out rows with their original columns and a reason column, so you can fix and upload them again.

After the import, the result lists the rows left out by the files together with anything the import itself skipped, with one count and the same download. The result says how many emails were sent and how many were not because the address opted out or bounced. The import then appears under **Import history** on the Migration page with its date, counts, rows skipped, and emails sent. When you chose to send emails later, it shows **Send the emails** until you do. **Resend email** in People sends one person their email again, and **Download report** gives the same as a CSV (columns type, name, value, detail).

While the import runs, the card shows the step it is on with a count, how long it has run, and that you can close the page. **Choose other files** discards the preview and deletes the uploaded files; a preview you do not confirm is deleted after 7 days. Uploads larger than 25 MB together are stopped in the browser with the size and the limit, and when nothing in the files can be imported the error names each file and why (for example `posts.json is not valid JSON at line 2.`). Up to 50 previews an hour are allowed per owner (`RATE_LIMIT_MIGRATION_PREVIEWS`), and 10 confirmed imports (`RATE_LIMIT_MIGRATION_IMPORTS`); when a limit is reached the message says how long to wait.

The public page `/importers` lists every way to move in (Skool, Circle, a Cohory archive, a members spreadsheet) with a Start an import button that opens Create a community.

## 6. Safety

Imported files are data. The importer never runs scripts or follows instructions found in them. HTML is parsed, not rendered: only paragraphs, line breaks, bold, italic, inline code, code blocks, lists, quotes, and links over http, https, or mailto survive, then every body goes through the same validation and rendering as a post written in cohory. Scripts, styles, forms, event handlers, and other tags are removed with their content. Limits: up to 8 files and 25 MB per upload, 20,000 members, 20,000 posts, and 100,000 comments.

## 7. Sources

Read on 2026-10-18. None of these is a Skool publication; Skool's help center has no export article.

- Members CSV header and the admin Export button: <https://skool-api.cristiantala.com/recipes/export-skool-members-csv/>
- Member fields without an official export: <https://skool-api.cristiantala.com/automation/export-skool-members/>
- Posts and comments JSON from scrapers: <https://apify.com/scrapersdelight/skool-posts-scraper/examples/export-skool-posts-json> and <https://apify.com/goat255/skool-post-scraper>
- Payment methods do not move from Skool: [../../research/comparable-projects.md](../../research/comparable-projects.md)

## Decisions and open questions

- **Recommendation:** authors who are not in the members CSV keep their posts under their own name marked as former member rather than losing them or showing them as yours.
- **Recommendation:** Skool points are imported as they are; cohory levels come from cohory's thresholds, so a level can differ from Skool's.
- **Open question:** whether to accept a classroom JSON once a scraper shape proves stable.
