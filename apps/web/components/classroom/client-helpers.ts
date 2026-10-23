import type { AgentFileValue, LessonAttachment } from "@cohory/ui";
import { z } from "zod";

import { attachmentHref, uploadHref } from "../../lib/courses/hrefs";
import { uploadPostImage } from "../feed/client-helpers";

const attachmentSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  size: z.number(),
  contentType: z.string().min(1),
});
const errorSchema = z.object({ error: z.object({ message: z.string() }) });

export async function uploadLessonAttachment(
  slug: string,
  courseId: string,
  file: File,
): Promise<LessonAttachment> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(
    `/api/v1/communities/${encodeURIComponent(slug)}/courses/${encodeURIComponent(courseId)}/uploads/attachment`,
    { method: "POST", body, credentials: "same-origin" },
  );
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(json);
    throw new Error(parsed.success ? parsed.data.error.message : "The file didn't upload.");
  }
  const ref = attachmentSchema.parse(json);
  return { id: ref.key, ...ref, href: attachmentHref(ref.key) };
}

const agentFileSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
  mediaType: z.string().min(1),
  size: z.number(),
  sha256: z.string().min(1),
});

export async function uploadAgentFile(
  slug: string,
  courseId: string,
  file: File,
): Promise<AgentFileValue> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(
    `/api/v1/communities/${encodeURIComponent(slug)}/courses/${encodeURIComponent(courseId)}/uploads/agent-file`,
    { method: "POST", body, credentials: "same-origin" },
  );
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(json);
    throw new Error(parsed.success ? parsed.data.error.message : "The file didn't upload.");
  }
  return agentFileSchema.parse(json);
}

export async function uploadLessonImage(slug: string, file: File): Promise<{ src: string }> {
  const uploaded = await uploadPostImage(slug, file);
  return { src: uploadHref(uploaded.key) };
}
