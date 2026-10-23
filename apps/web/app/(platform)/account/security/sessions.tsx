"use client";

import { SessionList, type SessionItem } from "@cohory/ui";
import { useTransition } from "react";

import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";

export function Sessions({ sessions }: { sessions: SessionItem[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <SessionList
      sessions={sessions}
      pending={pending}
      onRevoke={(id) => startTransition(() => revokeSessionAction(id))}
      onRevokeOthers={() => startTransition(() => revokeOtherSessionsAction())}
    />
  );
}
