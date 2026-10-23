const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);

export type RedirectUriProblem =
  "not_absolute" | "fragment" | "credentials" | "insecure" | "too_long";

export function redirectUriProblem(value: string): RedirectUriProblem | null {
  if (value.length > 2000) {
    return "too_long";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "not_absolute";
  }
  if (value.includes("#")) {
    return "fragment";
  }
  if (url.username !== "" || url.password !== "") {
    return "credentials";
  }
  if (url.protocol === "https:" && url.hostname !== "") {
    return null;
  }
  if (url.protocol === "http:" && loopbackHosts.has(url.hostname)) {
    return null;
  }
  return "insecure";
}

export function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && loopbackHosts.has(url.hostname);
  } catch {
    return false;
  }
}

export function redirectHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

export function withQuery(redirectUri: string, params: Readonly<Record<string, string>>): string {
  const url = new URL(redirectUri);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }
  return url.toString();
}
