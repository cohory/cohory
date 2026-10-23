import { z } from "zod";

// Values from public forms can reach a mail header (a name, a Reply-To address), so none of
// them may hold a control character such as a line break.
export const singleLine = /^[^\p{Cc}]*$/u;

export const replyToEmail = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ error: "Enter a valid email address." }));

export const honeypotField = z.string().max(500).default("");
export const formTokenField = z.string().max(200).default("");
