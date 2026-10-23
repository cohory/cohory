import { Button } from "@cohory/ui";
import { SearchX } from "lucide-react";
import Link from "next/link";

import { currentSession } from "../lib/session";
import { EmptyState } from "./empty-state";

export async function CommunityNotFound() {
  const signedIn = (await currentSession()) !== null;
  return (
    <EmptyState
      icon={SearchX}
      title="We couldn't find that page"
      action={
        <Button asChild>
          <Link href="/">{signedIn ? "Go to my communities" : "Go to home"}</Link>
        </Button>
      }
    >
      The link may be wrong, or the community may no longer exist.
    </EmptyState>
  );
}
