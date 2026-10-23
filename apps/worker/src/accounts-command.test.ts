import { describe, expect, it } from "vitest";

import { parseAccountsCommand } from "./accounts-command";

const cutoff = "2026-10-22T09:00:00Z";

describe("parseAccountsCommand", () => {
  it("only previews by default", () => {
    expect(parseAccountsCommand(["mark-verified", "--created-before", cutoff])).toEqual({
      command: "mark-verified",
      createdBefore: new Date(cutoff),
      apply: false,
    });
  });

  it("previews when asked to with --dry-run", () => {
    expect(
      parseAccountsCommand(["mark-verified", "--created-before", cutoff, "--dry-run"]),
    ).toMatchObject({ apply: false });
  });

  it("writes only with --yes", () => {
    expect(
      parseAccountsCommand(["mark-verified", "--created-before", cutoff, "--yes"]),
    ).toMatchObject({ apply: true });
  });

  it.each([
    [[]],
    [["mark-verified"]],
    [["mark-verified", "--created-before", "yesterday"]],
    [["mark-verified", "--created-before", "2099-01-01T00:00:00Z"]],
    [["mark-verified", "--created-before", cutoff, "--yes", "--dry-run"]],
    [["mark-verified", "--created-before", cutoff, "--force"]],
    [["verify-everyone"]],
  ])("refuses %j", (argv) => {
    expect(parseAccountsCommand(argv)).toBeNull();
  });
});
