export const cancelReasons = [
  "too_expensive",
  "unused",
  "missing_features",
  "low_quality",
  "customer_service",
  "switched_service",
  "too_complex",
  "other",
] as const;

export type CancelReason = (typeof cancelReasons)[number];
