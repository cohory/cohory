type AuthClientError = {
  code?: string | undefined;
  status: number;
};

const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD:
    "That email and password do not match. Try again or reset your password.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Sign in instead.",
  INVALID_TOKEN: "This reset link has expired or was already used. Request a new one.",
  INVALID_PASSWORD: "Your current password is not correct.",
  EMAIL_NOT_VERIFIED:
    "Confirm your email first. Open the link we sent you, or ask for a new one below.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters.",
  PASSWORD_TOO_LONG: "Use 128 characters or fewer.",
  SIGN_UP_CLOSED:
    "This server is not open for new accounts. Ask the person who runs it for an invite.",
};

export function authErrorMessage(error: AuthClientError): string {
  if (error.status === 429) {
    return "Too many attempts. Wait a minute and try again.";
  }
  const known = error.code === undefined ? undefined : messages[error.code];
  return known ?? "We could not reach the server. Check your connection and try again.";
}
