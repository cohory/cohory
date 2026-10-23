# Review bot triage

Use this for automated review comments (Copilot, CodeRabbit, Bugbot, security scanners) and for human comments that read like suggestions. The goal is not to ignore bots. It is to stop treating every comment as a required change.

## Classify every thread

- `fix`. The comment identifies a plausible correctness, security, privacy, data loss, auth, billing, migration, idempotency, race, or user-facing behavior issue. Fix it in the lowest owning PR, reply with the commit SHA, resolve the thread.
- `dismiss`. The comment matches a documented low-risk pattern below, and the code proves no change is needed. Reply with the reason and resolve.
- `ask`. Novel, high severity, security or data related, or ambiguous. Ask the human instead of guessing.

When in doubt, ask. Skipping a noisy style comment is cheap. Skipping a real tenancy or payment bug is not.

## Pattern format

```markdown
### <short pattern name>

- Confidence: candidate | recurring | strong
- Skip when: <conditions that must all hold>
- Do not skip when: <risk boundaries>
- Example signal: <phrases or code context>
- Source: <PR or comment URL>
```

Use `candidate` for one or two examples, `recurring` after several verified dismissals, `strong` only for narrow, repeatedly verified, low-risk patterns.

## Known patterns

### Intentional visual change

- Confidence: candidate
- Skip when: the PR description or screenshots make the visual change explicit and the comment only restates that a shared visual default changed.
- Do not skip when: the comment points at accessibility, focus visibility, keyboard navigation, contrast, or a component API contract the PR did not mean to change.

### Usage the bot cannot see in a stack

- Confidence: candidate
- Skip when: the bot flags an export as unused and a later PR in the stack uses it, verified with `gh pr diff`.
- Do not skip when: the PR is not in a stack, the export is public package API, or the later use cannot be verified.

### Invariant enforced elsewhere

- Confidence: candidate
- Skip when: a shared component, framework contract, zod schema, or type already guarantees the concern, visible in the diff or nearby code.
- Do not skip when: the invariant is assumed but not enforced, depends on timing, or crosses an async or request boundary.
