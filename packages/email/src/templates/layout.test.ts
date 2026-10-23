import { describe, expect, it } from "vitest";

import { visibleCopy } from "../test/copy";
import { buildEmail, renderLayout } from "./layout";

const base = {
  title: "Confirm your email address",
  preheader: "The link works for 1 hour.",
  brand: { kind: "instance" } as const,
  body: ["Hi Ada,", "Confirm that this is your email address."],
  cta: { label: "Confirm email address", url: "https://club.example.com/verify?token=a&b=1" },
};

describe("renderLayout", () => {
  const { html, text } = renderLayout(base);

  it("declares viewport, color scheme, and title in the head", () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">\n<head>/);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain("<title>Confirm your email address</title>");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("#0E131B");
  });

  it("puts the preheader first in the body, hidden, and keeps it out of the text part", () => {
    const body = html.slice(html.indexOf("<body"));
    expect(body.indexOf("The link works for 1 hour.")).toBeLessThan(body.indexOf("Hi Ada,"));
    expect(html).toMatch(/<div style="display:none;[^"]*"[^>]*>The link works for 1 hour\./);
    expect(text).not.toContain("The link works for 1 hour.");
  });

  it("links the call to action as a button and keeps the raw URL out of the html", () => {
    expect(html).toContain('href="https://club.example.com/verify?token=a&amp;b=1"');
    expect(html.split("https://club.example.com/verify")).toHaveLength(2);
    expect(html).not.toContain("copy this link");
  });

  it("keeps the raw URL in the text part", () => {
    expect(text).toContain("Confirm email address: https://club.example.com/verify?token=a&b=1");
    expect(text.indexOf("Hi Ada,")).toBe(0);
  });

  it("shows the instance name in the header and footer of account emails", () => {
    expect(html).toContain(">Cohory</");
    expect(text).toContain("Sent by Cohory.");
  });

  it("escapes markup in every slot", () => {
    const hostile = renderLayout({
      ...base,
      title: "<t>",
      preheader: "<p>",
      body: ["<script>x</script>"],
      cta: { label: "<b>", url: 'https://x.test/"onmouseover=' },
    });
    expect(hostile.html).not.toMatch(/<script>|<b>|<t>|"onmouseover/);
  });

  it("renders link and list blocks in both parts", () => {
    const result = renderLayout({
      ...base,
      body: [
        { kind: "link", label: "Add it to your calendar", url: "https://x.test/e.ics" },
        {
          kind: "list",
          items: [{ label: "Ada posted", url: "https://x.test/p1", note: "in Makers" }],
        },
      ],
    });
    expect(result.text).toContain("Add it to your calendar: https://x.test/e.ics");
    expect(result.text).toContain("Ada posted in Makers\nhttps://x.test/p1");
    expect(result.html).toContain('<a href="https://x.test/e.ics"');
    expect(result.html).toMatch(
      /<li[^>]*><a href="https:\/\/x.test\/p1"[^>]*>Ada posted<\/a> in Makers<\/li>/,
    );
  });

  it("renders the footer reason and links", () => {
    const result = renderLayout({
      ...base,
      footer: {
        why: "You get this email because email for mentions is on.",
        links: [{ label: "Stop these emails", url: "https://x.test/u" }],
      },
    });
    expect(result.text).toContain("You get this email because email for mentions is on.");
    expect(result.text).toContain("Stop these emails: https://x.test/u");
    expect(result.html).toContain('href="https://x.test/u"');
  });
});

describe("community branding", () => {
  const community = { kind: "community", name: "Design Club" } as const;

  it("shows the community initial tile and name when there is no logo", () => {
    const { html } = renderLayout({ ...base, brand: community });
    expect(html).toContain(">D</");
    expect(html).toContain(">Design Club</");
    expect(html).not.toContain("<img");
  });

  it("shows an https logo with the community name as alt text", () => {
    const { html } = renderLayout({
      ...base,
      brand: { ...community, logoUrl: "https://cdn.example.com/logo.png" },
    });
    expect(html).toContain('<img src="https://cdn.example.com/logo.png" alt="Design Club"');
  });

  it("ignores a logo that is not an absolute https URL", () => {
    for (const logoUrl of [
      "/uploads/logo.png",
      "http://cdn.example.com/logo.png",
      "javascript:x",
    ]) {
      expect(renderLayout({ ...base, brand: { ...community, logoUrl } }).html).not.toContain(
        "<img",
      );
    }
  });

  it("paints the button with the accent and a readable foreground", () => {
    const dark = renderLayout({ ...base, brand: { ...community, accent: "#7C3AED" } }).html;
    expect(dark).toContain("background-color:#7C3AED;color:#FFFFFF");

    const light = renderLayout({ ...base, brand: { ...community, accent: "#FDE047" } }).html;
    expect(light).toContain("background-color:#FDE047;color:#111827");
  });

  it("falls back to the default accent when the value is not a hex color", () => {
    const { html } = renderLayout({
      ...base,
      brand: { ...community, accent: "red;background:url(x)" },
    });
    expect(html).toContain("background-color:#2563EB;color:#FFFFFF");
    expect(html).not.toContain("url(x)");
  });

  it("falls back to the default accent when neither foreground reaches 4.5 to 1", () => {
    const { html } = renderLayout({ ...base, brand: { ...community, accent: "#808080" } });
    expect(html).toContain("background-color:#2563EB");
  });
});

describe("buildEmail", () => {
  it("prefixes community subjects and sends as the community via the instance", () => {
    const email = buildEmail({
      template: "comp-invitation",
      subject: "You're offered free access",
      preheader: "No payment needed.",
      brand: { kind: "community", name: "Design Club" },
      body: ["Hello"],
    });
    expect(email.subject).toBe("[Design Club] You're offered free access");
    expect(email.fromName).toBe("Design Club via Cohory");
    expect(email.template).toBe("comp-invitation");
  });

  it("leaves account subjects without a prefix and sends as the instance", () => {
    const email = buildEmail({
      template: "password-reset",
      subject: "Reset your Cohory password",
      preheader: "The link works for 1 hour.",
      brand: { kind: "instance" },
      body: ["Hello"],
    });
    expect(email.subject).toBe("Reset your Cohory password");
    expect(email.fromName).toBe("Cohory");
  });

  it("strips line breaks and control characters from the sender name", () => {
    const email = buildEmail({
      template: "notification",
      subject: "x",
      preheader: "x",
      brand: { kind: "community", name: "Evil\r\nBcc: a@b.test\u0007" },
      body: ["x"],
    });
    expect(email.fromName).toBe("Evil Bcc: a@b.test via Cohory");
  });
});

describe("visibleCopy", () => {
  it("drops the doctype and style block so tests can check the copy", () => {
    const { html } = renderLayout(base);
    expect(visibleCopy(html)).not.toContain("important");
    expect(visibleCopy(html)).toContain("Hi Ada,");
  });
});
