# Importing from Circle

What the Circle importer reads, what it brings into a Cohory community, and what stays behind (REQ-MIG-004).

Importer `circle`, version 1.0.0. **Best effort, versioned, no promise:** Circle describes its export files but not their exact column names, so this importer matches the columns described below as they were documented on 2026-10-18. If Circle changes its export, rows can be skipped or columns ignored; the preview tells you before anything changes. This page is also published in the app at `/importers/circle`.

## 1. What Circle exports

- **Community data export (official).** An admin asks Circle support for an export of the community. It contains four CSV files: Members, Spaces, Posts, and Comments. Circle states that the Posts and Comments files do not include uploaded media.
- **Members CSV (official).** Admins can also export members from Audience, Manage audience, More, Export CSV. Circle emails the file. It has the member UID, first and last name, email, join date and active status, tags, profile and avatar URLs, activity counts, profile fields, last active date, email marketing preference, whether the person is a member, invitation status, and an activity score.
- **Admin API (official).** Business plans and above have an Admin API (v2) with posts, comments, members, and spaces. The importer accepts posts and comments saved from it as JSON (section 3).
- **No course export.** Neither the data export nor the members CSV contains courses, lessons, or progress.

## 2. What Cohory imports

| Circle data | Cohory result |
|---|---|
| Members with name, email, join date, last active date | On Cloud, an invitation to join with their own account; their history is kept under their name until then ([0043](../../decisions/0043-import-invitations-and-emails.md)). On the Community Edition, accounts (new ones without a password, linked by email when the person already has a confirmed account) and active memberships |
| Headline or bio | Membership bio |
| Admin or moderator, when the file says so | Admin or moderator; everyone else is a member |
| Spaces | Categories (up to 10 in the community, posts in extra spaces have no category) |
| Posts with title and HTML body | Posts, with HTML turned into Cohory's post format |
| Comments and replies | Comments; replies to replies are attached to the top comment, because Cohory threads are one level deep |

The import runs through the same pipeline as a Cohory archive import: you see a preview with counts and warnings, nothing changes until you confirm, and it works on a new, empty community only.

## 3. Field mapping

Column names are matched without case, spaces, or punctuation, so `First name`, `first_name`, and `FirstName` are the same column. Where Circle's column name is not documented, the importer accepts the listed alternatives.

### Members CSV

| Circle column | Cohory field | Notes |
|---|---|---|
| `UID`, `ID`, `Member ID`, or `Community member ID` | used to connect posts and comments | Optional |
| `First name` and `Last name`, or `Name` | user name | A row without a name uses the part of the email before `@` |
| `Email` | user email | Required; rows with a missing, invalid, or repeated email are skipped |
| `Join date`, `Joined at`, `Date joined`, or `Created at` | membership joined at | Read as UTC; a date that does not exist is unreadable, uses the import time, and is reported. Dates written with slashes are read month first unless a value in the file has a first part over 12, then the whole file is read day first; the preview says which |
| `Last active`, `Last active at`, or `Last seen at` | membership last seen | |
| `Headline` or `Bio` | membership bio | Up to 500 characters |
| `Member` | | Rows with `No` (people who were invited but never joined) are skipped |
| `Role`, `Admin`, or `Moderator` | membership role | `Role` values `admin`, `moderator`, `member`; `Admin` or `Moderator` set to yes or true |
| `Profile URL` | used to connect posts and comments | Matched against an author's `profile_url` in Admin API JSON |
| `Tags`, avatar URLs, activity counts, `Activity score`, email marketing, invitation status and date, `Active` | not imported | Known Circle columns |
| any other column (custom profile fields) | not imported | Listed in the preview as an unknown column |

### Spaces CSV

| Circle column | Cohory field |
|---|---|
| `ID` | used to connect posts |
| `Name` | category name (cut at 40 characters) |
| `Slug`, privacy, visibility, post count | not imported |

### Posts CSV or JSON

