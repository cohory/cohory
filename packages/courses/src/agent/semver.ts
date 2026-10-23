export const versionBumps = ["patch", "minor", "major"] as const;

export type VersionBump = (typeof versionBumps)[number];

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export const firstAgentVersion: Semver = { major: 1, minor: 0, patch: 0 };

export function parseSemver(value: string): Semver | null {
  const match = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatSemver(version: Semver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function bumpSemver(latest: Semver | null, bump: VersionBump): Semver {
  if (!latest) return firstAgentVersion;
  switch (bump) {
    case "major":
      return { major: latest.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: latest.major, minor: latest.minor + 1, patch: 0 };
    case "patch":
      return { major: latest.major, minor: latest.minor, patch: latest.patch + 1 };
  }
}

export function nextVersions(latest: Semver | null): Readonly<Record<VersionBump, string>> {
  return {
    patch: formatSemver(bumpSemver(latest, "patch")),
    minor: formatSemver(bumpSemver(latest, "minor")),
    major: formatSemver(bumpSemver(latest, "major")),
  };
}
