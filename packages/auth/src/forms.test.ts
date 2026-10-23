import { describe, expect, it } from "vitest";

import {
  changePasswordSchema,
  forgotPasswordSchema,
  parseForm,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./forms";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

describe("parseForm", () => {
  it("returns trimmed values for a valid sign in", () => {
    const result = parseForm(
      signInSchema,
      formData({ email: "  ada@example.test ", password: "pw" }),
    );

    expect(result).toEqual({
      success: true,
      data: { email: "ada@example.test", password: "pw" },
    });
  });

  it("returns one plain message per invalid field", () => {
    const result = parseForm(signInSchema, formData({ email: "ada", password: "" }));

    expect(result).toEqual({
      success: false,
      fieldErrors: {
        email: "Enter an email address, like name@example.com",
        password: "Enter your password.",
      },
    });
  });

  it("treats a missing field as empty", () => {
    const result = parseForm(forgotPasswordSchema, new FormData());

    expect(result).toMatchObject({ success: false, fieldErrors: { email: expect.any(String) } });
  });
});

describe("signUpSchema", () => {
  it("requires a name and a password of at least 8 characters", () => {
    const result = parseForm(
      signUpSchema,
      formData({ name: " ", email: "ada@example.test", password: "short" }),
    );

    expect(result).toEqual({
      success: false,
      fieldErrors: {
        name: "Enter your name.",
        password: "Use at least 8 characters.",
      },
    });
  });

  it("rejects a password longer than 128 characters", () => {
    const result = parseForm(
      signUpSchema,
      formData({ name: "Ada", email: "ada@example.test", password: "x".repeat(129) }),
    );

    expect(result).toMatchObject({ fieldErrors: { password: "Use 128 characters or fewer." } });
  });

  it("limits the name to the 80 characters the server accepts", () => {
    const result = parseForm(
      signUpSchema,
      formData({ name: "a".repeat(81), email: "ada@example.test", password: "long enough" }),
    );

    expect(result).toMatchObject({
      fieldErrors: { name: "Use 80 characters or fewer for your name." },
    });
  });
});

describe("resetPasswordSchema", () => {
  it("requires the confirmation to match", () => {
    const result = parseForm(
      resetPasswordSchema,
      formData({ password: "long enough", confirmPassword: "different one" }),
    );

    expect(result).toEqual({
      success: false,
      fieldErrors: { confirmPassword: "The passwords do not match." },
    });
  });

  it("accepts matching passwords", () => {
    const result = parseForm(
      resetPasswordSchema,
      formData({ password: "long enough", confirmPassword: "long enough" }),
    );

    expect(result.success).toBe(true);
  });
});

describe("messages", () => {
  it("use no exclamation marks", () => {
    const results = [
      parseForm(signUpSchema, new FormData()),
      parseForm(signInSchema, new FormData()),
      parseForm(resetPasswordSchema, new FormData()),
    ];

    expect(JSON.stringify(results)).not.toContain("!");
  });
});

describe("changePasswordSchema", () => {
  it("asks for the current password and a matching new one", () => {
    const form = new FormData();
    form.set("currentPassword", "");
    form.set("password", "a new passphrase");
    form.set("confirmPassword", "another passphrase");

    const result = parseForm(changePasswordSchema, form);

    expect(result).toEqual({
      success: false,
      fieldErrors: {
        currentPassword: "Enter your current password.",
        confirmPassword: "The passwords do not match.",
      },
    });
  });
});
