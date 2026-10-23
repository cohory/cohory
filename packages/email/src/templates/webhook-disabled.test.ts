import { describe, expect, it } from "vitest";

import { webhookEndpointDisabledEmail } from "./webhook-disabled";

describe("webhookEndpointDisabledEmail", () => {
  const email = webhookEndpointDisabledEmail({
    communityName: "Makers",
    endpointHost: "hooks.example.com",
    url: "https://cohory.test/c/makers/manage/settings/webhooks",
  });

  it("names the community, the receiver, and the way back", () => {
    expect(email.subject).toBe("[Makers] A webhook endpoint was turned off");
    expect(email.text).toContain("hooks.example.com");
    expect(email.text).toContain("https://cohory.test/c/makers/manage/settings/webhooks");
    expect(email.html).toContain("Open Webhooks");
  });

  it("escapes the receiver host in HTML", () => {
    const hostile = webhookEndpointDisabledEmail({
      communityName: "Makers",
      endpointHost: "<b>x</b>",
      url: "https://cohory.test/",
    });
    expect(hostile.html).not.toContain("<b>x</b>");
  });
});
