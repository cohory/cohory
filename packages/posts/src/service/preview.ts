export const notificationPreviewMaxLength = 140;

export function notificationPreview(title: string | null, bodyText: string): string | undefined {
  const line =
    title?.trim() ||
    bodyText
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part !== "") ||
    "";
  if (line === "") {
    return undefined;
  }
  return line.length > notificationPreviewMaxLength
    ? `${line.slice(0, notificationPreviewMaxLength - 3).trimEnd()}...`
    : line;
}
