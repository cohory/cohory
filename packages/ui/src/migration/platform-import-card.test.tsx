import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlatformImportCard, type PlatformImportCardProps } from "./platform-import-card";
import type { PlatformImportPreview, PlatformSourceOption } from "./types";

const sources: PlatformSourceOption[] = [
  {
    id: "skool",
    name: "Skool",
    version: "1.0.0",
    accept: ".csv,.json",
    limitsHref: "/importers/skool",
    files: [{ label: "Members CSV", description: "From the Members tab." }],
  },
  {
    id: "circle",
    name: "Circle",
    version: "1.0.0",
    accept: ".csv,.json",
    limitsHref: "/importers/circle",
    files: [{ label: "Posts CSV", description: "From the data export." }],
  },
];

const preview: PlatformImportPreview = {
  sourceName: "Skool",
  version: "1.0.0",
  limitsHref: "/importers/skool",
  files: [
    { name: "members.csv", label: "Members CSV", recognized: true, rows: 5 },
    { name: "notes.txt", label: "Not a Skool file", recognized: false, rows: 0 },
  ],
  counts: { memberships: 3, posts: 2, comments: 4, categories: 1 },
  people: { total: 3, existing: 1, new: 2, keptApart: 0 },
  formerMemberAuthors: 1,
  ambiguousAuthors: [
    {
      name: "Sam Lee",
      placeholderId: "p-1",
      candidates: [
        { id: "u-1", name: "Sam Lee", email: "sam.one@example.test" },
        { id: "u-2", name: "Sam Lee", email: "sam.two@example.test" },
      ],
    },
  ],
  dateOrder: "dmy",
  suggestedSource: null,
  mapping: {
    roles: [{ name: "Olga", email: "o@example.test", role: "admin", sourceRole: "owner" }],
    rolesTotal: 1,
    categories: [{ source: "Wins", target: "Wins", existing: false }],
    sample: { title: "Welcome", author: "Olga", category: "Wins", excerpt: "Hello all." },
  },
  warnings: ["Price, tier, and lifetime value are not imported. Paid access does not transfer."],
  skipped: [{ file: "members.csv", row: "line 5", reason: "The email is missing or not valid." }],
  skippedTotal: 1,
  unknownColumns: [{ file: "members.csv", columns: ["Favorite Color"] }],
  overMemberLimit: false,
};

function renderCard(overrides: Partial<PlatformImportCardProps> = {}) {
  const props: PlatformImportCardProps = {
    sources,
    selected: "skool",
    stage: { kind: "idle" },
    available: true,
    unavailableReason: null,
    error: null,
    maxFiles: 8,
    onSelect: vi.fn(),
    onFiles: vi.fn(),
    onConfirm: vi.fn(),
    onRetry: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<PlatformImportCard {...props} />);
  return props;
}

