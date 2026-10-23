import type { PlanView } from "@cohory/payments";
import { formatMoney } from "@cohory/ui";

import type { JoinState } from "./join-state";

export interface JoinOffer {
  readonly price: string | null;
  readonly note: string | null;
}

export interface AboutCounts {
  readonly courses: number | null;
  readonly upcomingEvents: number | null;
}

type PlanPrices = Pick<PlanView, "monthlyPriceMinor" | "annualPriceMinor" | "currency">;

const cancelLine = "Cancel anytime.";

export function joinOffer(plan: PlanPrices | null): JoinOffer {
  if (!plan) {
    return { price: null, note: null };
  }
  const price = `${formatMoney(plan.monthlyPriceMinor, plan.currency)}/month`;
  const saving =
    plan.annualPriceMinor === null ? 0 : plan.monthlyPriceMinor * 12 - plan.annualPriceMinor;
  if (saving <= 0) {
    return { price, note: cancelLine };
  }
  return {
    price,
    note: `Yearly saves ${formatMoney(saving, plan.currency)}. ${cancelLine}`,
  };
}

const joinableKinds: ReadonlySet<JoinState["kind"]> = new Set([
  "paid",
  "sign_up",
  "join",
  "request",
  "rejoin",
]);

export function stickyJoinable(state: JoinState): boolean {
  return joinableKinds.has(state.kind);
}

function counted(count: number | null, one: string, many: string): string[] {
  if (!count) {
    return [];
  }
  return [count === 1 ? one : `${count} ${many}`];
}

export function suggestedWhatYouGet(counts: AboutCounts): string[] {
  return [
    "Posts and discussions with other members",
    ...counted(counts.courses, "1 course in the Classroom", "courses in the Classroom"),
    ...counted(
      counts.upcomingEvents,
      "1 upcoming event on the Calendar",
      "upcoming events on the Calendar",
    ),
  ];
}

export function whatYouGetLines(written: readonly string[], counts: AboutCounts): string[] {
  return written.length > 0 ? [...written] : suggestedWhatYouGet(counts);
}