| Circle column or field | Cohory field | Notes |
|---|---|---|
| `ID` | used to connect comments | |
| `Space ID`, or `Space name` | category | Through the Spaces file when present |
| `Title` or `Name` | post title | Cut at 120 characters |
| `Body`, `Body html`, `Content`, or `HTML` | post body | Read as HTML; sanitized (section 6) |
| `Author email`, `User email`, or `Member email` | post author | Matched to a member by email |
| `Author ID`, `User ID`, or `Community member ID` | post author | Matched by the member UID |
| `Author name`, `User name`, or `Member name` | post author | Matched by name when nothing else matches and only one member has that name. When two or more members share it, the preview lists them and you choose who wrote the posts |
| `Created at`, `Updated at` | dates | |
| `Pinned` | pinned | Up to 3, the newest ones |
| `Slug`, comment and like counts | not imported | |

A JSON file is an array of Admin API post records, or an object with a `records` or `posts` array. A `body` that is an object uses its `body` or `html` field.

### Comments CSV or JSON

| Circle column or field | Cohory field |
|---|---|
| `ID` | used to connect replies |
| `Post ID` | the post |
| `Parent comment ID` or `Parent ID` | the comment it replies to |
| `Body` (same alternatives as posts) | comment body |
| author columns as for posts | comment author |
| `Created at`, `Updated at` | dates |

## 4. What does not transfer

- Payments, payment methods, and subscriptions, including the paywall subscription and transaction exports. Members who paid on Circle join as regular members; set up plans and invite them to subscribe, or link existing Stripe subscriptions when the Stripe account is yours (see the Migration section).
- Likes by identity. The export has like counts, not who liked, so likes are not imported.
- Private messages, chat spaces, and notifications.
- Courses, lessons, and progress. Circle's exports do not include them. Recreate courses in Cohory.
- Uploaded media and video. Circle's Posts and Comments files leave uploaded media out, images in post bodies are not copied, and links to them are dropped. YouTube, Vimeo, Loom, and Wistia iframes become embeds.
- Events, event attendees, tags, custom profile fields, avatars, passwords, and space privacy settings.
- Posts by people who are not in the members CSV keep the author name with a former member marker, for example "Someone Who Left (former member)". No account to sign in to is created for them.

## 5. Preview and result

The preview and result work as for Skool ([skool.md](skool.md) section 5): files and what they were read as, an offer to read the files with the Skool importer when they look like a Skool export, people numbers that match the result, roles, how spaces map to categories, a sample post, a choice of member for shared author names, the date order, the email choice with a note, preview, and test, and a download of the rows to fix with their original columns and a reason. The import history, the report download, progress, discarding a preview, and the upload limits also work as for Skool.

## 6. Safety

Imported files are data. The importer never runs scripts or follows instructions found in them. HTML is parsed, not rendered: only paragraphs, line breaks, bold, italic, inline code, code blocks, lists, quotes, and links over http, https, or mailto survive, then every body goes through the same validation and rendering as a post written in Cohory. Scripts, styles, forms, event handlers, and other tags are removed with their content. Limits: up to 8 files and 25 MB per upload, 20,000 members, 20,000 posts, and 100,000 comments.

## 7. Sources

Read on 2026-10-18.

- Community data export with four CSV files and no uploaded media: <https://help.circle.so/p/administration/analytics/export-your-community-data>
- Members CSV steps and columns: <https://help.circle.so/c/data-analytics/how-do-i-export-a-csv-of-my-members>
- Members CSV announcement: <https://community.circle.so/c/product-updates/export-a-csv-of-your-members>
- Paywall subscription and transaction exports: <https://help.circle.so/c/paywall-management/export-member-subscriptions-and-transactions-data>
- Admin API, pagination, and plans: <https://api.circle.so/> and <https://api.circle.so/apis/admin-api.md>
- A third party exporter that writes members, posts, comments, and lessons files: <https://apify.com/utopianvision/circle-community-exporter>

## Decisions and open questions

- **Recommendation:** courses are not imported because no official Circle export contains them.
- **Recommendation:** authors who are not in the members CSV keep their posts under their own name marked as former member.
- **Open question:** exact column names of the support data export; the importer reports every column it does not know so the alternatives can be extended in a new version.
