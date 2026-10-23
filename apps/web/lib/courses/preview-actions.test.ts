import { beforeEach, describe, expect, it, vi } from "vitest";

const store = { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => store }));

const { setMemberPreviewAction } = await import("./preview-actions");
const { readMemberPreview } = await import("./preview");

beforeEach(() => vi.clearAllMocks());

describe("member preview", () => {
  it("sets a browser session cookie scoped to the community classroom", async () => {
    await setMemberPreviewAction({ slug: "makers", on: true });

    expect(store.set).toHaveBeenCalledWith("cohory_member_preview", "1", {
      path: "/c/makers/classroom",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });
    const options: unknown = store.set.mock.calls[0]?.[2];
    expect(options).not.toHaveProperty("maxAge");
    expect(options).not.toHaveProperty("expires");
  });

  it("clears the cookie when preview ends", async () => {
    await setMemberPreviewAction({ slug: "makers", on: false });

    expect(store.delete).toHaveBeenCalledWith(
      expect.objectContaining({ name: "cohory_member_preview", path: "/c/makers/classroom" }),
    );
  });

  it("rejects a slug that could escape the classroom path", async () => {
    await expect(setMemberPreviewAction({ slug: "../admin", on: true })).rejects.toThrow();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("reads the preview flag from the cookie", async () => {
    store.get.mockReturnValueOnce({ value: "1" }).mockReturnValueOnce(undefined);

    expect(await readMemberPreview()).toBe(true);
    expect(await readMemberPreview()).toBe(false);
  });
});
