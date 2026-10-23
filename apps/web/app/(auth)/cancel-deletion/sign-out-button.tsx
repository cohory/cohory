"use client";

import { authClient } from "@cohory/auth/client";
import { Button } from "@cohory/ui";
import { clearAllDrafts } from "@cohory/ui/lib/use-draft-autosave";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        clearAllDrafts();
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
