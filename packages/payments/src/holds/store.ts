export interface DueHold {
  readonly communityId: string;
  readonly userId: string;
}

export type HoldRelease = "released" | "cleared" | "kept" | "none";

export type HoldSettlement =
  | { readonly kind: "none" }
  | { readonly kind: "cleared" }
  | { readonly kind: "use_taken"; readonly inviteId: string }
  | { readonly kind: "invite_exhausted"; readonly inviteId: string };

export interface HoldStore {
  lock(userId: string): Promise<void>;
  extend(userId: string, until: Date): Promise<void>;
  release(userId: string, now: Date, retryAt: Date): Promise<HoldRelease>;
  settleOnActivation(userId: string): Promise<HoldSettlement>;
  defer(userId: string, until: Date): Promise<void>;
}
