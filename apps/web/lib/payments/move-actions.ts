"use server";

import { getCommunitiesService } from "@cohory/communities";
import { getEmailOutbox } from "@cohory/email";
import { getMigrationService } from "@cohory/migration";
import { getPaymentsService } from "@cohory/payments";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logger } from "@cohory/infra/logger";

import { actorFor } from "../actor";
import { communityOptOutLinks } from "../email/opt-out";
import { appUrl } from "../manage/views";
import { failure, type ActionResult } from "../posts/errors";
import { requireCurrentSession } from "../session";
import { communityEmailBrandFor } from "../theme/email-brand";
import { paymentsActionFailure } from "./errors";
import { subscribersHref } from "./linking";
import { importedMoves, movedFrom, parseMoveLines } from "./moving";
import { membershipHref } from "./views";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const addSchema = z.object({
  slug,
  lines: z.string().max(100_000),
  freeUntil: z.union([z.literal(""), z.iso.date({ error: "Choose a valid date." })]),
});

const importedSchema = z.object({ slug, jobId: z.uuid() });
const remindSchema = z.object({ slug });

export type AddMovesActionInput = z.input<typeof addSchema>;
export type AddImportedMovesActionInput = z.input<typeof importedSchema>;

async function inCommunity<T>(
  slugValue: string,
  fn: (context: {
    actor: ReturnType<typeof actorFor>;
    community: { id: string; slug: string; name: string };
  }) => Promise<T>,
): Promise<ActionResult<T>> {
  const actor = actorFor(await requireCurrentSession(subscribersHref(slugValue)));
  try {
    const community = await getCommunitiesService().getCommunityBySlug(actor, slugValue);
    const data = await fn({ actor, community });
    revalidatePath(subscribersHref(community.slug));
    return { ok: true, data };
  } catch (error) {
    const handled = paymentsActionFailure(error, "creator");
    if (handled) return handled;
    throw error;
  }
}

export async function addMovesAction(raw: AddMovesActionInput): Promise<ActionResult<number>> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check the list and try again.");
  }
  const rows = parseMoveLines(parsed.data.lines, parsed.data.freeUntil || null);
  if (!rows.ok) return failure(rows.message);
  return inCommunity(parsed.data.slug, async ({ actor, community }) => {
    const { saved } = await getPaymentsService().addSubscriberMoves(actor, community.id, {
      source: "manual",
      rows: rows.rows,
    });
    return saved;
  });
}

export async function addImportedMovesAction(
  raw: AddImportedMovesActionInput,
): Promise<ActionResult<number>> {
  const parsed = importedSchema.safeParse(raw);
  if (!parsed.success) return failure("Reload the page and try again.");
  return inCommunity(parsed.data.slug, async ({ actor, community }) => {
    const job = await getMigrationService().getJob(actor, community.id, parsed.data.jobId);
    const imported = job.kind === "import" ? importedMoves([job]) : null;
    if (!imported) return 0;
    const { saved } = await getPaymentsService().addSubscriberMoves(actor, community.id, {
      source: imported.source,
      jobId: imported.jobId,
      rows: [...imported.rows],
    });
    return saved;
  });
}

export async function remindMovesAction(raw: { slug: string }): Promise<ActionResult<number>> {
  const parsed = remindSchema.safeParse(raw);
  if (!parsed.success) return failure("Reload the page and try again.");
  return inCommunity(parsed.data.slug, async ({ actor, community }) => {
    const reminders = await getPaymentsService().claimMoveReminders(actor, community.id);
    const brand = await communityEmailBrandFor(community.id);
    let sent = 0;
    for (const reminder of reminders) {
      try {
        const optOut = communityOptOutLinks(reminder.email, community.id);
        await getEmailOutbox().send({
          template: "moving-offer",
          to: reminder.email,
          communityId: community.id,
          headers: optOut.headers,
          data: {
            communityName: community.name,
            communityBrand: brand,
            email: reminder.email,
            url: `${appUrl()}${membershipHref(community.slug)}`,
            freeUntil: reminder.freeUntil?.toISOString() ?? null,
            from: movedFrom(reminder.source),
            optOutUrl: optOut.url,
          },
        });
        sent += 1;
      } catch (error) {
        logger.error(
          {
            reason: error instanceof Error ? error.name : "unknown",
          },
          "Could not queue a moving offer email",
        );
      }
    }
    return sent;
  });
}