describe("PlatformImportCard", () => {
  it("picks a platform, links its limits page, and sends every chosen file", () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole("radio", { name: /Circle/ }));
    expect(props.onSelect).toHaveBeenCalledWith("circle");
    expect(screen.getByRole("link", { name: /What moves from Skool/ }).getAttribute("href")).toBe(
      "/importers/skool",
    );
    const input = screen.getByLabelText("Choose Skool files");
    const files = [new File(["a"], "members.csv"), new File(["b"], "posts.json")];
    fireEvent.change(input, { target: { files } });
    expect(props.onFiles).toHaveBeenCalledWith(files);
  });

  it("ends the in progress labels with an ellipsis", () => {
    renderCard({ stage: { kind: "uploading" } });
    expect(screen.getByRole("status").textContent).toBe("Reading the files…");
  });

  it("shows detection, warnings, left out rows, and confirms", () => {
    const props = renderCard({ stage: { kind: "preview", preview } });

    expect(screen.getByText("Not a Skool file")).toBeTruthy();
    expect(screen.getByText("Before you import")).toBeTruthy();
    expect(screen.getByText(/Favorite Color/)).toBeTruthy();
    expect(screen.getByText(/The email is missing or not valid/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import from Skool" }));
    expect(props.onConfirm).toHaveBeenCalledWith({
      emailChoice: "later",
      note: "",
      authors: {},
    });
  });

  it("shows roles, categories, a sample post, people numbers that agree, and the date order", () => {
    renderCard({ stage: { kind: "preview", preview } });

    expect(screen.getByText(/Olga becomes Admin/)).toBeTruthy();
    expect(screen.getByText(/owner in the file/)).toBeTruthy();
    expect(screen.getByText("new category")).toBeTruthy();
    expect(screen.getByText("Hello all.")).toBeTruthy();
    expect(screen.getByText("3 members, 2 authors kept as former member.")).toBeTruthy();
    expect(screen.getByText(/read day first/)).toBeTruthy();
  });

  it("sends the member the owner picks for a shared name", () => {
    const props = renderCard({ stage: { kind: "preview", preview } });

    fireEvent.change(screen.getByLabelText("Sam Lee"), { target: { value: "u-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Import from Skool" }));
    expect(props.onConfirm).toHaveBeenCalledWith({
      emailChoice: "later",
      note: "",
      authors: { "p-1": "u-2" },
    });
  });

  it("asks when to email, sends the note, and previews and tests the email", async () => {
    const onPreviewEmail = vi.fn().mockResolvedValue({
      subject: "Your membership in Makers moved to Cohory",
      text: "Olga moved Makers from Skool to Cohory.",
    });
    const onSendTestEmail = vi.fn().mockResolvedValue(undefined);
    const props = renderCard({
      stage: { kind: "preview", preview },
      onPreviewEmail,
      onSendTestEmail,
    });

    fireEvent.change(screen.getByLabelText("Note from you (optional)"), {
      target: { value: " See you inside. " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview email" }));
    expect(await screen.findByText("Olga moved Makers from Skool to Cohory.")).toBeTruthy();
    expect(onPreviewEmail).toHaveBeenCalledWith(" See you inside. ");
    fireEvent.click(screen.getByRole("button", { name: "Send me a test" }));
    expect(await screen.findByText("Test sent to your email address.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Email everyone now/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import from Skool" }));

    expect(props.onConfirm).toHaveBeenCalledWith({
      emailChoice: "now",
      note: "See you inside.",
      authors: {},
    });
  });

  it("hides the note when the owner chooses not to email", () => {
    const props = renderCard({ stage: { kind: "preview", preview } });

    fireEvent.click(screen.getByRole("radio", { name: /Do not email/ }));
    expect(screen.queryByLabelText("Note from you (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import from Skool" }));
    expect(props.onConfirm).toHaveBeenCalledWith({ emailChoice: "never", note: "", authors: {} });
  });

  it("says that people are invited, not added, on Cloud", () => {
    renderCard({
      stage: {
        kind: "preview",
        preview: { ...preview, people: { ...preview.people, inviteOnly: true } },
      },
    });

    expect(screen.getByText(/nobody is added as a member until they accept/)).toBeTruthy();
    expect(screen.queryByText(/get a new account without a password/)).toBeNull();
  });

  it("reports invitations and that emails wait for the owner", () => {
    renderCard({
      stage: {
        kind: "done",
        result: {
          imported: { memberships: 3 },
          createdAccounts: 0,
          linkedAccounts: 0,
          invitedAccounts: 3,
          ownerImportedAs: "none",
          skipped: [],
          skippedTotal: 0,
          warnings: [],
          subscriptionsToLink: 0,
          emailsSent: 0,
          emailsNotSent: 0,
          emailsOverLimit: 2,
          emailChoice: "later",
        },
      },
    });

    expect(screen.getByText(/3 people invited\./)).toBeTruthy();
    expect(
      screen.getByText(/2 people will not be emailed because your plan allows fewer members/),
    ).toBeTruthy();
    expect(screen.getByText(/Send them from Import history when you are ready/)).toBeTruthy();
  });

  it("offers the other platform and turns import off when most files belong to it", () => {
    const onSwitchSource = vi.fn();
    renderCard({
      onSwitchSource,
      stage: {
        kind: "preview",
        preview: {
          ...preview,
          suggestedSource: { id: "circle", name: "Circle" },
          files: [
            { name: "members.csv", label: "Members CSV", recognized: true, rows: 5 },
            { name: "posts.csv", label: "Not a Skool file", recognized: false, rows: 0 },
            { name: "spaces.csv", label: "Not a Skool file", recognized: false, rows: 0 },
          ],
        },
      },
    });

    expect(screen.getByRole("button", { name: "Import from Skool" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Circle instead" }));
    expect(onSwitchSource).toHaveBeenCalledWith("circle");
  });

  it("blocks the import when it would pass the member limit", () => {
    renderCard({ stage: { kind: "preview", preview: { ...preview, overMemberLimit: true } } });
    expect(screen.getByRole("button", { name: "Import from Skool" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("explains why importing is unavailable", () => {
    renderCard({ available: false, unavailableReason: "Import into a new, empty community." });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Import into a new, empty community.")).toBeTruthy();
  });
});
