import { createLogger } from "@cohory/infra/logger";
import type { Job } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  COMMUNITIES_CREATORS_INVITE,
  createCreatorsInviteHandler,
  creatorsInviteMessage,
  type InviteCreator,
} from "./jobs/communities-creators-invite";

const silentLogger = createLogger({ level: "silent" });
const communityId = "0192f2a4-0000-7000-8000-000000000001";
const creatorsId = "0192f2a4-0000-7000-8000-000000000002";

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000007",
    name: COMMUNITIES_CREATORS_INVITE,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

describe("creators invite job", () => {
  it("asks the communities service to invite the creator of the community", async () => {
    const inviteCreator = vi.fn<InviteCreator>().mockResolvedValue("sent");
    await createCreatorsInviteHandler(
      silentLogger,
      inviteCreator,
    )([job({ communityId, trigger: "created" })]);
    expect(inviteCreator).toHaveBeenCalledWith({ communityId, trigger: "created" });
  });

  it("fails a malformed payload instead of guessing", async () => {
    const inviteCreator = vi.fn<InviteCreator>();
    await expect(
      createCreatorsInviteHandler(silentLogger, inviteCreator)([job({ communityId: "x" })]),
    ).rejects.toThrow();
    expect(inviteCreator).not.toHaveBeenCalled();
  });

  it("sends the invite as an email of the creators community with a one click opt out", () => {
    const message = creatorsInviteMessage(
      {
        to: "ada@example.test",
        name: "Ada",
        inviterName: "Riza",
        community: {
          id: creatorsId,
          slug: "cohory-creators",
          name: "Cohory Creators",
        },
        url: "https://cohory.test/join/abc",
        expiresAt: new Date("2026-11-22T09:00:00.000Z"),
      },
      {
        url: "https://cohory.test/email-opt-out?token=t",
        headers: { "List-Unsubscribe": "<https://cohory.test/api/email-opt-out?token=t>" },
      },
    );
    expect(message).toMatchObject({
      to: "ada@example.test",
      communityId: creatorsId,
      template: "creators-invite",
      headers: { "List-Unsubscribe": "<https://cohory.test/api/email-opt-out?token=t>" },
    });
    expect(message.text).toContain("https://cohory.test/join/abc");
    expect(message.text).toContain("https://cohory.test/email-opt-out?token=t");
  });
});
