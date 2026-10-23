---
name: benchmark-checklist
description: Use when you ran a benchmark, measured page load, query time, or bundle size, or are about to report a speedup, slowdown, or regression in a PR, issue, or reply. Vets the number before anyone acts on it.
---

# Benchmark checklist

Answer each question with evidence from a run, not a guess from reading code. For a quick ballpark the human asked for, one run is enough, but still check questions 4 and 7 and say it was one run. A choice between options is never a ballpark.

## Before you run

- Write the claim you expect to make, in the words you would ship ("the feed query is 30 percent faster at p50 for a community with 10k posts"). The questions test that sentence.
- Read the measurement script. Note what it times, counts, and ignores.
- Check machine load (`uptime`). If it is busy, interleave the sides so both see the same noise, and say so.

## Questions

1. **Why not double?** Name the limiter. Profile in a run you do not report (`node --cpu-prof`, Chrome DevTools performance panel, `EXPLAIN (ANALYZE, BUFFERS)` for Postgres). If the load generator saturates first, you measured the load generator.
2. **Was it tuned?** Run both sides the way production does: `next build && next start`, not `next dev`. Production env, the same Postgres indexes, connection pooling, and warm or cold caches as production sees them. If one side runs on defaults, you compared configurations.
3. **Did it break limits?** Do the arithmetic. Removing a piece that takes 10 percent of the run makes it at most about 11 percent faster. A result past a limit measured a cache, a no-op, or a bug.
4. **Did it error?** Count failures and non-200 responses, and check outputs are correct. Errors are often fast.
5. **Does it reproduce?** At least five runs per side, alternating A, B, A, B. Report the median and range. A gap smaller than the run-to-run spread is no measurable difference.
6. **Does it matter?** Measure the end-to-end path a user waits on (Time to First Byte, Largest Contentful Paint, total request time) with realistic data sizes. Report a micro result as its share of the whole.
7. **Did it even happen?** Confirm the work ran inside the timed region: the query hit the database, the rows were written, the promise was awaited, the cache was not serving the result.

## Report

- Lead with the verdict: faster, slower, no measurable difference, or inconclusive.
- Give the number with its unit, the run count, the range, and the limiter. Example: "p50 41 ms to 33 ms, median of 7 runs per side, range 32 to 35 ms after, bound by JSON serialization of the post list."
- Call it inconclusive if you cannot name the limiter, a side ran untuned, or you could not check questions 4 and 7.
- In a PR body, give one primary number. Put runs and evidence in a linked file.
