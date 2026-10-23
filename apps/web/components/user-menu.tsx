"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  CommunitySwitcherItems,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type SwitcherCommunity,
} from "@cohory/ui";
import { clearAllDrafts } from "@cohory/ui/lib/use-draft-autosave";
import { Bell, CreditCard, LogOut, MessageSquare, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "../lib/auth/actions";
import { myCommunitiesHref } from "../lib/communities/home-destination";
import { feedbackHref, sendFeedbackLabel } from "../lib/contact/feedback";
import { initials } from "../lib/format";
import { useSupportLinks } from "./support-links";

export function UserMenu({
  name,
  email,
  image,
  communities,
  currentSlug = null,
  canCreate = true,
  earlyAccessHref = null,
}: {
  name: string;
  email: string;
  image: string | null;
  communities: readonly SwitcherCommunity[];
  currentSlug?: string | null;
  canCreate?: boolean;
  earlyAccessHref?: string | null;
}) {
  const pathname = usePathname();
  const { contact } = useSupportLinks();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
        <Avatar aria-hidden="true" className="size-9">
          {image ? <AvatarImage src={image} alt="" /> : null}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <span className="sr-only">{`Open account menu for ${name}`}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(36rem,calc(100dvh-5rem))] w-72 overflow-y-auto overscroll-contain"
      >
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate text-sm font-medium text-text">{name}</span>
          <span className="truncate text-xs text-text-muted">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/account">
            <UserRound aria-hidden="true" />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/account/notifications">
            <Bell aria-hidden="true" />
            Notification settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/account/billing">
            <CreditCard aria-hidden="true" />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <CommunitySwitcherItems
          communities={communities}
          currentSlug={currentSlug}
          homeHref={myCommunitiesHref}
          createHref={canCreate ? "/communities/new" : null}
        />
        {!canCreate && earlyAccessHref ? (
          <DropdownMenuItem asChild className="min-h-11">
            <Link href={earlyAccessHref}>
              <Sparkles aria-hidden="true" />
              Request early access
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {contact ? (
          <DropdownMenuItem asChild className="min-h-11">
            <Link href={feedbackHref(pathname ?? "/")}>
              <MessageSquare aria-hidden="true" />
              {sendFeedbackLabel}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="min-h-11"
          onSelect={() => {
            clearAllDrafts();
            void signOut();
          }}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
