import type { Edition } from "@cohory/config/edition";

export type { Edition };
export type ProviderKind = "stripe_connect" | "stripe_own_keys" | "polar";

export const maxFeeBps = 10_000;

export class InvalidFeeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFeeInputError";
  }
}

function requireMinor(name: string, value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidFeeInputError(`${name} must be a non-negative safe integer`);
  }
  return BigInt(value);
}

function requireBps(value: number): bigint {
  if (!Number.isInteger(value) || value < 0 || value > maxFeeBps) {
    throw new InvalidFeeInputError(`fee rate must be an integer between 0 and ${maxFeeBps} bps`);
  }
  return BigInt(value);
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function computeApplicationFee(amountMinor: number, feeBps: number): number {
  const amount = requireMinor("amount", amountMinor);
  const bps = requireBps(feeBps);
  return Number(roundHalfUp(amount * bps, BigInt(maxFeeBps)));
}

export interface FeeRefundInput {
  readonly feeMinor: number;
  readonly chargedMinor: number;
  readonly refundedMinor: number;
  readonly feeRefundedMinor: number;
}

export function cumulativeFeeRefundDue(input: FeeRefundInput): number {
  const fee = requireMinor("fee", input.feeMinor);
  const charged = requireMinor("charged", input.chargedMinor);
  const refunded = requireMinor("refunded", input.refundedMinor);
  const alreadyRefunded = requireMinor("fee refunded", input.feeRefundedMinor);
  if (refunded > charged) {
    throw new InvalidFeeInputError("refunded amount exceeds the charge");
  }
  if (charged === 0n) {
    return 0;
  }
  const owed = roundHalfUp(fee * refunded, charged);
  const capped = owed > fee ? fee : owed;
  const due = capped - alreadyRefunded;
  return due > 0n ? Number(due) : 0;
}

export interface DisputeFeeRefundInput {
  readonly feeMinor: number;
  readonly chargedMinor: number;
  readonly refundedMinor: number;
  readonly disputedMinor: number;
  readonly feeRefundedMinor: number;
}

export function disputeFeeRefundDue(input: DisputeFeeRefundInput): number {
  const charged = requireMinor("charged", input.chargedMinor);
  const refunded = requireMinor("refunded", input.refundedMinor);
  const disputed = requireMinor("disputed", input.disputedMinor);
  if (disputed > charged) {
    throw new InvalidFeeInputError("disputed amount exceeds the charge");
  }
  const lost = refunded + disputed > charged ? charged : refunded + disputed;
  return cumulativeFeeRefundDue({
    feeMinor: input.feeMinor,
    chargedMinor: input.chargedMinor,
    refundedMinor: Number(lost),
    feeRefundedMinor: input.feeRefundedMinor,
  });
}

export interface FeeRateInput {
  readonly edition: Edition;
  readonly provider: ProviderKind;
  readonly configuredBps: number;
}

export function effectiveFeeBps(input: FeeRateInput): number {
  if (input.edition !== "cloud" || input.provider === "stripe_own_keys") {
    return 0;
  }
  return Number(requireBps(input.configuredBps));
}

export function applicationFeePercent(feeBps: number): number {
  return Number(requireBps(feeBps)) / 100;
}

export function feeBpsFromPercent(percent: number | null): number {
  const bps = Math.round((percent ?? 0) * 100);
  if (!Number.isFinite(percent ?? 0) || bps < 0 || bps > maxFeeBps) {
    throw new InvalidFeeInputError(`fee percent must be between 0 and ${maxFeeBps / 100}`);
  }
  return bps;
}

export interface FeeRefundAmount {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
}

export interface FeeRefundTotal {
  readonly currency: string;
  readonly amountRefunded: number;
}

export function allocateFeeRefunds(
  refunds: readonly FeeRefundAmount[],
  fee: FeeRefundTotal,
): ReadonlyMap<string, number> {
  const shares = new Map<string, number>();
  if (refunds.every((refund) => refund.currency === fee.currency)) {
    for (const refund of refunds) {
      shares.set(refund.id, Number(requireMinor("fee refund", refund.amount)));
    }
    return shares;
  }
  const total = requireMinor("fee refunded", fee.amountRefunded);
  const weights = refunds.map((refund) => requireMinor("fee refund", refund.amount));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum === 0n) {
    for (const refund of refunds) {
      shares.set(refund.id, 0);
    }
    return shares;
  }
  const floors = weights.map((weight) => (total * weight) / weightSum);
  const remainders = weights.map((weight, index) => ({
    index,
    remainder: (total * weight) % weightSum,
  }));
  let leftover = total - floors.reduce((sum, floor) => sum + floor, 0n);
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (leftover === 0n) {
      break;
    }
    floors[index] = (floors[index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  refunds.forEach((refund, index) => {
    shares.set(refund.id, Number(floors[index] ?? 0n));
  });
  return shares;
}
