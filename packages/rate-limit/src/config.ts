import { z } from "zod";

export interface RateLimitRule {
  readonly max: number;
  readonly windowSeconds: number;
}

export const rateLimitDefaults = {
  signUp: { max: 5, windowSeconds: 600 },
  signIn: { max: 10, windowSeconds: 60 },
  signInAccount: { max: 50, windowSeconds: 900 },
  passwordReset: { max: 5, windowSeconds: 600 },
  inviteCreate: { max: 30, windowSeconds: 3600 },
  inviteRedeem: { max: 10, windowSeconds: 600 },
  post: { max: 10, windowSeconds: 60 },
  comment: { max: 30, windowSeconds: 60 },
  reaction: { max: 120, windowSeconds: 60 },
  rsvp: { max: 30, windowSeconds: 60 },
  joinRequest: { max: 10, windowSeconds: 600 },
  search: { max: 30, windowSeconds: 60 },
  report: { max: 10, windowSeconds: 600 },
  migrationPreview: { max: 50, windowSeconds: 3600 },
  migrationImport: { max: 10, windowSeconds: 3600 },
  memberImport: { max: 20, windowSeconds: 3600 },
  apiToken: { max: 60, windowSeconds: 60 },
  agentRequest: { max: 30, windowSeconds: 60 },
  agentWrite: { max: 30, windowSeconds: 3600 },
  oauthRegister: { max: 10, windowSeconds: 3600 },
  oauthToken: { max: 30, windowSeconds: 60 },
  agentDownload: { max: 30, windowSeconds: 60 },
  tokenRegenerate: { max: 10, windowSeconds: 3600 },
  emailOptOut: { max: 10, windowSeconds: 600 },
  emailWebhook: { max: 60, windowSeconds: 60 },
  dataExportDownload: { max: 10, windowSeconds: 3600 },
  contactIpHour: { max: 5, windowSeconds: 3600 },
  contactIpDay: { max: 20, windowSeconds: 86400 },
  contactAccount: { max: 10, windowSeconds: 86400 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitRuleName = keyof typeof rateLimitDefaults;

export type RateLimitRules = Readonly<Record<RateLimitRuleName, RateLimitRule>>;

export const rateLimitEnvNames: Readonly<Record<RateLimitRuleName, string>> = {
  signUp: "RATE_LIMIT_SIGN_UP",
  signIn: "RATE_LIMIT_SIGN_IN",
  signInAccount: "RATE_LIMIT_SIGN_IN_ACCOUNT",
  passwordReset: "RATE_LIMIT_PASSWORD_RESET",
  inviteCreate: "RATE_LIMIT_INVITE_CREATE",
  inviteRedeem: "RATE_LIMIT_INVITE_REDEEM",
  post: "RATE_LIMIT_POSTS",
  comment: "RATE_LIMIT_COMMENTS",
  reaction: "RATE_LIMIT_REACTIONS",
  rsvp: "RATE_LIMIT_RSVPS",
  joinRequest: "RATE_LIMIT_JOIN_REQUESTS",
  search: "RATE_LIMIT_SEARCH",
  report: "RATE_LIMIT_REPORTS",
  migrationPreview: "RATE_LIMIT_MIGRATION_PREVIEWS",
  migrationImport: "RATE_LIMIT_MIGRATION_IMPORTS",
  memberImport: "RATE_LIMIT_MEMBER_IMPORTS",
  apiToken: "RATE_LIMIT_API_TOKENS",
  agentRequest: "RATE_LIMIT_AGENT_REQUESTS",
  agentWrite: "RATE_LIMIT_AGENT_WRITES",
  oauthRegister: "RATE_LIMIT_OAUTH_REGISTER",
  oauthToken: "RATE_LIMIT_OAUTH_TOKEN",
  agentDownload: "RATE_LIMIT_AGENT_DOWNLOADS",
  tokenRegenerate: "RATE_LIMIT_TOKEN_REGENERATE",
  emailOptOut: "RATE_LIMIT_EMAIL_OPT_OUT",
  emailWebhook: "RATE_LIMIT_EMAIL_WEBHOOK",
  dataExportDownload: "RATE_LIMIT_DATA_EXPORT_DOWNLOADS",
  contactIpHour: "RATE_LIMIT_CONTACT_IP_HOUR",
  contactIpDay: "RATE_LIMIT_CONTACT_IP_DAY",
  contactAccount: "RATE_LIMIT_CONTACT_ACCOUNT",
};

const ruleSchema = z
  .string()
  .regex(/^\d+\/\d+$/, "Use max/seconds, for example 10/60.")
  .transform((value) => {
    const [max, windowSeconds] = value.split("/").map(Number);
    return { max: max ?? 0, windowSeconds: windowSeconds ?? 0 };
  })
  .refine((rule) => rule.max >= 1 && rule.windowSeconds >= 1, "Both numbers must be 1 or more.");

const disabledSchema = z.enum(["true", "false"]).optional();

export interface RateLimitConfig {
  readonly disabled: boolean;
  readonly rules: RateLimitRules;
}

export function parseRateLimitEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RateLimitConfig {
  const rules = { ...rateLimitDefaults } as Record<RateLimitRuleName, RateLimitRule>;
  for (const name of Object.keys(rateLimitEnvNames) as RateLimitRuleName[]) {
    const raw = env[rateLimitEnvNames[name]];
    if (raw !== undefined && raw !== "") {
      rules[name] = ruleSchema.parse(raw);
    }
  }
  return { disabled: disabledSchema.parse(env.RATE_LIMIT_DISABLED) === "true", rules };
}
