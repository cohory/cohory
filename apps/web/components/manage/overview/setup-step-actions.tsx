"use client";

import type { SetupMark } from "@cohory/communities";
import { Button, toast, type ButtonProps } from "@cohory/ui";
import { Copy } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { markSetupAction } from "./actions";

const failed = "We couldn't save that. Try again.";

export function SetupMarkButton({
  slug,
  mark,
  label,
  variant = "secondary",
}: {
  slug: string;
  mark: SetupMark;
  label: string;
  variant?: ButtonProps["variant"];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      className="min-h-11"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markSetupAction({ slug, mark });
          if (!result.ok) {
            toast.error(result.message || failed);
          }
        })
      }
    >
      {label}
    </Button>
  );
}

export function PreviewAboutLink({
  slug,
  href,
  children,
  className,
}: {
  slug: string;
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        void markSetupAction({ slug, mark: "about_previewed" });
      }}
    >
      {children}
    </Link>
  );
}

export function ShareLinkButton({ slug, url }: { slug: string; url: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      className="min-h-11"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await navigator.clipboard.writeText(url);
          } catch {
            toast.error("We couldn't copy that. Select it and copy it yourself.");
            return;
          }
          toast.success("Link copied.");
          await markSetupAction({ slug, mark: "invite_link_copied" });
        })
      }
    >
      <Copy aria-hidden="true" className="size-4" strokeWidth={1.5} />
      Copy community link
    </Button>
  );
}
