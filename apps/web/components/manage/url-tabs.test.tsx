import { TabsContent, TabsList, TabsTrigger } from "@cohory/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UrlTabs } from "./url-tabs";

const replace = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/c/lab/manage/inbox",
  useSearchParams: () => new URLSearchParams("tab=requests&reports=closed"),
}));

afterEach(() => {
  replace.mockReset();
});

describe("UrlTabs", () => {
  it("writes the chosen tab to the URL and keeps the other parameters", () => {
    render(
      <UrlTabs param="tab" defaultValue="requests">
        <TabsList aria-label="Inbox">
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="requests">Waiting requests</TabsContent>
        <TabsContent value="reports">Open reports</TabsContent>
      </UrlTabs>,
    );

    const reports = screen.getByRole("tab", { name: "Reports" });
    fireEvent.mouseDown(reports);
    fireEvent.click(reports);

    expect(replace).toHaveBeenCalledWith("/c/lab/manage/inbox?tab=reports&reports=closed", {
      scroll: false,
    });
    expect(reports.getAttribute("aria-selected")).toBe("true");
  });
});
