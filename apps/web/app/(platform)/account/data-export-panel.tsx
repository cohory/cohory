"use client";

import { Alert, Button } from "@cohory/ui";
import { useActionState } from "react";

import { requestDataExport, type DataExportState } from "./data-export-actions";

const initialState: DataExportState = { status: "idle" };

export interface ReadyDataExport {
  readonly href: string;
  readonly expiresOn: string;
}

export function DataExportPanel({
  privacyHref,
  ready,
}: {
  privacyHref: string;
  ready: ReadyDataExport | null;
}) {
  const [state, action, pending] = useActionState(requestDataExport, initialState);

  return (
    <form action={action} className="flex flex-col gap-3 text-sm text-text">
      <p className="text-text-muted">
        Get a copy of your profile, memberships, posts, comments, RSVPs, course progress,
        notification settings, and paid memberships as a ZIP file. We email you a link to download
        it. Read the{" "}
        <a className="text-link" href={privacyHref}>
          Privacy Policy
        </a>{" "}
        for what we keep and why.
      </p>
      {ready ? (
        <p>
          Your copy is ready.{" "}
          <a className="text-link" href={ready.href}>
            Download your copy
          </a>
          . The link works until {ready.expiresOn}.
        </p>
      ) : null}
      {state.status === "sent" ? <Alert variant="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert variant="warning">{state.message}</Alert> : null}
      <Button
        type="submit"
        variant="secondary"
        className="min-h-11 self-start"
        disabled={pending || state.status === "sent"}
      >
        {pending ? "Preparing…" : "Download your data"}
      </Button>
    </form>
  );
}
