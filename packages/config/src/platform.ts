import { z } from "zod";

import { editions, type Edition } from "./edition";

export type { Edition } from "./edition";

type Env = Readonly<Record<string, string | undefined>>;

export interface InstanceBranding {
  readonly name: string;
  readonly logoUrl: string | null;
}

export const signUpModes = ["open", "invite", "closed"] as const;

export type SignUpMode = (typeof signUpModes)[number];

export interface CommunityCreation {
  readonly mode: "anyone" | "operators";
  readonly operators: readonly string[];
}

export interface PlatformConfig {
  readonly edition: Edition;
  readonly appUrl: string;
  readonly instance: InstanceBranding;
  readonly homeCommunity: string | null;
  readonly creatorsCommunity: string | null;
  readonly signUpMode: SignUpMode;
  readonly communityCreation: CommunityCreation;
}

export const defaultAppUrl = "http://localhost:3000";
export const defaultInstanceName = "Cohory";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());
const httpUrl = z.url({ protocol: /^https?$/ });

const editionSchema = z.object({
  COHORY_EDITION: z.preprocess(blankToUndefined, z.enum(editions).default("community")),
});

const appUrlSchema = z.object({
  APP_URL: optional(httpUrl),
  BETTER_AUTH_URL: optional(httpUrl),
});

const communitySlug = z
  .string()
  .trim()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a community slug");

const instanceSchema = z.object({
  INSTANCE_NAME: optional(z.string().trim().max(60)),
  INSTANCE_LOGO_URL: optional(z.string().trim()),
  HOME_COMMUNITY: optional(communitySlug),
  CREATORS_COMMUNITY_SLUG: optional(communitySlug),
});

const operatorEmailsSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry !== "")
      : [],
  z.array(z.email()),
);

const accessSchema = z
  .object({
    SIGNUP_MODE: z.preprocess(blankToUndefined, z.enum(signUpModes).default("open")),
    COMMUNITY_CREATION: z.preprocess(
      blankToUndefined,
      z.enum(["anyone", "operators"]).default("anyone"),
    ),
    OPERATOR_EMAILS: operatorEmailsSchema,
  })
  .refine((env) => env.COMMUNITY_CREATION === "anyone" || env.OPERATOR_EMAILS.length > 0, {
    path: ["OPERATOR_EMAILS"],
    message: "must list at least one email when COMMUNITY_CREATION is operators",
  });

function parseWith<T extends z.ZodType>(schema: T, env: Env): z.infer<T> {
  const result = schema.safeParse(env);
  if (result.success) {
    return result.data;
  }
  throw new Error(
    `Invalid platform configuration: ${result.error.issues
      .map((issue) => `${issue.path.join(".")} ${issue.message}`)
      .join("; ")}`,
  );
}

export function parseEdition(env: Env = process.env): Edition {
  return parseWith(editionSchema, env).COHORY_EDITION;
}

export function parseAppUrl(env: Env = process.env): string {
  const parsed = parseWith(appUrlSchema, env);
  return (parsed.APP_URL ?? parsed.BETTER_AUTH_URL ?? defaultAppUrl).replace(/\/+$/, "");
}

function sameOriginLogo(value: string | undefined, appUrl: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  if (URL.canParse(value) && new URL(value).origin === new URL(appUrl).origin) {
    return value;
  }
  throw new Error(
    "Invalid platform configuration: INSTANCE_LOGO_URL must be a path such as /logo.svg or a URL on the APP_URL origin",
  );
}

export function parsePlatformEnv(env: Env = process.env): PlatformConfig {
  const appUrl = parseAppUrl(env);
  const instance = parseWith(instanceSchema, env);
  const access = parseWith(accessSchema, env);
  return {
    edition: parseEdition(env),
    appUrl,
    instance: {
      name: instance.INSTANCE_NAME ?? defaultInstanceName,
      logoUrl: sameOriginLogo(instance.INSTANCE_LOGO_URL, appUrl),
    },
    homeCommunity: instance.HOME_COMMUNITY ?? null,
    creatorsCommunity: instance.CREATORS_COMMUNITY_SLUG ?? null,
    signUpMode: access.SIGNUP_MODE,
    communityCreation: { mode: access.COMMUNITY_CREATION, operators: access.OPERATOR_EMAILS },
  };
}

export function canCreateCommunities(creation: CommunityCreation, email: string): boolean {
  return creation.mode === "anyone" || creation.operators.includes(email.trim().toLowerCase());
}

let cached: PlatformConfig | undefined;

export function getPlatformConfig(): PlatformConfig {
  cached ??= parsePlatformEnv();
  return cached;
}
