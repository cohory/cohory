"use client";

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cohory/ui";
import { CreditCard, LogOut, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { leaveCommunityAction, type MembershipActionState } from "../app/c/[slug]/actions";

const initialState: MembershipActionState = { status: "idle" };

function leaveConsequence(isPrivate: boolean, paying: boolean): string {
  const loss = isPrivate
    ? "You'll lose access to posts, courses, and events right away."
    : "You'll lose access to member features right away.";
  if (paying) {
    const comeBack = isPrivate ? "without paying or a new invitation" : "without paying";
    return `${loss} Leaving doesn't cancel your paid membership. You'll still be charged until you cancel it, and while it's active you can join again ${comeBack}.`;
  }
  return isPrivate
    ? `${loss} You'll need a new invitation to come back.`
    : `${loss} You can join again later.`;
}

export function CommunityMenu({
  slug,
  name,
  isPrivate,
  paying = false,
}: {
  slug: string;
  name: string;
  isPrivate: boolean;
  paying?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    leaveCommunityAction.bind(null, slug),
    initialState,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="size-11 px-0" aria-label="More community options">
            <MoreHorizontal aria-hidden="true" className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild className="min-h-11">
            <Link href={`/c/${slug}/membership`}>
              <CreditCard aria-hidden="true" />
              Membership and billing
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="danger" onSelect={() => setConfirming(true)}>
            <LogOut aria-hidden="true" />
            Leave community
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave {name}?</DialogTitle>
            <DialogDescription>{leaveConsequence(isPrivate, paying)}</DialogDescription>
          </DialogHeader>
          {paying ? (
            <p className="text-sm text-text-muted">
              To stop paying,{" "}
              <Link
                href="/account/billing"
                className="rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                cancel it in Billing
              </Link>
              .
            </p>
          ) : null}
          {state.status === "error" ? (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <form action={action}>
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? "Leaving community…" : "Leave community"}
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
