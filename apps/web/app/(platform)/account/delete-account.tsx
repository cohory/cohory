"use client";

import { DeleteAccountPanel, type BlockingCommunity } from "@cohory/ui";
import { useActionState, useState } from "react";

import {
  ExitReasonFields,
  noExitReason,
  type ExitReasonValue,
} from "../../../components/feedback/exit-reason-fields";
import { requestAccountDeletion, type DeleteAccountState } from "./actions";

const initialState: DeleteAccountState = { status: "idle" };

export function DeleteAccount({
  askWhy = false,
  ...props
}: {
  email: string;
  graceDays: number;
  blockingCommunities: BlockingCommunity[];
  privacyHref: string;
  askWhy?: boolean;
}) {
  const [state, action, pending] = useActionState(requestAccountDeletion, initialState);
  const [why, setWhy] = useState<ExitReasonValue>(noExitReason);

  return (
    <DeleteAccountPanel
      {...props}
      action={action}
      pending={pending}
      error={state.status === "error" ? state.message : null}
      extraFields={
        askWhy ? (
          <ExitReasonFields
            question="Why are you leaving?"
            value={why}
            onChange={setWhy}
            disabled={pending}
          />
        ) : null
      }
    />
  );
}
