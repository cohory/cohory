import type { PlanView } from "@cohory/payments";
import { formatMoney } from "@cohory/ui";

export interface JoinIntentContext {
  readonly name: string;
  readonly intent: "join" | "request" | "checkout";
  readonly price: string | null;
  readonly provider: string | null;
}

type PlanPrices = Pick<PlanView, "monthlyPriceMinor" | "annualPriceMinor" | "currency">;

export function planPrice(plan: PlanPrices, intent: "checkout" | "checkout_yearly"): string {
  if (intent === "checkout_yearly" && plan.annualPriceMinor !== null) {
    return `${formatMoney(plan.annualPriceMinor, plan.currency)}/year`;
  }
  return `${formatMoney(plan.monthlyPriceMinor, plan.currency)}/month`;
}

export function joinIntentLine(context: JoinIntentContext, action: "sign_up" | "sign_in"): string {
  const first = action === "sign_up" ? "Create your account" : "Sign in";
  if (context.intent === "checkout" && context.price) {
    const provider = context.provider ? ` with ${context.provider}` : "";
    return `${first}, then pay ${context.price}${provider} to join ${context.name}. Cancel anytime.`;
  }
  if (context.intent === "request") {
    return `${first}, then ask to join ${context.name}.`;
  }
  return action === "sign_up"
    ? `Create your account to join ${context.name}.`
    : `Sign in to join ${context.name}.`;
}
