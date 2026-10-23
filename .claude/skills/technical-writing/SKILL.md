---
name: technical-writing
description: Use when writing or reviewing docs, READMEs, ADRs, files in docs/, AGENTS.md, PR descriptions, commit messages, issue bodies, changelogs, or SKILL.md files for Cohory, or when asked to "unslop", "tighten", or "clean up" prose.
---

# Technical writing

Write so a tired engineer understands on the first read. This skill covers structure, sentences, and the removal of AI writing tells. The tell catalog lives in `references/slop-patterns.md`. Apply it to every piece of prose, including your own replies.

## Rules above all others

- Cut every word that does no work. "In order to" is "to". "It is important to note that" is nothing.
- Use the short, everyday word. "Use", not "utilize". "Help", not "facilitate".
- Write the real symbol, file, command, or flag name, not a synonym.
- Do not invent jargon. Use the words a developer would say out loud.
- If a rule makes a sentence worse, fix the sentence another way.

## Cohory house rules

- Never use dashes as punctuation (no em dash, no en dash, no spaced hyphen). Use a period, a comma, or parentheses instead.
- No emojis.
- Sentence-case headings.
- Straight quotes.
- Never mention AI assistants in PR descriptions, PR comments, issue comments, or commit messages. No `Co-Authored-By` trailers.

## Pick the mode first

One document, one mode (Diátaxis).

- **Tutorial.** Learning by doing. Every step produces a visible result. Tell the reader what they should see.
- **How-to.** Steps to a goal for a competent reader. Name it by the task ("How to connect a Stripe account"). No background.
- **Reference.** Facts for lookup. Dry, complete, mirrors the structure of the thing described. Generate from code where possible.
- **Explanation.** Understanding and why. Design decisions, history, constraints, alternatives. Opinion belongs here and nowhere else.

Do not mix modes. Split and link instead. In Cohory, `docs/architecture/*.md` is explanation, setup guides are how-to, and API or schema docs are reference.

## Sentences

- Address the reader as "you", present tense.
- Name the actor: "the webhook handler retries", not "it is retried".
- Instructions are commands: "Run `pnpm db:migrate`." Put the condition first: "To reset the database, run ...".
- Common case first, exceptions after.
- No "simply", "easy", "just", or "quickly" in a procedure.
- Headings carry the point ("Validate input at the boundary", not "Validation").
- Numbered lists for sequences, bullets otherwise. Introduce a list with a full sentence. Keep items parallel.
- Code in code font. UI labels in bold. Serial commas.
- One instruction per sentence. Split instructions longer than about 20 words.
- Make every "it", "this", and "they" point at one obvious thing. Repeat the noun when in doubt.
- No slashes for "and or". Write "a, b, or both".
- Call each thing by one name everywhere.

## Rhythm

Mix sentence lengths. Short sentences land a point. Longer ones carry a fact with its condition. Be specific: not "schema changes can cause issues" but "renaming a column breaks the raw SQL in `leaderboard.ts`".

## Commit messages and PR bodies

These are writing too. Apply every rule except Diátaxis. See `opening-a-pr` for the structure.

## SKILL.md files

Frontmatter `name` matches the folder. `description` is one line that starts with "Use when" and lists concrete triggers. Body under about 150 lines. Long reference material goes in `references/`. See `superpowers:writing-skills` for the testing loop.

## Worked example

Before:

> Configuration of the leaderboard caching layer is performed via the env file. It's important to note that the TTL, which controls how long entries are cached, should only be lowered when necessary, otherwise performance could potentially be impacted.

After:

> `LEADERBOARD_CACHE_TTL` in `.env` sets how long leaderboard entries stay cached, in seconds. Lowering it increases database reads on every page view of the leaderboard.
