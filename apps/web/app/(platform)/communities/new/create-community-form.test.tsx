import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkSlugAction, createCommunityAction } from "./actions";
import { CreateCommunityForm } from "./create-community-form";

vi.mock("./actions", () => ({ createCommunityAction: vi.fn(), checkSlugAction: vi.fn() }));

const createCommunity = vi.mocked(createCommunityAction);
const checkSlug = vi.mocked(checkSlugAction);
const address = "acme.example.com";

beforeEach(() => {
  checkSlug.mockResolvedValue({ status: "available" });
});

afterEach(() => {
  vi.clearAllMocks();
});

function fill() {
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Makers Guild" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Description (optional)" }), {
    target: { value: "A place for people who build things." },
  });
  fireEvent.click(screen.getByRole("radio", { name: /Public/ }));
  fireEvent.click(screen.getByRole("radio", { name: /Paid/ }));
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create community" }));
  });
}

describe("CreateCommunityForm", () => {
  it("keeps everything typed when the URL is taken and focuses the URL", async () => {
    createCommunity.mockImplementation(async (_previous, formData) => ({
      status: "error",
      fieldErrors: { slug: "That URL is already taken. Try a different one." },
      values: {
        description: String(formData.get("description")),
        privacy: String(formData.get("privacy")),
        pricing: String(formData.get("pricing")),
      },
    }));
    render(<CreateCommunityForm address={address} />);
    fill();

    await submit();

    const url = screen.getByRole("textbox", { name: "URL" });
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(url);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Makers Guild");
    expect(screen.getByRole("textbox", { name: "Description (optional)" })).toHaveProperty(
      "value",
      "A place for people who build things.",
    );
    expect(screen.getByRole("radio", { name: /Public/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: /Paid/ })).toHaveProperty("checked", true);
  });

  it("does not hang when the request fails, and keeps what was typed", async () => {
    createCommunity.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CreateCommunityForm address={address} />);
    fill();

    await submit();

    expect(screen.getByRole("alert").textContent).toContain(
      "We couldn't create the community. Check your connection and try again.",
    );
    expect(screen.getByRole("textbox", { name: "Description (optional)" })).toHaveProperty(
      "value",
      "A place for people who build things.",
    );
    expect(screen.getByRole("radio", { name: /Public/ })).toHaveProperty("checked", true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Create community" }).disabled,
    ).toBe(false);
  });

  it("shows the full address the community will live at", () => {
    checkSlug.mockResolvedValue({ status: "available" });
    render(<CreateCommunityForm address={address} />);
    fill();

    expect(screen.getByText(`${address}/c/makers-guild`)).toBeTruthy();
  });

  it("names the Community Guidelines above the button when the server has them", () => {
    render(<CreateCommunityForm address={address} guidelinesHref="/guidelines" />);

    expect(screen.getByText(/By creating a community you agree to the/).textContent).toBe(
      "By creating a community you agree to the Community Guidelines.",
    );
    expect(screen.getByRole("link", { name: "Community Guidelines" }).getAttribute("href")).toBe(
      "/guidelines",
    );
  });

  it("shows no guidelines line when the server has none", () => {
    render(<CreateCommunityForm address={address} />);

    expect(screen.queryByText(/Community Guidelines/)).toBeNull();
  });

  it("starts as a free community", () => {
    render(<CreateCommunityForm address={address} />);

    expect(screen.getByRole("radio", { name: /Free/ })).toHaveProperty("checked", true);
  });

  it("checks the URL while typing and says when it is free", async () => {
    checkSlug.mockResolvedValue({ status: "available" });
    render(<CreateCommunityForm address={address} />);
    fill();

    expect(await screen.findByText("This URL is available.")).toBeTruthy();
    expect(checkSlug).toHaveBeenCalledWith("makers-guild");
  });

  it("offers free URLs when the one typed is taken, and uses the one picked", async () => {
    checkSlug.mockImplementation(async (slug) =>
      slug === "makers-guild"
        ? { status: "taken", suggestions: ["makers-guild-hq", "makers-guild-club"] }
        : { status: "available" },
    );
    render(<CreateCommunityForm address={address} />);
    fill();

    expect(await screen.findByText("That URL is already taken. Try one of these:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "makers-guild-hq" }));

    expect(screen.getByRole("textbox", { name: "URL" })).toHaveProperty("value", "makers-guild-hq");
    expect(await screen.findByText("This URL is available.")).toBeTruthy();
  });

  it("does not check a URL that is not valid yet", async () => {
    render(<CreateCommunityForm address={address} />);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), { target: { value: "ab" } });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(checkSlug).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")?.textContent ?? "").toBe("");
  });
});
