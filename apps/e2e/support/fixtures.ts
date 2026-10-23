import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

import { clientAddress, password, person, type Person } from "./people";

export interface Actor {
  readonly person: Person;
  readonly context: BrowserContext;
  readonly page: Page;
}

export interface ActorOptions {
  readonly desktop?: boolean;
  readonly mobile?: boolean;
  readonly signedIn?: boolean;
  readonly reducedMotion?: "reduce";
}

interface Fixtures {
  actor: (firstName: string, options?: ActorOptions) => Promise<Actor>;
}

const cspViolation = /Content Security Policy/i;

function watchCsp(context: BrowserContext, violations: string[]): void {
  context.on("console", (message) => {
    if (message.type() === "error" && cspViolation.test(message.text())) {
      violations.push(`${message.page()?.url() ?? "unknown page"}: ${message.text()}`);
    }
  });
}

const desktopView = { viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false };
const mobileView = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    const violations: string[] = [];
    watchCsp(context, violations);
    await use(context);
    expect(violations, "Content Security Policy violations").toEqual([]);
  },
  actor: async ({ browser, baseURL }, use) => {
    const violations: string[] = [];
    const contexts: BrowserContext[] = [];
    await use(async (firstName, options = {}) => {
      const context = await browser.newContext({
        ...(options.desktop ? desktopView : {}),
        ...(options.mobile ? mobileView : {}),
        ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
        extraHTTPHeaders: { "x-forwarded-for": clientAddress() },
      });
      contexts.push(context);
      watchCsp(context, violations);
      const who = person(firstName);
      if (options.signedIn !== false) {
        const response = await context.request.post("/api/auth/sign-up/email", {
          data: { name: who.name, email: who.email, password },
          headers: { origin: baseURL ?? "" },
        });
        expect(response.status(), `sign up ${who.email}`).toBe(200);
        const signIn = await context.request.post("/api/auth/sign-in/email", {
          data: { email: who.email, password },
          headers: { origin: baseURL ?? "" },
        });
        expect(signIn.status(), `sign in ${who.email}`).toBe(200);
      }
      const page = await context.newPage();
      return { person: who, context, page };
    });
    await Promise.all(contexts.map((context) => context.close()));
    expect(violations, "Content Security Policy violations").toEqual([]);
  },
});

export { expect };
