export type FairUseResource = "members" | "storage" | "upload";

export class LimitReachedError extends Error {
  readonly code = "limit_reached";

  constructor(
    readonly resource: FairUseResource,
    readonly limit: number,
    readonly used: number,
  ) {
    super(`fair use limit for ${resource} reached`);
    this.name = "LimitReachedError";
  }
}
