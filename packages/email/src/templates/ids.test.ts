import { describe, expect, it } from "vitest";

import { emailMessageSchema } from "../message";
import { securityEmailTemplates } from "../suppression";
import { emailTemplateIds } from "./ids";

const message = {
  to: "ada@example.com",
  subject: "Hello",
  text: "text",
  html: "<p>html</p>",
};

describe("email template ids", () => {
  it("accepts a known template id on a message", () => {
    expect(emailMessageSchema.safeParse({ ...message, template: "password-reset" }).success).toBe(
      true,
    );
  });

  it("refuses a free string, so no message can claim an exemption by name", () => {
    expect(emailMessageSchema.safeParse({ ...message, template: "password-resets" }).success).toBe(
      false,
    );
    expect(emailMessageSchema.safeParse({ ...message, template: "newsletter" }).success).toBe(
      false,
    );
  });

  it("only exempts ids that templates really use", () => {
    for (const id of securityEmailTemplates) {
      expect(emailTemplateIds).toContain(id);
    }
  });

  it("knows the legal templates and does not exempt them from suppression", () => {
    for (const id of [
      "data-export-ready",
      "content-report",
      "content-report-received",
      "contact-message",
      "creator-feedback",
      "early-access-request",
    ]) {
      expect(emailTemplateIds).toContain(id);
      expect([...securityEmailTemplates]).not.toContain(id);
    }
  });
});
