---
name: prototype
description: Use when a UI layout, interaction, density, or visual direction is undecided, when someone says "prototype", "mock it up", "try a few layouts", or "sketch it to decide", or when a behavioral or timing question could be settled by running something instead of asking the human.
---

# Prototype

A prototype is a throwaway instrument for making one decision cheaply. The real build follows the normal feature flow (`architect`, `superpowers:writing-plans`, `superpowers:test-driven-development`).

The usual rules invert here. Speed beats polish. No tests, no abstractions, no production framework unless the decision depends on it. The rigor is in picking the right design.

## Steps

1. **Name the decision.** Which layout, which interaction, which density, or which behavior. No decision means no prototype.
2. **Classify the question.** If the answer is something you can observe (timing, layout fit, output, whether a query is fast enough), it is not the human's question. Prototype it. Ask the human only about product or taste calls no experiment can settle, and bring the variants when you ask.
3. **Gather references when the space is open.** Note relevant patterns from Skool, Linear, Notion, and shadcn/ui examples. Skip when the direction is set.
4. **Build in a scratch location.** Use the session scratchpad or `prototypes/<slug>/` (never commit it to `apps/` or `packages/`). For a visual decision, plain HTML with Tailwind from a CDN, or a throwaway Next.js route under a clearly named scratch folder if the decision depends on real shadcn/ui components. For a behavioral decision, the smallest script that exercises the question.
5. **Put variants behind one switcher.** Buttons or a keypress, each variant labeled. Build two or three variants, including one the human did not ask for.
6. **Observe on the real surface.** Screenshot each variant at desktop and mobile widths using a browser automation skill if available, and drive the interaction. For a behavioral decision, log the timing or print the output. The observation is the test.
7. **Recommend.** Present variants, evidence, tradeoffs, and one recommendation. Say plainly that the code is throwaway.

## Cohory design direction

Check every visual variant against the project's direction. If `docs/architecture/design-system.md` or the `packages/ui` theme exists, it overrides this list.

- Skool's simplicity, Linear's polish, Notion's minimalism.
- White and light-gray surfaces (`#F8FAFC` background, `#FFFFFF` cards), subtle borders (`#E5E7EB`) instead of heavy shadows.
- One primary accent (`#2563EB`). Primary text `#111827`, secondary `#64748B`.
- Rounded cards (12px radius), generous spacing on a 4px and 8px scale.
- Inter or Geist type, Lucide icons, shadcn/ui and Radix primitives.
- Every screen has designed empty, loading, and error states. Keyboard focus is visible. Contrast meets WCAG AA.

## Reply

The variants, the screenshots or observed output, tradeoffs, the recommendation, and the scratch path. Delete the scratch folder once the decision is recorded, unless the human wants to keep it.
