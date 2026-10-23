import type { ComponentProps } from "react";

export type StoredImageProps = ComponentProps<"img"> & { src: string; alt: string };

export function StoredImage({ alt, ...props }: StoredImageProps) {
  // Uploads and video posters come from the storage driver's public URL or a provider host, which
  // can be any S3 compatible host, so next/image cannot be configured with their domains up front.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} {...props} />;
}
