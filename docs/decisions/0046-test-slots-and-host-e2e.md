# 0046. A machine wide test slot pool, host e2e for the inner loop, and a development mode stack

Heavy test commands share one pool of test slots per machine. The end to end specs a change touches run on the host against the cached build, and the Docker image suite stays the gate before landing.

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: coordinator as product owner under the founder's mandate (founder, 2026-10-22: parallel test runs overload the machine)
- Related: [../open-source/local-workflow.md](../open-source/local-workflow.md), [../open-source/testing.md](../open-source/testing.md), AGENTS.md section 11

## Context

On 2026-10-22 the load average on the founder's 16 GB, 8 core laptop reached 71 to 86, swap was nearly full, and Docker Desktop crashed in buildkit. Two `verify:changed` runs, a full e2e run (three production Next.js servers in the 8 GB Docker VM, Playwright with 3 workers), and a disk scan ran at once. Only e2e and integration runs took machine wide locks; typecheck, lint, and unit runs took none. Every landing built Next.js twice: once on the host in `pnpm verify`, then again in the e2e image, whose hash covers all of `apps/` and `packages/`.

## Decision

1. **Test slots.** `scripts/lib/slots.sh` keeps one pool of `COHORY_TEST_SLOTS` slots (default 2) in `/tmp/cohory-slots`, shared by every checkout and worktree. Slots are directories made with `mkdir`, which is atomic on macOS and Linux and needs no dependency. `pnpm verify`, `pnpm verify:changed`, and `pnpm test:integration:local` take one slot; `pnpm e2e`, `pnpm e2e:host`, and `scripts/upgrade-check.sh` take all of them. Waiters queue in arrival order, so an e2e run is not starved by single slot runs, and a waiting run prints one line naming the holders. A slot or queue entry whose process is gone is removed by the next waiter. A script started by a holder inherits its slots. The slots replace the old e2e lock; the integration lock stays, because it protects cluster wide roles, not CPU.
2. **Host e2e.** `pnpm e2e:host <specs>` runs the Playwright specs against `next start` from the turbo cached build, the worker bundle, and the fake Stripe, fake Polar, and webhook receiver as Node processes, with a fresh database on the shared test services stack. It uses 2 Playwright workers and the desktop project unless asked otherwise. It is the e2e step of the inner loop.
3. **The image suite stays the gate.** `pnpm e2e` is unchanged and still runs before landing a batch and for releases, because only it proves the production image.
4. **Development mode stack.** `pnpm stack:dev` runs `next dev` and the worker with `--watch` against the Compose Postgres and Mailpit, so daily use does not need an image rebuild. The production image stays for release checks and self hosting.

## Alternatives considered

- **`flock`.** Not on macOS by default.
- **A Node helper for the pool.** Works, but every entry point is a shell script, and `mkdir` locks already serve the integration lock.
- **One slot for everything.** Safe, but it serialises two light verify runs that the machine carries well.
- **Running host e2e against `next dev`.** Compiles on demand, so the first request to each page is slow and timings differ from production; `next start` reuses the build `pnpm verify` already made.
- **More resources for Docker Desktop, OrbStack, Colima, or a remote Docker host.** Founder calls about the machine, left open.

## Consequences

- At most two heavy runs at once, or one e2e run alone, on any machine with the default pool.
- A change is checked in the inner loop without building the image; the image is built only before landing.
- Host e2e differs from the image in the operating system and the Node binary, so a failure that only the image shows is caught later, at `pnpm e2e`.
- Specs read the webhook receiver address the app should use from `E2E_WEBHOOK_RECEIVER_APP_URL` and worker logs from `E2E_LOG_DIR` when set.
