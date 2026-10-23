import { z } from "zod";

const documentedPlaceholders = new Set(["change-me-to-a-random-string-of-32-characters"]);
const minimumEntropyBits = 120;
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function estimatedEntropyBits(value: string): number {
  return value.length * Math.log2(new Set(value).size);
}

function productionSecretProblem(value: string): string | null {
  if (documentedPlaceholders.has(value)) {
    return "is the placeholder from .env.example. Generate one with `openssl rand -base64 32`.";
  }
  if (estimatedEntropyBits(value) < minimumEntropyBits) {
    return "does not look random. Generate one with `openssl rand -base64 32`.";
  }
  return null;
}

const versionedSecretsSchema = z
  .string()
  .transform((raw, ctx) => {
    const secrets: { version: number; value: string }[] = [];
    for (const entry of raw.split(",")) {
      const match = /^\s*(\d+):(.+?)\s*$/.exec(entry);
      if (!match?.[1] || !match[2]) {
        ctx.addIssue({
          code: "custom",
          message: "Use <version>:<secret>, for example 2:abc,1:def.",
        });
        return z.NEVER;
      }
      if (match[2].length < 32) {
        ctx.addIssue({ code: "custom", message: "Use at least 32 characters for each secret." });
        return z.NEVER;
      }
      secrets.push({ version: Number(match[1]), value: match[2] });
    }
    if (new Set(secrets.map((secret) => secret.version)).size !== secrets.length) {
      ctx.addIssue({ code: "custom", message: "Use each version once." });
      return z.NEVER;
    }
    return secrets;
  })
  .optional();

const authEnvSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_SECRETS: z.preprocess(
      (value) => (value === "" ? undefined : value),
      versionedSecretsSchema,
    ),
    BETTER_AUTH_URL: z.url(),
    ALLOW_INSECURE_HTTP: z.enum(["true", "false"]).optional(),
  })
  .superRefine((env, ctx) => {
    const url = new URL(env.BETTER_AUTH_URL);
    // `docker compose up` with .env.example runs a production build on localhost; only a server
    // reachable on a real host needs these rules.
    if (env.NODE_ENV !== "production" || localHosts.has(url.hostname)) {
      return;
    }
    const secrets: [string, string][] = [
      ["BETTER_AUTH_SECRET", env.BETTER_AUTH_SECRET],
      ...(env.BETTER_AUTH_SECRETS ?? []).map((secret): [string, string] => [
        "BETTER_AUTH_SECRETS",
        secret.value,
      ]),
    ];
    for (const [name, value] of secrets) {
      const problem = productionSecretProblem(value);
      if (problem) {
        ctx.addIssue({ code: "custom", path: [name], message: `${name} ${problem}` });
      }
    }
    if (url.protocol !== "https:" && env.ALLOW_INSECURE_HTTP !== "true") {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_URL"],
        message:
          "BETTER_AUTH_URL must use https in production so session cookies are Secure. Set ALLOW_INSECURE_HTTP=true only for a private network.",
      });
    }
  })
  .transform(({ NODE_ENV: _nodeEnv, ALLOW_INSECURE_HTTP: _allowInsecureHttp, ...env }) => env);

export type AuthEnv = z.output<typeof authEnvSchema>;

export function parseAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  return authEnvSchema.parse(env);
}

export function invalidAuthEnvNames(env: Readonly<Record<string, string | undefined>>): string[] {
  const result = authEnvSchema.safeParse(env);
  if (result.success) {
    return [];
  }
  return [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
}
