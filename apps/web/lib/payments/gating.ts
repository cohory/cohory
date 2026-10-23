import type { PlanView } from "@cohory/payments";
import { formatMoney } from "@cohory/ui";

import type { CommunityPage } from "../communities/load";

export interface PaidJoinView {
  readonly label: string;
  readonly yearlyLabel: string | null;
  readonly asksQuestions: boolean;
}

export function paidJoinFor(page: CommunityPage, plan: PlanView | null): PaidJoinView | null {
  if (!plan) {
    return null;
  }
  if (page.access === "full" && (page.role !== null || page.membership?.status === "banned")) {
    return null;
  }
  return planJoin(plan, page.community.joinQuestions.length > 0);
}

export function planJoin(plan: PlanView, asksQuestions: boolean): PaidJoinView {
  return {
    label: `Join for ${formatMoney(plan.monthlyPriceMinor, plan.currency)}/month`,
    yearlyLabel:
      plan.annualPriceMinor === null
        ? null
        : `Yearly ${formatMoney(plan.annualPriceMinor, plan.currency)}`,
    asksQuestions,
  };
}
