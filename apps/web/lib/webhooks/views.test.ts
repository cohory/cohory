import { describe, expect, it } from "vitest";

import {
  attemptResult,
  deliveryResult,
  eventLabel,
  toDeliveryDetailRow,
  type DeliveryRow,
} from "./views";

const row: DeliveryRow = {
  id: "d",
  eventId: "evt",
  eventType: "post.created",
  status: "pending",
  attempts: 0,
  responseStatus: null,
  lastError: null,
  lastAttemptAt: null,
  nextAttemptAt: null,
  createdAt: "2026-10-19T10:00:00.000Z",
};

describe("webhook views", () => {
  it("labels events in plain language", () => {
    expect(eventLabel("member.removed")).toBe("Member left or was removed");
    expect(eventLabel("webhook.test")).toBe("Test event");
  });

  it("describes each delivery result", () => {
    expect(deliveryResult(row)).toBe("Waiting to send");
    expect(deliveryResult({ ...row, status: "succeeded", responseStatus: 204 })).toBe(
      "Delivered (204)",
    );
    expect(deliveryResult({ ...row, lastError: "http_503" })).toBe("Answered 503");
    expect(deliveryResult({ ...row, status: "failed", lastError: "timeout" })).toBe(
      "No answer within 10 seconds",
    );
  });

  it("describes each attempt by its answer or its error", () => {
    expect(attemptResult({ responseStatus: 204, errorCode: null })).toBe("Answered 204");
    expect(attemptResult({ responseStatus: 500, errorCode: "http_500" })).toBe("Answered 500");
    expect(attemptResult({ responseStatus: null, errorCode: "connection_failed" })).toBe(
      "Could not connect",
    );
  });

  it("shapes a delivery detail for the browser without dates or extra fields", () => {
    const at = new Date("2026-10-19T10:00:05.000Z");
    const detail = toDeliveryDetailRow({
      delivery: {
        ...row,
        status: "failed",
        lastAttemptAt: at,
        nextAttemptAt: null,
        createdAt: new Date(row.createdAt),
      },
      payload: { type: "webhook.test", timestamp: row.createdAt, data: { communityId: "c" } },
      attempts: [
        {
          at,
          requestHeaders: { "webhook-id": "evt", "content-type": "application/json" },
          requestBody: '{"type":"webhook.test"}',
          responseStatus: null,
          responseBodyExcerpt: null,
          errorCode: "timeout",
          durationMs: 10_000,
        },
      ],
    });
    expect(detail.payload).toBe(
      JSON.stringify(
        { type: "webhook.test", timestamp: row.createdAt, data: { communityId: "c" } },
        null,
        2,
      ),
    );
    expect(detail.attempts).toEqual([
      {
        at: "2026-10-19T10:00:05.000Z",
        headers: [
          ["content-type", "application/json"],
          ["webhook-id", "evt"],
        ],
        body: '{\n  "type": "webhook.test"\n}',
        responseStatus: null,
        responseBodyExcerpt: null,
        errorCode: "timeout",
        durationMs: 10_000,
      },
    ]);
  });
});
