# Release strategy

How Cohory will version, release, and support the Community Edition, and how security fixes ship.

Releases are tagged `vX.Y.Z`; the first tagged release was `v0.12.0`. The `Docker` workflow pushes its image to `ghcr.io/cohory/cohory`, a public package that anyone can pull. Everything here is a **Recommendation** unless marked otherwise.

## What gets released

| Artifact | Where | Versioned by |
|----------|-------|--------------|
| Application (web and worker, one image) | Container registry (GitHub Container Registry, Recommendation) | Repository version |
| Docker Compose file and self-hosting guide | Repository and release notes | Repository version |
| SDK and API client (`packages/sdk`) | npm | Own version, post-MVP |
| OpenAPI document | Repository and docs site | Repository version |

The Cloud Edition deploys from the same tagged releases. It may run a release candidate before it is tagged as stable, but it never runs code that will not be published.

## Semantic versioning

Versions follow [Semantic Versioning 2.0.0](https://semver.org/): `MAJOR.MINOR.PATCH`.

The public contract that semver protects:

- The REST API under `/api/v1` and the OpenAPI document
- Environment variables and configuration files used by self-hosters
- The Docker Compose service names, volumes, and upgrade path
- The export format
- The SDK and plugin hooks, once published

Internal package APIs inside the monorepo are not part of the contract.

## Pre-1.0 policy

- Versions start at `0.1.0`. The MVP release (end of roadmap phase 4) is planned as the first version recommended for real communities, not necessarily `1.0.0`.
- Before 1.0, a minor bump (`0.x.0`) may contain breaking changes. Each one is listed under "Breaking changes" in the release notes with upgrade steps.
- Patch releases (`0.x.y`) never contain breaking changes or migrations that cannot run online.
- Upgrades are supported from the previous minor only. Skipping minors means upgrading through each in turn.
- **Open question:** what must be true for 1.0 (for example, stable export format, one full migration importer, a published SDK).

## Release cadence

- Minor releases about every four weeks, when there is something worth releasing. No release just to keep a schedule.
- Patch releases as needed for bug fixes.
- Security releases outside the cadence (see below).
- Release candidates (`0.x.0-rc.1`) for any minor that contains migrations or payment changes, available for at least one week.

## Changelog

- Commits follow Conventional Commits (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).
- Today each PR that changes behavior adds one line to `CHANGELOG.md` under `## [Unreleased]` by hand. **Recommendation:** move to [Changesets](https://github.com/changesets/changesets) once releases are tagged, so the release PR merges per PR entries into `CHANGELOG.md`. Changesets is not set up yet; it works with pnpm workspaces and lets the SDK version independently later.
- Release notes group entries as Breaking changes, Features, Fixes, Security, and Upgrade notes. Upgrade notes include migration steps and any change to environment variables.
- Entries are written for creators and self-hosters, following [voice-and-tone](../brand/voice-and-tone.md).
- `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): an `## [Unreleased]` section at the top, then one `## [x.y.z] - YYYY-MM-DD` heading per release (that heading format is the only place a spaced hyphen is allowed in the docs). The history before 0.11.0 was folded into one 0.11.0 entry; the detail is in git. Link references at the end of the file point `[Unreleased]` at the compare view from the latest tag, the first tagged release at its tag, and every later release at the compare view from the previous tag.

## Docker image tagging

| Tag | Meaning |
|-----|---------|
| `0.4.2` | Exact release, never moved |
| `0.4` | Latest patch of that minor, moves with patches |
| `0` (and later `1`) | Latest release of that major, moves with minors |
| `latest` | Latest stable release |
| `0.5.0-rc.1` | Release candidate, never `latest` |
| `edge` | Built from `main`, not for production |
| `sha-<commit>` | Exact build of a commit |

`.github/workflows/docker.yml` produces these tags with `docker/metadata-action` when a `v*` tag or `main` is pushed, and pushes them to GitHub Container Registry under the repository name. Pull requests only build. Pushing the git tag is the human step that publishes; no agent or script tags.

Images pushed from `main` and tags are multi-architecture (amd64 and arm64); pull requests build amd64 only. **Recommendation:** sign images and publish an SBOM; the workflow does neither yet. The self-hosting guide tells people to pin an exact version or a minor tag, never `latest` or `edge`.

## Database migrations in releases

- Migrations are forward-only and run by the separate `migrations` service before the new app version starts (see [AGENTS.md](../../AGENTS.md#6-database-migration-rules)).
- Breaking schema changes use expand and contract across at least two minor releases, so a rollback of the app image to the previous minor keeps working.
- Release notes state when a release contains migrations and how long they are expected to take on a large community.

## Long-term support

**Open question:** whether to offer LTS releases. Recommendation: no LTS before 1.0. After 1.0, consider an LTS minor once a year, supported with security fixes for twelve months, if self-hosters ask for it and maintainers can sustain it.

## Deprecation policy

- A feature, API field, endpoint, or configuration option is deprecated in one minor release and removed no earlier than the next major (after 1.0) or two minors later (before 1.0).
- Deprecations are announced in the release notes and, for the API, with a `Deprecation` response header and a note in the OpenAPI document.
- Self-hosted installs log a warning at startup when they use a deprecated configuration option.
- Removing anything that affects export, payment continuation, or a creator's ability to leave needs a decision record.

## Security releases

- Fixes are prepared privately (GitHub security advisories) following [SECURITY.md](../../SECURITY.md).
- A security release is a patch on every supported line, published with an advisory and a CVE when appropriate.
- Self-hosters are told in the advisory what is affected, how to tell if they were exposed, and how to upgrade.
- Payment, tenant isolation, and authentication issues are fixed first.

## Who releases

The release manager role is described in [GOVERNANCE.md](../../GOVERNANCE.md). Releases, tags, and image publishing are irreversible actions: coding agents prepare release PRs but never tag or publish (see the `shipping` skill).

Before tagging, the release manager runs the `docs-audit` skill in `.claude/skills/docs-audit`. It checks every doc against the code, simplifies what drifted, and keeps release numbers out of the docs that would otherwise go stale with each tag.

## Decisions and open questions

- **Recommendation:** semver, four week minor cadence, release candidates for migrations and payments, Changesets, image tag scheme, deprecation windows.
- **Assumption:** GitHub Container Registry is acceptable as the image registry.
- **Open question:** criteria for 1.0.
- **Open question:** LTS releases after 1.0.
