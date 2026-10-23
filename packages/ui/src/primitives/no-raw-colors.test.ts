import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = new URL("./", import.meta.url);
const files = readdirSync(directory).filter(
  (file) => file.endsWith(".tsx") && !file.includes(".test."),
);
const communityDirectory = new URL("../community/", import.meta.url);
const communityFiles = readdirSync(communityDirectory).filter(
  (file) => /\.tsx?$/.test(file) && !file.includes(".test."),
);
const membersDirectory = new URL("../members/", import.meta.url);
const membersFiles = readdirSync(membersDirectory).filter(
  (file) => /\.tsx?$/.test(file) && !file.includes(".test."),
);

const classroomDirectory = new URL("../classroom/", import.meta.url);
const classroomFiles = readdirSync(classroomDirectory).filter(
  (file) => /\.tsx?$/.test(file) && !file.includes(".test."),
);

const calendarDirectory = new URL("../calendar/", import.meta.url);
const calendarFiles = readdirSync(calendarDirectory).filter(
  (file) => /\.tsx?$/.test(file) && !file.includes(".test."),
);

const rawColor = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/;
const paletteClass =
  /\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/;

describe("primitives", () => {
  it("covers every primitive the auth pages and other units rely on", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "alert.tsx",
        "collapsible.tsx",
        "avatar.tsx",
        "badge.tsx",
        "button.tsx",
        "card.tsx",
        "dialog.tsx",
        "dropdown-menu.tsx",
        "field.tsx",
        "input.tsx",
        "label.tsx",
        "popover.tsx",
        "progress.tsx",
        "select.tsx",
        "separator.tsx",
        "skeleton.tsx",
        "switch.tsx",
        "tabs.tsx",
        "textarea.tsx",
        "toast.tsx",
        "tooltip.tsx",
      ]),
    );
  });

  it.each(files)("%s uses no raw color values", (file) => {
    const source = readFileSync(new URL(file, directory), "utf8");

    expect(source).not.toMatch(rawColor);
  });

  it.each(files)("%s uses no Tailwind palette classes", (file) => {
    const source = readFileSync(new URL(file, directory), "utf8");

    expect(source).not.toMatch(paletteClass);
  });
});

describe("community components", () => {
  it.each(communityFiles)("%s uses no raw color values", (file) => {
    const source = readFileSync(new URL(file, communityDirectory), "utf8");

    expect(source).not.toMatch(rawColor);
  });

  it.each(communityFiles)("%s uses no Tailwind palette classes", (file) => {
    const source = readFileSync(new URL(file, communityDirectory), "utf8");

    expect(source).not.toMatch(paletteClass);
  });
});

describe("member components", () => {
  it.each(membersFiles)("%s uses no raw color values", (file) => {
    const source = readFileSync(new URL(file, membersDirectory), "utf8");

    expect(source).not.toMatch(rawColor);
  });

  it.each(membersFiles)("%s uses no Tailwind palette classes", (file) => {
    const source = readFileSync(new URL(file, membersDirectory), "utf8");

    expect(source).not.toMatch(paletteClass);
  });
});

describe("classroom components", () => {
  it.each(classroomFiles)("%s uses no raw color values", (file) => {
    const source = readFileSync(new URL(file, classroomDirectory), "utf8");

    expect(source).not.toMatch(rawColor);
  });

  it.each(classroomFiles)("%s uses no Tailwind palette classes", (file) => {
    const source = readFileSync(new URL(file, classroomDirectory), "utf8");

    expect(source).not.toMatch(paletteClass);
  });
});

describe("calendar components", () => {
  it.each(calendarFiles)("%s uses no raw color values", (file) => {
    const source = readFileSync(new URL(file, calendarDirectory), "utf8");

    expect(source).not.toMatch(rawColor);
  });

  it.each(calendarFiles)("%s uses no Tailwind palette classes", (file) => {
    const source = readFileSync(new URL(file, calendarDirectory), "utf8");

    expect(source).not.toMatch(paletteClass);
  });
});
