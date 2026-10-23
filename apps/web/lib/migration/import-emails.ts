import type { ImportEmailHandlers, ImportEmailPreview } from "@cohory/ui";
import { z } from "zod";

const errorSchema = z.object({ error: z.object({ message: z.string() }) });
const previewSchema = z.object({ subject: z.string(), text: z.string() });

async function post(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(json);
    throw new Error(
      parsed.success ? parsed.data.error.message : "Something went wrong. Try again.",
    );
  }
  return json;
}

function noteBody(note: string): { note?: string } {
  const trimmed = note.trim();
  return trimmed ? { note: trimmed } : {};
}

export function importEmailHandlers(base: string, jobId: string | null): ImportEmailHandlers {
  if (!jobId) return {};
  return {
    async onPreviewEmail(note: string): Promise<ImportEmailPreview> {
      return previewSchema.parse(await post(`${base}/jobs/${jobId}/email-preview`, noteBody(note)));
    },
    async onSendTestEmail(note: string): Promise<void> {
      await post(`${base}/jobs/${jobId}/test-email`, noteBody(note));
    },
  };
}

export async function sendImportEmails(base: string, jobId: string): Promise<unknown> {
  return post(`${base}/imports/${jobId}/emails`, {});
}

export async function resendImportEmail(base: string, userId: string): Promise<boolean> {
  const parsed = z
    .object({ sent: z.boolean() })
    .parse(await post(`${base}/members/${userId}/resend-email`, {}));
  return parsed.sent;
}
