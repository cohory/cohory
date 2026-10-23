const localHosts = new Set(["localhost", "127.0.0.1"]);

export type ResetLocalRefusal =
  | { readonly reason: "production" }
  | { readonly reason: "not_confirmed" }
  | { readonly reason: "remote_host"; readonly host: string }
  | { readonly reason: "invalid_url" };

export function resetLocalRefusal(
  env: Readonly<Record<string, string | undefined>>,
  args: readonly string[],
): ResetLocalRefusal | null {
  if (env.NODE_ENV === "production") {
    return { reason: "production" };
  }
  const urls = [env.DATABASE_URL, env.DATABASE_ADMIN_URL].filter((url): url is string => !!url);
  if (urls.length === 0) {
    return { reason: "invalid_url" };
  }
  for (const url of urls) {
    if (!URL.canParse(url)) {
      return { reason: "invalid_url" };
    }
    const host = new URL(url).hostname;
    if (!localHosts.has(host)) {
      return { reason: "remote_host", host };
    }
  }
  if (!args.includes("--yes")) {
    return { reason: "not_confirmed" };
  }
  return null;
}

export function describeRefusal(refusal: ResetLocalRefusal): string {
  switch (refusal.reason) {
    case "production":
      return "db:reset:local never runs when NODE_ENV is production";
    case "invalid_url":
      return "db:reset:local needs DATABASE_URL (and DATABASE_ADMIN_URL, when set) to be Postgres URLs";
    case "remote_host":
      return `db:reset:local only resets a database on localhost or 127.0.0.1, not ${refusal.host}`;
    case "not_confirmed":
      return "db:reset:local deletes every row in the local database; run it again with --yes";
  }
}
