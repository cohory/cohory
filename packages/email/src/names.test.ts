import { describe, expect, it } from "vitest";

import { emailGreeting, emailSafeName } from "./names";

describe("emailSafeName", () => {
  it("keeps an ordinary name", () => {
    expect(emailSafeName("Rev Joiner18")).toBe("Rev Joiner18");
    expect(emailSafeName("José O'Neil-Smith")).toBe("José O'Neil-Smith");
  });

  it("drops a name that looks like a formula, an email address, or a link", () => {
    expect(emailSafeName('=HYPERLINK("http://x")')).toBeNull();
    expect(emailSafeName("+1 555 0100")).toBeNull();
    expect(emailSafeName("@admin")).toBeNull();
    expect(emailSafeName("ada@example.com")).toBeNull();
    expect(emailSafeName("example.com")).toBeNull();
    expect(emailSafeName("https://evil.example/login")).toBeNull();
  });

  it("strips links and control characters inside a name", () => {
    expect(emailSafeName("Ada visit https://evil.example/login now")).toBe("Ada visit now");
    expect(emailSafeName("Ada www.evil.example")).toBe("Ada");
    expect(emailSafeName("Ada\r\nBcc: x‮evil")).toBe("Ada Bcc: x evil");
  });

  it("caps a name at 50 characters", () => {
    const long = "A".repeat(80);
    expect(emailSafeName(long)).toBe("A".repeat(50));
  });

  it("returns nothing for an empty name", () => {
    expect(emailSafeName("   ")).toBeNull();
    expect(emailSafeName(null)).toBeNull();
  });
});

describe("emailGreeting", () => {
  it("greets by a safe name and without one otherwise", () => {
    expect(emailGreeting("Ada")).toBe("Hi Ada,");
    expect(emailGreeting('=HYPERLINK("http://x")')).toBe("Hi,");
    expect(emailGreeting(null)).toBe("Hi,");
  });
});
