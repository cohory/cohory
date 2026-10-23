# Rationale template

One page. Sentence-case headings. Replace the notes with content.

## Problem

One paragraph. What we are doing, and what about the existing system makes the shape non-obvious. Name constraints from grounding: types to interoperate with, callers we cannot break, invariants.

## Usage (caller's view)

Written first. Two or three realistic call sites: what they import, what they call, what comes back. The shape below is derived from this.

## Shape

Data structures first, then how data flows through the signatures. Name load-bearing decisions, which invariants live in types, where validation lives, and what the system deliberately does not do. State what complexity the public API hides. Cite the principle behind each decision by name.

## Pick

Which candidate became the base and why, what was grafted from the others, what was rejected.

## Tradeoffs accepted

One bullet each, in the form "we accept X in exchange for Y".

## Alternatives considered

At least one concrete alternative shape with one line on why it lost. Judge on interface depth, not only implementation simplicity.

## Open questions and risks

Phrased as questions for the human.

## Next implementation step

One sentence.
