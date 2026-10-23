import { describe, expect, it } from "vitest";

import { forceThemeAttribute, resolveTheme, themeScript } from "./theme-script";

describe("resolveTheme", () => {
  it("follows the device when nothing is forced", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("lets a forced light or dark win over the device", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("ignores values it does not know", () => {
    expect(resolveTheme("sepia", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
  });
});

interface FakeDevice {
  readonly document: Document;
  change(prefersDark: boolean): void;
}

function startOnDevice(prefersDark: boolean): FakeDevice {
  const page = document.implementation.createHTMLDocument("page");
  const listeners: (() => void)[] = [];
  let dark = prefersDark;
  const device = {
    matchMedia: (query: string) => ({
      get matches() {
        return query === "(prefers-color-scheme: dark)" && dark;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
    }),
  };
  new Function("document", "window", themeScript)(page, device);
  return {
    document: page,
    change(next) {
      dark = next;
      for (const listener of listeners) listener();
    },
  };
}

const mutationsDelivered = () => new Promise((resolve) => setTimeout(resolve, 0));
const themeOf = (device: FakeDevice) => device.document.documentElement.getAttribute("data-theme");

describe("themeScript", () => {
  it("sets the device theme on the root element", () => {
    const device = startOnDevice(true);
    expect(themeOf(device)).toBe("dark");
  });

  it("follows the device when its setting changes", () => {
    const device = startOnDevice(false);
    expect(themeOf(device)).toBe("light");
    device.change(true);
    expect(themeOf(device)).toBe("dark");
  });

  it("uses a forced theme from the page and returns to the device when it leaves", async () => {
    const device = startOnDevice(true);
    const community = device.document.createElement("div");
    community.setAttribute(forceThemeAttribute, "light");
    device.document.body.append(community);
    await mutationsDelivered();
    expect(themeOf(device)).toBe("light");

    device.change(true);
    expect(themeOf(device)).toBe("light");

    community.setAttribute(forceThemeAttribute, "dark");
    await mutationsDelivered();
    expect(themeOf(device)).toBe("dark");

    community.remove();
    await mutationsDelivered();
    expect(themeOf(device)).toBe("dark");
    device.change(false);
    expect(themeOf(device)).toBe("light");
  });
});
