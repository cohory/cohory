import { userInfo } from "node:os";
import { parseArgs } from "node:util";

import { z } from "zod";

import {
  getEmailLog,
  getSuppressionList,
  hashEmailAddress,
  maskEmailAddress,
  operatorActor,
  recordSuppressionChange,
} from "../src/index";

const usage = `Usage:
  pnpm email:suppress add you@example.com [--community <community id>] [--actor <name>]
  pnpm email:suppress remove you@example.com [--community <community id>] [--actor <name>]
  pnpm email:suppress check you@example.com [--community <community id>]

add stops every email except account security email (password reset, sign in links,
address confirmation) to the address. With --community it stops only email about that
community. remove lifts exactly that entry. add and remove write an audit row to the
email log with the operator name (--actor, or your system user name).`;

const argsSchema = z.object({
  command: z.enum(["add", "remove", "check"]),
  email: z.email(),
  community: z.uuid().optional(),
  actor: z.string().optional(),
});

const { values, positionals } = parseArgs({
  options: { community: { type: "string" }, actor: { type: "string" } },
  allowPositionals: true,
});
const args = argsSchema.safeParse({
  command: positionals[0],
  email: positionals[1],
  community: values.community,
  actor: values.actor,
});
if (!args.success) {
  console.error(usage);
  process.exit(2);
}

function systemUser(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

const { command, email, community } = args.data;
const actor = operatorActor(args.data.actor ?? systemUser());
const masked = maskEmailAddress(email);
const addressHash = hashEmailAddress(email);
const scope = community ? `email about community ${community}` : "all email except security email";
const list = getSuppressionList();

try {
  switch (command) {
    case "add":
      await list.suppress({
        addressHash,
        communityId: community ?? null,
        reason: "manual",
        source: "operator",
      });
      await recordSuppressionChange(getEmailLog(), { change: "added", addressHash, actor });
      console.info(`Suppressed ${scope} to ${masked}.`);
      break;
    case "remove": {
      const removed = await list.lift({ addressHash, communityId: community ?? null });
      if (removed > 0) {
        await recordSuppressionChange(getEmailLog(), { change: "removed", addressHash, actor });
      }
      console.info(
        removed > 0 ? `Lifted the suppression of ${scope} to ${masked}.` : "Nothing to lift.",
      );
      break;
    }
    case "check": {
      const reason = await list.suppressionReason({ addressHash, communityId: community });
      console.info(reason ? `Suppressed (${reason}).` : "Not suppressed.");
      break;
    }
  }
  process.exit(0);
} catch (error) {
  console.error(
    `Could not ${command} the suppression: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
