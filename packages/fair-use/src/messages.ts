import type { LimitReachedError } from "./errors";

const kilobyte = 1024;
const units = ["KB", "MB", "GB", "TB"] as const;

const counts = new Intl.NumberFormat("en-US");
const sizes = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatBytes(bytes: number): string {
  if (bytes < kilobyte) {
    return bytes === 1 ? "1 byte" : `${counts.format(bytes)} bytes`;
  }
  let value = bytes / kilobyte;
  let unit = 0;
  while (value >= kilobyte && unit < units.length - 1) {
    value /= kilobyte;
    unit += 1;
  }
  return `${sizes.format(value)} ${units[unit]}`;
}

export function formatMembers(count: number): string {
  return count === 1 ? "1 member" : `${counts.format(count)} members`;
}

export function limitReachedMessage(error: LimitReachedError): string {
  switch (error.resource) {
    case "members":
      return `This community has reached its limit of ${formatMembers(error.limit)}, so it can't take new members right now.`;
    case "storage":
      return `This community has used its ${formatBytes(error.limit)} of file storage. Remove files you no longer need, or ask the owner to request more space.`;
    case "upload":
      return `This file is larger than the ${formatBytes(error.limit)} limit for one upload. Choose a smaller file.`;
  }
}
