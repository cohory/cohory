import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCategoryAction } from "../../lib/manage/category-actions";
import { CategoriesForm } from "./categories-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/manage/category-actions", () => ({
  createCategoryAction: vi.fn(),
  deleteCategoryAction: vi.fn(),
  reorderCategoriesAction: vi.fn(),
  updateCategoryAction: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("CategoriesForm", () => {
  it("keeps Add category enabled and asks for a name on the field when it is empty", () => {
    render(<CategoriesForm slug="garden" categories={[]} />);

    const add = screen.getByRole("button", { name: "Add category" }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);

    expect(createCategoryAction).not.toHaveBeenCalled();
    const name = screen.getByLabelText("New category name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a category name.")).toBeTruthy();
  });
});
