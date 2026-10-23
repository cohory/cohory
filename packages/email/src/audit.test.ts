import { describe, expect, it } from "vitest";

import { maskEmailAddress, operatorActor, recordSuppressionChange } from "./audit";
import type { EmailLogEntry } from "./log";
import { hashEmailAddress } from "./log";

function memoryLog() {
  const entries: EmailLogEntry[] = [];
  return { entries, record: async (entry: EmailLogEntry) => void entries.push(entry) };
}

describe("maskEmailAddress", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmailAddress("ada.lovelace@example.com")).toBe("a***@example.com");
  });

  it("masks a one character local part completely", () => {
    expect(maskEmailAddress("a@example.com")).toBe("***@example.com");
  });

  it("masks a value without a domain completely", () => {
    expect(maskEmailAddress("not-an-address")).toBe("***");
  });
});

describe("operatorActor", () => {
  it("keeps a plain user name", () => {
    expect(operatorActor("ops-anna")).toBe("ops-anna");
  });

  it("drops characters that could forge another field and caps the length", () => {
    expect(operatorActor("eve;batch=x n=1")).toBe("evebatchxn1");
    expect(operatorActor("x".repeat(80))).toHaveLength(48);
  });

  it("falls back to unknown when nothing usable is left", () => {
    expect(operatorActor(";;;")).toBe("unknown");
    expect(operatorActor(undefined)).toBe("unknown");
  });
});

describe("recordSuppressionChange", () => {
  const addressHash = hashEmailAddress("ada@example.com");

  it("writes an added row naming the operator", async () => {
    const log = memoryLog();

    await recordSuppressionChange(log, { change: "added", addressHash, actor: "ops-anna" });

    expect(log.entries).toEqual([
      {
        template: "suppression-added",
        recipientHash: addressHash,
        status: "suppressed",
        errorCode: "operator=ops-anna",
      },
    ]);
  });

  it("leaves a trace when an operator lifts a suppression", async () => {
    const log = memoryLog();

    await recordSuppressionChange(log, { change: "removed", addressHash, actor: "ops-anna" });

    expect(log.entries[0]).toMatchObject({
      template: "suppression-removed",
      recipientHash: addressHash,
      errorCode: "operator=ops-anna",
    });
  });

  it("keeps every audit row within the log column limits", async () => {
    const log = memoryLog();

    await recordSuppressionChange(log, {
      change: "webhook",
      addressHash,
      batchId: "0192a1b2-0000-7000-8000-000000000001",
      count: 100,
    });

    const [entry] = log.entries;
    expect(entry?.template).toBe("suppression-webhook");
    expect(entry?.errorCode).toBe("batch=0192a1b2-0000-7000-8000-000000000001;n=100");
    expect(entry?.errorCode?.length).toBeLessThanOrEqual(64);
  });
});
