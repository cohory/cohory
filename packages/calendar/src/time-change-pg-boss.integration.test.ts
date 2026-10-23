import { newId } from "@cohory/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { openTestDb } from "./test/fixtures";
import { timeChangeJob, type TimeChangeJobInput } from "./time-change";
import { createPgBossCalendarQueue } from "./time-change-pg-boss";

const admin = openTestDb();

afterAll(async () => {
  await admin.close();
});

function payload(eventId: string, part: "baseline" | "removals"): TimeChangeJobInput {
  return {
    communityId: newId(),
    eventId,
    editorId: null,
    changedAt: new Date().toISOString(),
    previousZone: "Europe/Berlin",
    baseline:
      part === "baseline"
        ? [{ occurrenceId: newId(), previousStart: "2031-01-01T10:00:00.000Z" }]
        : [],
    removals:
      part === "removals" ? [{ userId: newId(), starts: ["2031-01-08T10:00:00.000Z"] }] : [],
  };
}

async function queued(eventId: string) {
  const rows = await admin.db.execute<{ baseline: string; removals: string }>(
    sql.raw(
      `select jsonb_array_length(data->'baseline')::text as baseline,
        jsonb_array_length(data->'removals')::text as removals
       from pgboss.job where name = '${timeChangeJob}' and data->>'eventId' = '${eventId}'
       and state = 'created' order by created_on`,
    ),
  );
  return rows.rows;
}

describe("calendar time change queue", () => {
  it("keeps one waiting move job per event and every removal job", async () => {
    const queue = createPgBossCalendarQueue();
    const eventId = newId();

    await queue.scheduleTimeChange(payload(eventId, "baseline"));
    await queue.scheduleTimeChange(payload(eventId, "baseline"));
    await queue.scheduleTimeChange(payload(eventId, "removals"));
    await queue.scheduleTimeChange(payload(eventId, "removals"));

    expect(await queued(eventId)).toEqual([
      { baseline: "1", removals: "0" },
      { baseline: "0", removals: "1" },
      { baseline: "0", removals: "1" },
    ]);
  });
});
