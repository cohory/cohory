# End to end tests

Playwright specs for Cohory's critical journeys, run against the production image in an isolated Compose project.

Status: Draft, 2026-10-22

## Run

```sh
pnpm e2e:host tests/step10-joining.spec.ts # specs on the host, no image build
pnpm e2e                                   # the whole suite against the image
pnpm e2e tests/payments.spec.ts            # one spec
pnpm --filter @cohory/e2e e2e:report       # open the last HTML report
```

`pnpm e2e` and `pnpm e2e:host` take every slot of the machine wide test budget, start their stack, run Playwright, and always tear the stack down. Never start a stack another way. Use `pnpm e2e:host` while working and `pnpm e2e` before landing ([local workflow](../../docs/open-source/local-workflow.md)). The full guide, including the stack's ports, environment, and the rules that keep specs stable, is [docs/open-source/testing.md](../../docs/open-source/testing.md).

## Layout

| Path | Contents |
|------|----------|
| `tests/` | One spec per journey or feature |
| `pages/` | Page helpers that drive one area of the app |
| `support/` | Fixtures, the database helper, the axe check, and the fake Stripe and Polar servers |

## Payments and Stripe test mode

The payments specs run against `support/fake-stripe/server.mts`, in CI and locally. No CI job runs against real Stripe.

Before a release, a person runs journeys 2, 4 and 10 by hand against a Stripe sandbox. This run is a human gate: the release waits for it, and its result is recorded in [payments.md](../../docs/architecture/payments.md). The steps are in [Testing payments against Stripe test mode](../../docs/open-source/testing.md#testing-payments-against-stripe-test-mode). Use test mode keys only, keep them in the root `.env`, and never paste a key into a tracked file, a log, or a report.
