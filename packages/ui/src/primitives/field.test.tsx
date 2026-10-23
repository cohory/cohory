import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Field } from "./field";
import { Input } from "./input";

function attributes(markup: string, tag: string): Record<string, string> {
  const element = markup.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
  return Object.fromEntries(
    [...element.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, name = "", value = ""]) => [
      name,
      value,
    ]),
  );
}

describe("Field", () => {
  it("binds the label to the control", () => {
    const markup = renderToStaticMarkup(
      <Field label="Email">{(control) => <Input type="email" {...control} />}</Field>,
    );

    const label = attributes(markup, "label");
    const input = attributes(markup, "input");
    expect(label["for"]).toBeDefined();
    expect(label["for"]).toBe(input["id"]);
    expect(markup).toContain(">Email</label>");
  });

  it("links the error message with aria-describedby and marks the control invalid", () => {
    const markup = renderToStaticMarkup(
      <Field label="Email" error="Enter an email address, like name@example.com">
        {(control) => <Input type="email" {...control} />}
      </Field>,
    );

    const input = attributes(markup, "input");
    const message = attributes(markup, "p");
    expect(input["aria-invalid"]).toBe("true");
    expect(input["aria-describedby"]).toBe(message["id"]);
    expect(markup).toContain("Enter an email address, like name@example.com");
  });

  it("links both the description and the error", () => {
    const markup = renderToStaticMarkup(
      <Field label="Password" description="At least 8 characters." error="Too short.">
        {(control) => <Input type="password" {...control} />}
      </Field>,
    );

    const describedBy = attributes(markup, "input")["aria-describedby"]?.split(" ") ?? [];
    expect(describedBy).toHaveLength(2);
    for (const id of describedBy) {
      expect(markup).toContain(`id="${id}"`);
    }
  });

  it("leaves the control valid without an error", () => {
    const markup = renderToStaticMarkup(
      <Field label="Name">{(control) => <Input {...control} />}</Field>,
    );

    expect(attributes(markup, "input")["aria-invalid"]).toBeUndefined();
    expect(attributes(markup, "input")["aria-describedby"]).toBeUndefined();
  });

  it("puts a hint behind an information button and still describes the control with it", () => {
    const markup = renderToStaticMarkup(
      <Field label="Last active" hint="Counts posts and sign ins.">
        {(control) => <Input {...control} />}
      </Field>,
    );

    const button = attributes(markup, "button");
    expect(button["aria-label"]).toBe("About Last active");
    expect(button["class"]).toContain("touch-hit");
    expect(markup).toContain(">Last active</label>");
    const describedBy = attributes(markup, "input")["aria-describedby"] ?? "";
    expect(describedBy).not.toBe("");
    expect(markup).toMatch(new RegExp(`id="${describedBy}"[^>]*>Counts posts and sign ins.<`));
  });
});
