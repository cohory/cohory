import type { SetupStepKey } from "@cohory/communities";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import Link from "next/link";

import type { FullCommunityPage } from "../../lib/communities/load";
import { loadSetupChecklist, setupStepCopy } from "../../lib/manage/overview";
import { appUrl } from "../../lib/manage/views";
import { SetupMarkButton, ShareLinkButton } from "../manage/overview/setup-step-actions";
import { StepList } from "./welcome-card";

const feedStepKeys: readonly SetupStepKey[] = [
  "welcome_post",
  "branding",
  "about",
  "share",
  "stripe",
];

const linkClass =
  "rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export async function OwnerSetupCard({ page }: { page: FullCommunityPage }) {
  if (page.role !== "owner") return null;
  const slug = page.community.slug;
  const checklist = await loadSetupChecklist({
    actor: page.actor,
    role: page.role,
    communityId: page.community.id,
    slug,
  });
  const steps = checklist.steps.filter((step) => feedStepKeys.includes(step.key));
  const done = steps.filter((step) => step.done).length;
  if (checklist.hidden || done === steps.length) return null;
  const shareOpen = steps.some((step) => step.key === "share" && !step.done);

  return (
    <Card aria-labelledby="owner-setup-title">
      <CardHeader>
        <CardTitle as="h2" id="owner-setup-title" className="text-lg">
          Get your community ready
        </CardTitle>
        <CardDescription>
          {done} of {steps.length} done
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <StepList
          steps={steps.map((step) => ({
            key: step.key,
            title: setupStepCopy[step.key].title,
            done: step.done,
            href: step.href,
          }))}
        />
        <div className="flex flex-wrap items-center gap-3">
          {shareOpen ? (
            <ShareLinkButton slug={slug} url={`${appUrl().replace(/\/$/, "")}/c/${slug}`} />
          ) : null}
          <SetupMarkButton slug={slug} mark="hide" label="Hide checklist" variant="ghost" />
          <Link href={`/c/${encodeURIComponent(slug)}/manage`} className={linkClass}>
            All setup steps
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
