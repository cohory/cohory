import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

describe("TabsTrigger", () => {
  it("gives each tab a 44px hit area around its smaller visual box", () => {
    render(
      <Tabs defaultValue="lesson">
        <TabsList>
          <TabsTrigger value="lesson">Lesson</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "Lesson" });
    expect(tab.className).toContain("relative");
    expect(tab.className).toContain("touch-hit");
  });
});
