import { defaultAccent, getManageService } from "@cohory/communities";
import {
  faqAnswerMaxLength,
  faqQuestionMaxLength,
  hostBioMaxLength,
  hostCredentialMaxLength,
  maxFaqItems,
  maxWhatYouGetItems,
  whatYouGetItemMaxLength,
} from "@cohory/db/schema";
import { Button } from "@cohory/ui";
import { Eye } from "lucide-react";
import type { Metadata } from "next";

import { AboutEditor } from "../../../../../components/manage/about-editor";
import { AppearanceForm } from "../../../../../components/manage/appearance-form";
import { GalleryManager } from "../../../../../components/manage/gallery-manager";
import { PreviewAboutLink } from "../../../../../components/manage/overview/setup-step-actions";
import { aboutPreviewHref } from "../../../../../lib/communities/preview";
import { requireManagePage } from "../../../../../lib/manage/load";
import { documentToText, toPostDocument } from "../../../../../lib/posts/document";

export const metadata: Metadata = { title: "Appearance" };

const aboutLimits = {
  whatYouGetItems: maxWhatYouGetItems,
  whatYouGetLength: whatYouGetItemMaxLength,
  hostBioLength: hostBioMaxLength,
  hostCredentialLength: hostCredentialMaxLength,
  faqItems: maxFaqItems,
  faqQuestionLength: faqQuestionMaxLength,
  faqAnswerLength: faqAnswerMaxLength,
};

export default async function ManageAppearancePage({
  params,
}: PageProps<"/c/[slug]/manage/appearance">) {
  const manage = await requireManagePage((await params).slug, "appearance");
  const service = getManageService();
  const [view, gallery] = await Promise.all([
    service.getAppearance(manage.communityId),
    service.listGallery(manage.communityId),
  ]);
  const { community } = manage.page;
  const { about } = view;

  return (
    <>
      <h2 className="text-2xl font-semibold text-text">Appearance</h2>
      <AppearanceForm
        slug={manage.slug}
        communityName={community.name}
        defaultAccent={defaultAccent}
        initial={{
          accent: view.accent,
          font: view.font,
          cardStyle: view.cardStyle,
          theme: view.theme,
          logoUrl: view.logoUrl,
          coverUrl: view.coverUrl,
          notices: [...view.notices],
          light: { ...view.tokens.light },
          dark: { ...view.tokens.dark },
        }}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-text">About page</h3>
        <Button asChild variant="secondary" className="min-h-11">
          <PreviewAboutLink slug={manage.slug} href={aboutPreviewHref(manage.slug)}>
            <Eye aria-hidden="true" className="size-5" strokeWidth={1.5} />
            View About page
          </PreviewAboutLink>
        </Button>
      </div>
      <p className="-mt-2 text-sm text-text-muted">
        People who are not members see this page first. It is your sales page: the cover and short
        description sit above the join button, and the rest follows below.
      </p>
      <GalleryManager slug={manage.slug} initial={gallery} />
      <AboutEditor
        slug={manage.slug}
        limits={aboutLimits}
        initial={{
          description: community.description ?? "",
          whatYouGet: about.whatYouGet,
          detailedText: view.detailedDescription
            ? documentToText(toPostDocument(view.detailedDescription))
            : "",
          hostBio: about.host?.bio ?? "",
          hostCredential: about.host?.credential ?? "",
          faq: about.faq,
        }}
      />
    </>
  );
}
