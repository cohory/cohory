"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ComposeImage } from "./compose-document";

interface UploadedImage {
  key: string;
  url: string;
  width?: number;
  height?: number;
}

type AttachmentState =
  { status: "uploading" } | { status: "uploaded"; image: UploadedImage } | { status: "failed" };

type Attachment = AttachmentState & {
  localId: string;
  name: string;
  previewUrl: string | null;
};

function createPreview(file: File): string | null {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
}

function revokePreview(url: string | null): void {
  if (url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

let nextLocalId = 0;

function uploadedAttachment(image: UploadedImage): Attachment {
  return {
    localId: `attachment-${++nextLocalId}`,
    name: image.key,
    previewUrl: null,
    status: "uploaded",
    image,
  };
}

function useImageAttachments(options: {
  maxImages: number;
  onUploadImage(file: File): Promise<UploadedImage>;
  initial?: readonly UploadedImage[];
}) {
  const { maxImages, onUploadImage, initial } = options;
  const [attachments, setAttachments] = useState<Attachment[]>(() =>
    (initial ?? []).map(uploadedAttachment),
  );
  const live = useRef<Attachment[]>([]);

  useEffect(() => {
    live.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => {
      for (const attachment of live.current) revokePreview(attachment.previewUrl);
    },
    [],
  );

  const update = useCallback((localId: string, state: AttachmentState) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.localId === localId ? { ...attachment, ...state } : attachment,
      ),
    );
  }, []);

  const add = useCallback(
    (files: File[]) => {
      const room = Math.max(0, maxImages - attachments.length);
      const accepted = files.filter((file) => file.type.startsWith("image/")).slice(0, room);
      const added = accepted.map((file): Attachment => ({
        localId: `attachment-${++nextLocalId}`,
        name: file.name,
        previewUrl: createPreview(file),
        status: "uploading",
      }));
      setAttachments((current) => [...current, ...added]);
      accepted.forEach((file, index) => {
        const localId = added[index]?.localId;
        if (!localId) return;
        onUploadImage(file).then(
          (image) => update(localId, { status: "uploaded", image }),
          () => update(localId, { status: "failed" }),
        );
      });
    },
    [attachments.length, maxImages, onUploadImage, update],
  );

  const remove = useCallback((localId: string) => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.localId === localId);
      revokePreview(target?.previewUrl ?? null);
      return current.filter((attachment) => attachment.localId !== localId);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachments((current) => {
      for (const attachment of current) revokePreview(attachment.previewUrl);
      return [];
    });
  }, []);

  const images: ComposeImage[] = attachments.flatMap((attachment) =>
    attachment.status === "uploaded" ? [attachment.image] : [],
  );

  return {
    attachments,
    images,
    uploading: attachments.some((attachment) => attachment.status === "uploading"),
    failed: attachments.some((attachment) => attachment.status === "failed"),
    full: attachments.length >= maxImages,
    add,
    remove,
    clear,
  };
}

export { useImageAttachments, type Attachment, type UploadedImage };
