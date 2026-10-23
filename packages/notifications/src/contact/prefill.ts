import { z } from "zod";

import type { ContactTopic } from "./service";

export const contactTopicSlugs = {
  feedback: "Feedback",
  help: "Help with my community",
  billing: "Billing",
  problem: "Report a problem",
  other: "Other",
} as const satisfies Record<string, ContactTopic>;

type ContactTopicSlug = keyof typeof contactTopicSlugs;

export interface ContactPrefill {
  readonly topic: ContactTopic | null;
  readonly link: string | null;
}

const topicSchema = z
  .enum(Object.keys(contactTopicSlugs) as [ContactTopicSlug, ...ContactTopicSlug[]])
  .transform((slug) => contactTopicSlugs[slug]);

const fromSchema = z
  .string()
  .max(300)
  .regex(/^\/(?![/\\])[^\s\\]*$/);

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function contactPrefill(
  query: Readonly<Record<string, unknown>>,
  appUrl: string,
): ContactPrefill {
  const topic = topicSchema.safeParse(first(query.topic));
  const from = fromSchema.safeParse(first(query.from));
  const origin = new URL(appUrl).origin;
  const link =
    from.success && new URL(from.data, origin).origin === origin
      ? `${appUrl.replace(/\/+$/, "")}${from.data}`
      : null;
  return { topic: topic.success ? topic.data : null, link };
}
