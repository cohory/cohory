# Load test

The k6 load test for the reference load in REQ-NFR-PERF-005, the numbers measured for 0.2.0 (2026-10-18), and the gap to the requirement.

The requirement: on the 2 vCPU, 4 GB reference deployment, with 5,000 members and 100 concurrent active users, API p95 latency stays under 300 ms for reads and 500 ms for writes (REQ-NFR-PERF-004 and REQ-NFR-PERF-005).

## What the test does

`scripts/load/run.sh` seeds the load into a running Compose stack that already has the dev seed, then runs `scripts/load/cohory.js` with the pinned image `grafana/k6:1.3.0` (`docker run --rm`) on the stack's Docker network, against `http://web:3000` directly (no proxy).

- Seed: 5,000 members of the seeded `cohory-creators` community (`load-0001@example.test` and so on, one shared password, credential accounts), 2,000 posts spread over the last 33 hours, then `analyze`. The 0.2.0 runs below used the older `cohory` seed community.
- Load: ramp to 100 virtual users in 30 seconds, hold for 3 minutes, ramp down in 10 seconds.
- Each virtual user signs in once as its own member, then loops: read the feed (`GET /posts`), read a published lesson, read the calendar (`GET /calendar/occurrences` for a 6 week range), and on every fifth loop create a post. It waits 1 second after each request, which makes about 100 requests per second in total.
- Thresholds: p95 under 300 ms for the three reads, under 500 ms for post create and sign in, and under 1% failed requests.

Run it yourself against a throwaway stack (never production: it writes 5,000 users). Use a `.env` copied from `.env.example` with `RATE_LIMIT_DISABLED=true` added, so the sign in limit does not refuse the virtual users. Node and `pnpm install` are needed on the host to hash the load password.

```sh
docker compose -p cohoryload up -d --build
DATABASE_URL=postgres://cohory:cohory@127.0.0.1:5433/cohory pnpm db:seed
COMPOSE_PROJECT_NAME=cohoryload APP_URL=http://localhost:3000 scripts/load/run.sh
docker compose -p cohoryload down -v --remove-orphans
```

Change the size with `MEMBERS`, `POSTS`, `VUS`, `DURATION`, and `THINK_SECONDS`. The k6 summary goes to `scripts/load/out` (ignored by git).

## Machine

Not the reference VPS (see [gates](#decisions-and-open-questions)): an Apple M1 laptop with 8 cores and 16 GB of RAM, Docker Desktop 28.3.3 with 8 CPUs and 7.7 GB for its VM, an image built from the 0.2.0 source, PostgreSQL 17, the base `docker-compose.yml` (no Caddy). Other Compose projects and builds ran on the same machine at the same time; the host load average was between 4 and 12 during the runs, so the numbers carry noise. Each run had 5,003 active members and between 2,000 and 6,200 posts in the community.

## Results

p95 (and median) in milliseconds, 100 virtual users, 3 minutes at full load. 0 failed requests in every run.

| Endpoint | Target p95 | Run 1, cold, unconstrained | Run 2, warm, unconstrained | Run 3, warm, 2 vCPU split |
|---|---|---|---|---|
| Feed read | 300 | 654 (39) | 110 (24) | 146 (24) |
| Lesson read | 300 | 676 (39) | 116 (22) | 148 (21) |
| Calendar read | 300 | 674 (36) | 105 (20) | 140 (19) |
| Post create | 500 | 791 (44) | 128 (28) | 177 (28) |
| Sign in | 500 | 119 (89) | 104 (87) | 162 (89) |
| Requests | | 17,561 | 19,546 | 19,438 |

- Run 1 was the first load on a freshly started stack, right after seeding, while the host load average was near 12. Medians were fine, but the tail was long on every endpoint at once, which points at the shared machine and a cold process (JIT, connection pool, PostgreSQL cache) rather than one slow query.
- Run 2 repeated it on the warm stack.
- Run 3 limited the containers with `docker update` to a split of 2 vCPU: web 1 CPU and 1 GB, PostgreSQL 0.75 CPU and 1 GB, worker 0.25 CPU and 512 MB (the REQ-NFR-HOST-002 memory budget). Web used about 370 MB and PostgreSQL about 100 MB at the end.
- A 60 second run between runs 1 and 2 had p95 between 79 and 103 ms, with web at about 40% and PostgreSQL at about 48% of one CPU.

No N+1 query or missing index showed: medians stayed between 19 and 28 ms for every endpoint in every run, and the feed, lesson, and calendar tails moved together. Nothing was tuned.

## Gap to the requirement

- Warm, the targets are met with room to spare, also inside a 2 vCPU split: worst read p95 148 ms against 300, post create 177 ms against 500.
- Cold, right after a start under a loaded host, the first 3 minutes missed every read target by about 2 times. Restarts and deploys will see a short window of slower responses until the process warms up.
- This is not the reference deployment. CPU quotas on an M1 are not 2 shared vCPU on a VPS, and Docker Desktop adds a VM. The requirement stays **to be confirmed** on a real 2 vCPU, 4 GB VPS with the production overlay (Caddy adds TLS and a hop). The capacity in REQ-NFR-PERF-005 is kept as is until then.
- Not covered: page loads and server rendering (only the API was measured), media uploads, comments, likes, notifications, and the worker under load.

## Decisions and open questions

- **Recommendation:** keep REQ-NFR-PERF-005 as written; the warm runs meet it on this machine.
- **Open question:** rerun on a 2 vCPU, 4 GB VPS with the production overlay. This is a human gate: it needs a VPS with a public domain.
- **Open question:** whether the cold start tail needs a warm up step after deploys.
