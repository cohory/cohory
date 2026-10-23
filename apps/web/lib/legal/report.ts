import { z } from "zod";

export const reportReasons = [
  "Illegal content",
  "Copyright or trademark",
  "Harm to a child",
  "Breaks the Community Guidelines",
  "Other",
] as const;

export const contentReportSchema = z.object({
  pageUrl: z
    .url({
      protocol: /^https?$/,
      error: "Paste the full address of the page, starting with https.",
    })
    .max(2000),
  reason: z.enum(reportReasons, { error: "Choose a reason." }),
  details: z
    .string()
    .trim()
    .min(10, "Tell us what is wrong in at least 10 characters.")
    .max(2000, "Keep the details under 2000 characters."),
  goodFaith: z.literal("on", {
    error: "Confirm that the report is accurate and made in good faith.",
  }),
});

export type ContentReport = z.output<typeof contentReportSchema>;

export function parseContentReport(formData: FormData) {
  return contentReportSchema.safeParse({
    pageUrl: formData.get("pageUrl") ?? "",
    reason: formData.get("reason") ?? "",
    details: formData.get("details") ?? "",
    goodFaith: formData.get("goodFaith") ?? "",
  });
}
