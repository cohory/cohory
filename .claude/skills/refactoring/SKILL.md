---
name: refactoring
description: Use when making a behavior-preserving change to code structure, such as a rename, extract, inline, dedupe, move between packages, or API reshape, or when asked to "clean this up", "restructure", or "simplify" without changing behavior.
---

# Refactoring

You own the contract. The structure changes. The behavior does not.

If the cleanup reveals a missing feature or a real bug, split it out and ship the structural change first against the pinned behavior. A redesign is allowed, but name it and treat it as a feature. Large or cross-cutting reshapes belong to `superpowers:writing-plans` and `autonomous-run`. This skill covers focused to medium changes.

## Steps

1. **Pin the behavior first.** Run `how` over the affected code to learn its contract. Then write characterization tests, a snapshot, or an equivalence script that captures current behavior before anything moves. If the area has no coverage, write the pin before touching structure. Typecheck and lint are not a pin.
2. **Name the missing structure.** Per the model-the-domain principle, what union, table, state machine, or module boundary is the code missing? Boring code stays boring when its shape is already clear and local. The reshape must delete branches or invalid states, not add indirection.
3. **Name the target shape.** What would the module layout, types, and call graph be if built today? If it crosses a package or function boundary, run `architect` first.
4. **Subtract before you add.** Delete dead code, collapse one-caller wrappers, drop redundant validators, remove orphan exports. Ship the smallest change that reaches the target. Revert speculative cleanup.
5. **Move in small steps, each keeping the pin green.** For API reshapes, migrate every caller and delete the old API in the same change. No compatibility shims, no parallel old and new paths. After every rename, Grep for the old name in strings, docs, tests, and config, since renames silently miss those. For mechanical edits across many files, write a codemod or script (build the lever) instead of editing by hand.
6. **Prove behavior is unchanged** on the real artifact, not "it compiles". Run the pin. For larger reshapes, also run the app path that exercises the code.
7. **Confirm it is worth keeping.** The success measure is lower reader load. If the diff does not make something easier to trace, revert it.
8. **Shape the commits.** A subtraction commit, then the reshape, then follow-on cleanup, each green on its own. Then follow `opening-a-pr`.

## Reply

The structure that changed, the pin it was held against, the equivalence proof, the reader-load improvement, what shipped and what got reverted. No new behavior.
