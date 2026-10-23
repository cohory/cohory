import type { ApprovalDiffLine, ApprovalRecordedInput } from "@cohory/agents/approvals";

import type { OperationId } from "../route-meta";
import { isOperationId, labelFor } from "./catalog";

export type ReadAsOwner = (path: string) => Promise<Record<string, unknown> | null>;

export interface DescribeContext {
  readonly input: ApprovalRecordedInput;
  readonly slugBase: string;
  readonly idBase: string;
  readonly read: ReadAsOwner;
}

export interface Described {
  readonly summary: string;
  readonly diff: readonly ApprovalDiffLine[];
}

export type Description =
  | ({ readonly kind: "described" } & Described)
  | { readonly kind: "too_large"; readonly lines: number };

const maxSummary = 300;
const maxValue = 160;
export const maxDiffLines = 12;

function clip(value: string, length: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function displayValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }
  if (typeof value === "string" || typeof value === "number") {
    return clip(String(value), maxValue);
  }
  if (Array.isArray(value)) {
    return clip(value.map((item) => displayValue(item) ?? "").join(", "), maxValue);
  }
  return clip(JSON.stringify(value), maxValue);
}

export function formatMinor(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== "number") {
    return null;
  }
  const code = typeof currency === "string" ? currency.toUpperCase() : "USD";
  try {
    const format = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(amount / 10 ** digits);
  } catch {
    return `${amount} ${code} minor units`;
  }
}

const whenParts = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function formatWhen(value: unknown): string | null {
  const raw = text(value);
  const at = raw ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) {
    return raw;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    whenParts.formatToParts(at).find((item) => item.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")} at ${part("hour")}:${part("minute")} UTC`;
}

function collectText(node: unknown, into: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, into);
    return;
  }
  if (node === null || typeof node !== "object") {
    return;
  }
  const item = record(node);
  if (typeof item.text === "string") {
    into.push(item.text);
  }
  collectText(item.content, into);
}

export function bodyPreview(body: unknown): string | null {
  if (typeof body === "string") {
    return text(body) ? clip(body, maxValue) : null;
  }
  const parts: string[] = [];
  collectText(body, parts);
  const joined = parts.join(" ");
  return text(joined) ? clip(joined, maxValue) : null;
}

function objectDiff(before: Record<string, unknown> | null, after: unknown): ApprovalDiffLine[] {
  return Object.entries(record(after)).map(([key, value]) => ({
    label: humanize(key),
    before: before ? displayValue(before[key]) : null,
    after: displayValue(value),
  }));
}

function readUnder(
  ctx: DescribeContext,
  base: string,
  ...segments: readonly string[]
): Promise<Record<string, unknown> | null> {
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return Promise.resolve(null);
  }
  return ctx.read([base, ...segments.map((segment) => encodeURIComponent(segment))].join("/"));
}

function quoted(title: string | null, fallback: string): string {
  return title ? `"${clip(title, 80)}"` : fallback;
}

async function memberName(ctx: DescribeContext, userId: string | undefined) {
  const profile = userId ? await readUnder(ctx, ctx.slugBase, "members", userId) : null;
  return { name: text(profile?.name), role: text(profile?.role) };
}

type Describer = (ctx: DescribeContext) => Promise<Described>;

function memberAction(verb: string, rest: string, after: string): Describer {
  return async (ctx) => {
    const { name, role } = await memberName(ctx, ctx.input.params.userId);
    return {
      summary: `${verb} ${name ?? "a member"}${rest}`,
      diff: [{ label: "Membership", before: role ? humanize(role) : null, after }],
    };
  };
}

function courseAction(verb: string, after: string | null): Describer {
  return async (ctx) => {
    const courseSlug = ctx.input.params.courseSlug;
    const course = courseSlug ? await readUnder(ctx, ctx.slugBase, "courses", courseSlug) : null;
    const title = text(course?.title) ?? text(record(course?.course).title);
    return {
      summary: `${verb} the course ${quoted(title, courseSlug ?? "")}`.trim(),
      diff: after ? [{ label: "Course", before: title, after }] : [],
    };
  };
}

