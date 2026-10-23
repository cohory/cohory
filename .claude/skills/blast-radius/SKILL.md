---
name: blast-radius
description: Use when asked "what could this break", "blast radius of X", before merging a small diff you do not fully trust, or before changing a shared type, Drizzle schema, auth check, payment path, or package export. Finds breakage beyond the diff and proves the key safety fact by running code.
---

# Blast radius

Find what a change breaks somewhere else before it ships. Listing callers is not the job, since Grep does that in a second. The job is the breakage Grep will not show you.

`how` explains what the code does. `why` explains why it is shaped that way. Blast radius explains what it breaks elsewhere.

## Do not trust your own writeup

A writeup that sounds right reads as convincing whether or not it is true. Find the one or two facts the change's safety depends on and push each as far down this ladder as is cheap. Say where it stopped.

1. You said so. Worthless alone.
2. You pointed at the line. A real `file:line`, or the library's source in `node_modules`.
3. You walked the failure path step by step and showed it cannot be reached.
4. You ran it. A script or test that calls the real code and fails loudly if you are wrong.
5. You reproduced it in the running app.

Step 4 is usually one small script (for example `pnpm tsx scripts/check-<slug>.ts` or a focused Vitest case) that imports the real module and calls the function you are worried about.

## Steps

1. **Read the change.** The diff, the symbols it adds, changes, and deletes, and what it now does differently, including what the diff does not spell out.
2. **Find the one fact it is safe because of.** Most risky-looking changes are safe because of a single fact, such as "this column is only read by the admin dashboard". If that fact holds, most risks clear at once. Spend your time here.
3. **Look where Grep stops.**
   - Data: Drizzle migrations against existing rows, nullable to non-null changes, renamed columns that raw SQL still names, enum values stored in the database.
   - Wire formats: JSON returned by route handlers, server action return shapes cached on the client, Stripe webhook payload fields, job payloads already queued (pg-boss by default, BullMQ when Redis is enabled).
   - Runtime: server versus client component boundaries, caching and revalidation in Next.js, middleware order, edge versus node runtimes.
   - Auth and tenancy: every path that reaches the changed data, and whether each still checks session, role, and community scope.
   - Dependencies: the pinned version in `pnpm-lock.yaml` and any patch in `patches/`.
   - Packages: every workspace package that imports the changed export (`pnpm why`, Grep across `apps/` and `packages/`).
4. **Be honest about each risk.** Give a real likelihood and cost. Keep confirmed risks. List checked and cleared items separately.
5. **Prove the one fact.** Write the script or test, run it, and paste the output.
6. **For a wide change, get a second opinion.** Spawn two independent `Agent` subagents with the same question and merge their answers. Different runs catch different bugs.

## Hand back

- **What it does.** Including the non-obvious part.
- **The fact it is safe because of.** Stated, with the ladder step reached and the proof, or marked unproven.
- **Risks.** How each breaks, `file:line`, likelihood and cost, how to check.
- **Cleared.** What you checked and why it is fine.
- **Before you merge.** The cheapest test or repro that would catch the real bug, including the script you wrote.
