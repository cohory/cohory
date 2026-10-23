import { assertMemberCapacity, LimitReachedError, type FairUseLimits } from "@cohory/fair-use";

export function fitsMemberCapacity(
  limits: FairUseLimits,
  activeMembers: number,
  check: typeof assertMemberCapacity = assertMemberCapacity,
): boolean {
  try {
    check(limits, activeMembers);
    return true;
  } catch (error: unknown) {
    if (error instanceof LimitReachedError) return false;
    throw error;
  }
}