const describers: Partial<Record<OperationId, Describer>> = {
  removeMember: memberAction("remove", " from the community", "Removed"),
  banMember: memberAction("ban", " from the community", "Banned"),
  unbanMember: memberAction("lift the ban on", "", "Can join again"),
  async changeMemberRole(ctx) {
    const { name, role } = await memberName(ctx, ctx.input.params.userId);
    const next = text(record(ctx.input.body).role);
    return {
      summary: `make ${name ?? "a member"} ${next ? `a ${next}` : "a different role"}`,
      diff: [
        {
          label: "Role",
          before: role ? humanize(role) : null,
          after: next ? humanize(next) : null,
        },
      ],
    };
  },
  async transferOwnership(ctx) {
    const { name } = await memberName(ctx, text(record(ctx.input.body).userId) ?? undefined);
    return {
      summary: `make ${name ?? "another member"} the owner of the community`,
      diff: [{ label: "Owner", before: null, after: name }],
    };
  },
  async deletePost(ctx) {
    const postId = ctx.input.params.postId;
    const post = postId ? await readUnder(ctx, ctx.slugBase, "posts", postId) : null;
    const title = text(post?.title) ?? text(post?.excerpt);
    const author = text(record(post?.author).name);
    return {
      summary: `delete the post ${quoted(title, "")}${author ? ` by ${author}` : ""}`.replace(
        /\s+/g,
        " ",
      ),
      diff: [{ label: "Post", before: title ? clip(title, maxValue) : null, after: "Deleted" }],
    };
  },
  publishCourse: courseAction("publish", "Published"),
  unpublishCourse: courseAction("unpublish", "Draft"),
  deleteCourse: courseAction("delete", "Deleted"),
  async deleteCalendarEvent(ctx) {
    const eventSlug = ctx.input.params.eventSlug;
    const event = eventSlug
      ? await readUnder(ctx, ctx.slugBase, "calendar", "events", eventSlug)
      : null;
    const title = text(event?.title) ?? text(record(event?.event).title);
    return {
      summary: `delete the event ${quoted(title, eventSlug ?? "")} and all its dates`,
      diff: [{ label: "Event", before: title, after: "Deleted" }],
    };
  },
  async updateCommunitySettings(ctx) {
    const before = await readUnder(ctx, ctx.slugBase, "manage", "settings");
    return { summary: "change the community settings", diff: objectDiff(before, ctx.input.body) };
  },
  async upsertMembershipPlan(ctx) {
    const current = record((await readUnder(ctx, ctx.idBase, "payments", "plan"))?.plan);
    const body = record(ctx.input.body);
    const monthly = formatMinor(body.monthlyPriceMinor, body.currency);
    return {
      summary: monthly
        ? `set the membership price to ${monthly} a month`
        : "change the membership plan",
      diff: [
        { label: "Name", before: text(current.name), after: text(body.name) ?? text(current.name) },
        {
          label: "Monthly price",
          before: formatMinor(current.monthlyPriceMinor, current.currency),
          after: monthly,
        },
        {
          label: "Yearly price",
          before: formatMinor(current.annualPriceMinor, current.currency),
          after: formatMinor(body.annualPriceMinor, body.currency),
        },
      ],
    };
  },
  async createMembershipCheckout(ctx) {
    const interval = text(record(ctx.input.body).interval) === "year" ? "yearly" : "monthly";
    const community = await ctx.read(ctx.slugBase);
    const name = text(community?.name);
    return {
      summary: `buy a ${interval} membership${name ? ` of ${clip(name, 80)}` : ""}`,
      diff: [
        { label: "Membership", before: null, after: `${humanize(interval)}, paid at checkout` },
      ],
    };
  },
  async exportMembersCsv(ctx) {
    return {
      summary: "download the members list as a spreadsheet, including email addresses",
      diff: objectDiff(null, ctx.input.query),
    };
  },
  async createWebhookEndpoint(ctx) {
    const body = record(ctx.input.body);
    const url = text(body.url);
    return {
      summary: `send community events to ${url ? clip(url, 120) : "a new webhook endpoint"}`,
      diff: objectDiff(null, { url: body.url, eventTypes: body.eventTypes }),
    };
  },
  async createPost(ctx) {
    const body = record(ctx.input.body);
    const when = formatWhen(body.scheduledAt);
    const title = quoted(text(body.title), "without a title");
    return {
      summary: when ? `schedule the post ${title} for ${when}` : `publish the post ${title}`,
      diff: [
        { label: "Title", before: null, after: displayValue(body.title) },
        { label: "Post", before: null, after: bodyPreview(body.body) },
        { label: "Publish at", before: null, after: when ?? "Right away" },
      ],
    };
  },
};

function complete(described: Described): Description {
  return described.diff.length > maxDiffLines
    ? { kind: "too_large", lines: described.diff.length }
    : { kind: "described", ...described };
}

export async function describeProposal(
  operationId: string,
  ctx: DescribeContext,
): Promise<Description> {
  const fallback: Described = {
    summary: labelFor(operationId),
    diff: objectDiff(null, ctx.input.body),
  };
  const describer = isOperationId(operationId) ? describers[operationId] : undefined;
  if (!describer) {
    return complete(fallback);
  }
  try {
    const described = await describer(ctx);
    return complete({
      summary: clip(described.summary, maxSummary) || fallback.summary,
      diff: described.diff,
    });
  } catch {
    return complete(fallback);
  }
}
