import { isBrandingKey, isGalleryKey } from "@cohory/communities";
import { isPublicKey, isStorageKey, type StorageKey } from "@cohory/storage";

export type UploadKind =
  | { readonly kind: "avatar"; readonly key: StorageKey }
  | { readonly kind: "branding"; readonly key: StorageKey }
  | { readonly kind: "post-image"; readonly key: StorageKey; readonly communityId: string }
  | {
      readonly kind: "course-attachment";
      readonly key: StorageKey;
      readonly communityId: string;
      readonly courseId: string;
      readonly extension: string;
    }
  | { readonly kind: "unknown" };

export type ImageAccess =
  | { readonly kind: "public"; readonly key: StorageKey; readonly immutable?: true }
  | { readonly kind: "members"; readonly key: StorageKey }
  | {
      readonly kind: "attachment";
      readonly key: StorageKey;
      readonly extension: string;
      readonly filename: string;
    }
  | { readonly kind: "denied" };

export type Viewer =
  { readonly kind: "guest" } | { readonly kind: "user"; readonly userId: string };

export interface ImageAccessDeps {
  canReadPosts(viewer: Viewer, communityId: string): Promise<boolean>;
  attachmentFor(
    viewer: Viewer,
    communityId: string,
    key: StorageKey,
  ): Promise<{ name: string } | null>;
  currentViewer(): Promise<Viewer>;
}

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const postImageKey = new RegExp(
  `^communities\\/(${uuid})\\/posts\\/[A-Za-z0-9][A-Za-z0-9_-]*\\.(png|jpg|jpeg|webp|gif)$`,
  "i",
);

const courseAttachmentKey = new RegExp(
  `^communities\\/(${uuid})\\/courses\\/(${uuid})\\/attachments\\/${uuid}\\.(pdf|zip|png|jpg|md|txt|csv)$`,
);

export function classifyUploadKey(raw: string): UploadKind {
  if (!isStorageKey(raw)) return { kind: "unknown" };
  if (isPublicKey(raw)) return { kind: "avatar", key: raw };
  if (isBrandingKey(raw) || isGalleryKey(raw)) return { kind: "branding", key: raw };
  const attachment = courseAttachmentKey.exec(raw);
  if (attachment?.[1] && attachment[2] && attachment[3]) {
    return {
      kind: "course-attachment",
      key: raw,
      communityId: attachment[1],
      courseId: attachment[2],
      extension: attachment[3],
    };
  }
  const match = postImageKey.exec(raw);
  const communityId = match?.[1];
  return communityId
    ? { kind: "post-image", key: raw, communityId: communityId.toLowerCase() }
    : { kind: "unknown" };
}

export interface ImageAccessRequest {
  readonly requestedName?: string | null;
}

export async function resolveImageAccess(
  raw: string,
  deps: ImageAccessDeps,
  request: ImageAccessRequest = {},
): Promise<ImageAccess> {
  const upload = classifyUploadKey(raw);
  if (upload.kind === "unknown") return { kind: "denied" };
  if (upload.kind === "avatar") return { kind: "public", key: upload.key };
  if (upload.kind === "branding") return { kind: "public", key: upload.key, immutable: true };
  if (upload.kind === "course-attachment") {
    const viewer = await deps.currentViewer();
    const ref =
      viewer.kind === "user"
        ? await deps.attachmentFor(viewer, upload.communityId, upload.key)
        : null;
    return ref
      ? {
          kind: "attachment",
          key: upload.key,
          extension: upload.extension,
          filename: storedOrRequestedFilename(ref.name, request.requestedName, upload.extension),
        }
      : { kind: "denied" };
  }
  if (await deps.canReadPosts({ kind: "guest" }, upload.communityId)) {
    return { kind: "public", key: upload.key };
  }
  const viewer = await deps.currentViewer();
  if (viewer.kind === "user" && (await deps.canReadPosts(viewer, upload.communityId))) {
    return { kind: "members", key: upload.key };
  }
  return { kind: "denied" };
}

function isSafeFilenameCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) return false;
  if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return false;
  return char !== '"' && char !== "\\" && char !== "/";
}

export function attachmentFilename(requested: string | null, extension: string): string {
  const fallback = `attachment.${extension}`;
  if (!requested) return fallback;
  const cleaned = Array.from(requested)
    .filter(isSafeFilenameCharacter)
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned.toLowerCase().endsWith(`.${extension}`) && cleaned.length > extension.length + 1
    ? cleaned
    : fallback;
}

export function storedOrRequestedFilename(
  stored: string | null,
  requested: string | null | undefined,
  extension: string,
): string {
  const fallback = `attachment.${extension}`;
  const fromStore = attachmentFilename(stored, extension);
  if (fromStore !== fallback || !requested) {
    return fromStore;
  }
  return attachmentFilename(requested, extension);
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
