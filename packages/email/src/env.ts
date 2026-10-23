import { parsePlatformEnv } from "@cohory/config/platform";
import { z } from "zod";

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

const optionalSecret = z.preprocess(blankToUndefined, z.string().optional());

const flag = z.preprocess(blankToUndefined, z.enum(["true", "false"]).optional());

const senderAddress = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    const address = (/<([^<>]*)>\s*$/.exec(value)?.[1] ?? value).trim();
    if (!z.email().safeParse(address).success && !/^[^\s@<>]+@localhost$/.test(address)) {
      context.addIssue({ code: "custom", message: "must be an email address" });
      return z.NEVER;
    }
    return address;
  });

const emailEnvSchema = z.object({
  EMAIL_DRIVER: z.enum(["smtp", "log"]).default("smtp"),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_USER: optionalSecret,
  SMTP_PASSWORD: optionalSecret,
  SMTP_SECURE: flag,
  SMTP_REQUIRE_TLS: flag,
  SMTP_FROM: z.preprocess(blankToUndefined, senderAddress.default("no-reply@localhost")),
  SMTP_REPLY_TO: z.preprocess(blankToUndefined, z.email().optional()),
  EMAIL_ALLOW_ANY_FROM: flag,
  EMAIL_RATE_PER_SECOND: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(1000).default(10),
  ),
  EMAIL_MAX_CONNECTIONS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(50).default(3),
  ),
  NODE_ENV: z.string().optional(),
});

export type EmailEnv =
  | { readonly driver: "log" }
  | {
      readonly driver: "smtp";
      readonly host: string;
      readonly port: number;
      readonly user: string | undefined;
      readonly password: string | undefined;
      readonly secure: boolean;
      readonly requireTls: boolean;
      readonly fromAddress: string;
      readonly replyTo: string | undefined;
      readonly messageIdHost: string;
      readonly instanceName: string;
      readonly maxConnections: number;
      readonly ratePerSecond: number;
    };

export type SmtpEnv = Extract<EmailEnv, { driver: "smtp" }>;

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function aligned(fromDomain: string, appHost: string): boolean {
  return (
    isLoopback(appHost) ||
    fromDomain === appHost ||
    appHost.endsWith(`.${fromDomain}`) ||
    fromDomain.endsWith(`.${appHost}`)
  );
}

export function parseEmailEnv(env: NodeJS.ProcessEnv = process.env): EmailEnv {
  const parsed = emailEnvSchema.parse(env);
  if (parsed.EMAIL_DRIVER === "log") {
    return { driver: "log" };
  }
  const platform = parsePlatformEnv(env);
  const appHost = new URL(platform.appUrl).hostname.toLowerCase();
  const fromDomain = parsed.SMTP_FROM.slice(parsed.SMTP_FROM.lastIndexOf("@") + 1).toLowerCase();
  if (
    parsed.NODE_ENV === "production" &&
    parsed.EMAIL_ALLOW_ANY_FROM !== "true" &&
    !aligned(fromDomain, appHost)
  ) {
    throw new Error(
      `Invalid email configuration: SMTP_FROM uses ${fromDomain}, but APP_URL is on ${appHost}. Send from an address on ${appHost} or its parent domain so SPF, DKIM, and DMARC line up, or set EMAIL_ALLOW_ANY_FROM=true.`,
    );
  }
  return {
    driver: "smtp",
    host: parsed.SMTP_HOST,
    port: parsed.SMTP_PORT,
    user: parsed.SMTP_USER,
    password: parsed.SMTP_PASSWORD,
    secure:
      parsed.SMTP_SECURE === undefined ? parsed.SMTP_PORT === 465 : parsed.SMTP_SECURE === "true",
    requireTls: parsed.SMTP_REQUIRE_TLS === "true",
    fromAddress: parsed.SMTP_FROM,
    replyTo: parsed.SMTP_REPLY_TO,
    messageIdHost: appHost,
    instanceName: platform.instance.name,
    maxConnections: parsed.EMAIL_MAX_CONNECTIONS,
    ratePerSecond: parsed.EMAIL_RATE_PER_SECOND,
  };
}

export function emailConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    parseEmailEnv(env);
    return null;
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return `Invalid email configuration: ${error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
