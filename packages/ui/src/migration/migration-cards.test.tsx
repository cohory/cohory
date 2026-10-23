import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportArchiveCard } from "./export-archive-card";
import { MigrationJobProgress } from "./job-progress";
import { ImportArchiveCard } from "./import-archive-card";
import { MembersCsvCard } from "./members-csv-card";
import type { CsvPreview } from "./types";

const formatDate = (iso: string) => iso.slice(0, 10);

const csvPreview: CsvPreview = {
  rows: [
    {
      line: 2,
      email: "ada@example.test",
      name: "Ada",
      role: "admin",
      status: "ready",
      message: null,
    },
    {
      line: 3,
      email: "nope",
      name: null,
      role: null,
      status: "error",
      message: "This is not a valid email address.",
      values: { email: "nope", name: "Bob" },
    },
    {
      line: 4,
      email: "grace@example.test",
      name: "Grace",
      role: "member",
      status: "invited",
      message: "Invited on 21 Oct 2026.",
    },
  ],
  ready: 1,
  errors: 1,
  alreadyMembers: 0,
  invited: 1,
  leftOut: 0,
  notes: ["Emails were read from the column Contact."],
  newAccounts: null,
  memberLimit: null,
  activeMembers: 1,
  addAllowed: false,
};

describe("ExportArchiveCard", () => {
  it("disables a second export while one runs and links finished archives", () => {
    const onStart = vi.fn();
    render(
      <ExportArchiveCard
        starting={false}
        error={null}
        formatDate={formatDate}
        onStart={onStart}
        jobs={[
          {
            id: "a",
            status: "running",
            createdAt: "2026-10-18T10:00:00Z",
            fileBytes: null,
            progress: { phase: "uploads", done: 1, total: 4 },
            downloadHref: null,
            errorMessage: null,
          },
          {
            id: "b",
            status: "succeeded",
            createdAt: "2026-10-17T10:00:00Z",
            fileBytes: 2048,
            progress: null,
            downloadHref: "/download/b",
            errorMessage: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Export running" })).toHaveProperty("disabled", true);
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe("/download/b");
  });
});

describe("ExportArchiveCard history", () => {
  it("shows what each export holds, keeps it until its date, and deletes it", () => {
    const onDelete = vi.fn();
    render(
      <ExportArchiveCard
        starting={false}
        error={null}
        formatDate={formatDate}
        onStart={vi.fn()}
        onDelete={onDelete}
        deletingId={null}
        jobs={[
          {
            id: "b",
            status: "succeeded",
            createdAt: "2026-10-17T10:00:00Z",
            fileBytes: 2048,
            progress: null,
            downloadHref: "/download/b",
            errorMessage: null,
            contents: "312 members, 40 posts",
            expiresAt: "2026-11-16T10:00:00Z",
            deletedAt: null,
          },
          {
            id: "c",
            status: "succeeded",
            createdAt: "2026-10-01T10:00:00Z",
            fileBytes: 1024,
            progress: null,
            downloadHref: null,
            errorMessage: null,
            contents: null,
            expiresAt: null,
            deletedAt: "2026-10-10T10:00:00Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("312 members, 40 posts")).toBeTruthy();
    expect(screen.getByText("Kept until 2026-11-16")).toBeTruthy();
    expect(screen.getByText("Deleted 2026-10-10")).toBeTruthy();
    const remove = screen.getAllByRole("button", { name: /^Delete/ });
    expect(remove).toHaveLength(1);
    fireEvent.click(remove[0] as HTMLElement);
    expect(onDelete).toHaveBeenCalledWith("b");
  });
});

describe("MigrationJobProgress", () => {
  it("names the phase, the count, and the time it has run, and says the page can close", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T10:05:30Z"));
    render(
      <MigrationJobProgress
        label="Importing…"
        progress={{
          phase: "memberships",
          done: 1200,
          total: 4800,
          startedAt: "2026-10-18T10:02:00Z",
        }}
      />,
    );
    vi.useRealTimers();

    expect(screen.getByText("Members: 1,200 of 4,800 items")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText(/Running for 3 minutes\./)).toBeTruthy();
    expect(screen.getByText(/You can close this page/)).toBeTruthy();
  });
});

describe("ImportArchiveCard", () => {
  it("shows the preview and confirms with the email choice", () => {
    const onConfirm = vi.fn();
    render(
      <ImportArchiveCard
        available
        unavailableReason={null}
        error={null}
        formatDate={formatDate}
        onFile={vi.fn()}
        onRetry={vi.fn()}
        onReset={vi.fn()}
        onConfirm={onConfirm}
        stage={{
          kind: "preview",
          preview: {
            communityName: "Makers",
            exportedAt: "2026-10-18T10:00:00Z",
            schemaVersion: "1.0.0",
            edition: "cloud",
            counts: { posts: 12, memberships: 3 },
            people: { total: 3, existing: 1, new: 2 },
            uploads: 4,
            warnings: [
              "1 paying member gets free access until the date they paid for, then needs to subscribe again.",
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("Makers")).toBeTruthy();
    expect(screen.getByText("Before you import")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Email everyone now/ }));
    fireEvent.change(screen.getByLabelText("Note from you (optional)"), {
      target: { value: "Welcome back." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import everything" }));

    expect(onConfirm).toHaveBeenCalledWith({ emailChoice: "now", note: "Welcome back." });
  });

  it("explains why import is unavailable instead of offering a file picker", () => {
    render(
      <ImportArchiveCard
        available={false}
        unavailableReason="Import into a new, empty community."
        error={null}
        formatDate={formatDate}
        onFile={vi.fn()}
        onRetry={vi.fn()}
        onReset={vi.fn()}
        onConfirm={vi.fn()}
        stage={{ kind: "idle" }}
      />,
    );

    expect(screen.queryByRole("button", { name: /Choose archive/ })).toBeNull();
    expect(screen.getByText("Import into a new, empty community.")).toBeTruthy();
  });
});

describe("MembersCsvCard", () => {
  it("lists each row with its status and only offers invitations on Cloud", () => {
    const onConfirm = vi.fn();
    render(
      <MembersCsvCard
        error={null}
        onFile={vi.fn()}
        onRetry={vi.fn()}
        onReset={vi.fn()}
        onConfirm={onConfirm}
        stage={{ kind: "preview", preview: csvPreview }}
      />,
    );

    expect(screen.getByText("This is not a valid email address.")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByText("Has an account")).toBeNull();
    expect(screen.queryByText("Add them now")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send 1 invitation" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "invite",
      notify: true,
      resend: false,
      note: "",
    });
  });

  it("skips people already invited unless the owner sends again", () => {
    const onConfirm = vi.fn();
    render(
      <MembersCsvCard
        error={null}
        onFile={vi.fn()}
        onRetry={vi.fn()}
        onReset={vi.fn()}
        onConfirm={onConfirm}
        stage={{ kind: "preview", preview: csvPreview }}
      />,
    );

    expect(screen.getByText("Invited on 21 Oct 2026.")).toBeTruthy();
    expect(screen.getByText("Emails were read from the column Contact.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Send again to people already invited" }));
    fireEvent.click(screen.getByRole("button", { name: "Send 2 invitations" }));
    expect(onConfirm).toHaveBeenCalledWith({
      mode: "invite",
      notify: true,
      resend: true,
      note: "",
    });
  });

  it("filters to the rows to fix and offers them as a download", () => {
    render(
      <MembersCsvCard
        error={null}
        onFile={vi.fn()}
        onRetry={vi.fn()}
        onReset={vi.fn()}
        onConfirm={vi.fn()}
        stage={{ kind: "preview", preview: csvPreview }}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Only rows to fix" }));
    expect(screen.queryByText("ada@example.test")).toBeNull();
    expect(screen.getByText("nope")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download rows to fix/ })).toBeTruthy();
  });

  it("blocks adding members past the member limit", () => {
    render(
      <MembersCsvCard
        error={null}
        onFile={vi.fn()}
        onRetry={vi.fn()}
        onReset={vi.fn()}
        onConfirm={vi.fn()}
        stage={{ kind: "preview", preview: { ...csvPreview, addAllowed: true, memberLimit: 1 } }}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /Add them now/ }));

    expect(screen.getByRole("button", { name: "Add 1 member" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/over the limit of 1 members/)).toBeTruthy();
  });

  it("names what happened and lists the skipped rows and addresses not emailed", () => {
    render(
      <MembersCsvCard
        error={null}
        onFile={vi.fn()}
        onRetry={vi.fn()}
        onReset={vi.fn()}
        onConfirm={vi.fn()}
        stage={{
          kind: "done",
          result: {
            mode: "invite",
            added: 0,
            invited: 2,
            skipped: 1,
            emailsSent: 2,
            notSent: 1,
            limitReached: false,
            skippedRows: [{ line: 4, reason: "This is not a valid email address." }],
          },
        }}
      />,
    );

    expect(screen.getByText("Invitations sent")).toBeTruthy();
    expect(screen.getByText(/1 not sent because the address opted out/)).toBeTruthy();
    expect(screen.getByText("Row 4: This is not a valid email address.")).toBeTruthy();
  });
});
