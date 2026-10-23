import { formatBytes, formatMembers, type CommunityUsage, type UsageItem } from "@cohory/fair-use";

export interface UsageRow {
  readonly label: string;
  readonly summary: string;
  readonly percent: number | null;
  readonly state: UsageItem["state"];
}

function percentOf(item: UsageItem): number | null {
  return item.limit === null ? null : Math.min(100, Math.round((item.used / item.limit) * 100));
}

function summary(item: UsageItem, format: (value: number) => string): string {
  return item.limit === null
    ? `${format(item.used)}, no limit`
    : `${format(item.used)} of ${format(item.limit)}`;
}

const numbers = new Intl.NumberFormat("en-US");

export function usageRows(usage: CommunityUsage): UsageRow[] {
  return [
    {
      label: "Members",
      summary: summary(usage.members, (value) => numbers.format(value)),
      percent: percentOf(usage.members),
      state: usage.members.state,
    },
    {
      label: "File storage",
      summary: summary(usage.storageBytes, formatBytes),
      percent: percentOf(usage.storageBytes),
      state: usage.storageBytes.state,
    },
  ];
}

function isLimited(usage: CommunityUsage): boolean {
  return (
    usage.members.limit !== null || usage.storageBytes.limit !== null || usage.uploadBytes !== null
  );
}

export function usageTier(usage: CommunityUsage): string | null {
  if (usage.tier === "paid") {
    return "Paid limits apply because this community had a paid transaction in the last 90 days.";
  }
  return isLimited(usage)
    ? "Free limits apply. Any paid transaction in the last 90 days raises them."
    : null;
}

export function usageDescription(usage: CommunityUsage): string {
  if (!isLimited(usage)) {
    return usage.tier === "paid"
      ? "No limits on members or file storage apply to this community."
      : "This server sets no limits on members or file storage.";
  }
  return "Fair use limits for this community. Reaching one pauses new joins or uploads. Nothing already here is hidden or removed.";
}

export function usageNotes(usage: CommunityUsage): string[] {
  const notes: string[] = [];
  if (usage.uploadBytes !== null) {
    notes.push(`Largest single upload: ${formatBytes(usage.uploadBytes)}.`);
  }
  if (usage.members.state === "reached" && usage.members.limit !== null) {
    notes.push(
      `New members can't join until fewer than ${formatMembers(usage.members.limit)} are active.`,
    );
  }
  if (usage.storageBytes.state === "reached") {
    notes.push("New uploads are paused. Remove files you no longer need to make room.");
  }
  return notes;
}
