import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const blocking = new Set(["serious", "critical"]);

interface KnownIssue {
  readonly rule: string;
  readonly html: RegExp;
  readonly openItem: string;
}

// Each entry is an app defect the suite cannot fix. Remove the entry when the app is fixed.
const knownIssues: readonly KnownIssue[] = [];

function isKnown(rule: string, html: string): KnownIssue | undefined {
  return knownIssues.find((issue) => issue.rule === rule && issue.html.test(html));
}

export async function expectAccessible(page: Page, label?: string): Promise<void> {
  const name = label ?? new URL(page.url()).pathname;
  await test.step(`axe ${name}`, async () => {
    await page.waitForLoadState("domcontentloaded");
    await expect(page, `document title on ${name}`).toHaveTitle(/\S/);
    const settled = () =>
      page.waitForFunction(
        () =>
          document
            .getAnimations()
            .every(
              (animation) =>
                animation.playState !== "running" ||
                animation.effect?.getTiming().iterations === Infinity,
            ),
        undefined,
        { timeout: 10_000 },
      );
    await settled();
    // A transition queued by the last render starts only on the next frame.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await settled();
    // The gallery player frame holds the video provider's own page, which the app cannot change.
    const results = await new AxeBuilder({ page })
      .exclude('[data-slot="gallery-player"]')
      .analyze();
    const problems: { id: string; impact: string; help: string; target: string }[] = [];
    for (const violation of results.violations) {
      if (!violation.impact || !blocking.has(violation.impact)) {
        test.info().annotations.push({
          type: `${violation.impact ?? "unrated"} a11y issue`,
          description: `${violation.id} on ${name}: ${violation.help} (${violation.nodes.length} nodes)`,
        });
        continue;
      }
      for (const node of violation.nodes) {
        const known = isKnown(violation.id, node.html);
        if (known) {
          test.info().annotations.push({
            type: "known a11y issue",
            description: `${violation.id} on ${name}: ${known.openItem}`,
          });
          continue;
        }
        problems.push({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          target: node.target.join(" "),
        });
      }
    }
    expect(problems, `serious or critical axe violations on ${name}`).toEqual([]);
  });
}
