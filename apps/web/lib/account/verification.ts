import { RateLimitedError } from "@cohory/rate-limit";

export type VerificationState =
  | { readonly status: "idle" }
  | { readonly status: "sent" | "verified" | "error"; readonly message: string };

export interface VerificationUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface VerificationDeps {
  readonly send: (email: string) => Promise<void>;
  readonly consume: (userId: string) => void;
}

export async function resendVerification(
  user: VerificationUser,
  deps: VerificationDeps,
): Promise<VerificationState> {
  if (user.emailVerified) {
    return { status: "verified", message: "Your email is already confirmed." };
  }
  try {
    deps.consume(user.id);
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    return {
      status: "error",
      message: "You asked for several links already. Wait a few minutes and try again.",
    };
  }
  try {
    await deps.send(user.email);
  } catch {
    return { status: "error", message: "We could not send the email. Try again in a few minutes." };
  }
  return {
    status: "sent",
    message: `We sent a new link to ${user.email}. It may take a minute to arrive.`,
  };
}
