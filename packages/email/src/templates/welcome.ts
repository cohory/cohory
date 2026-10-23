import { emailGreeting, emailSafeName } from "../names";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput, type EmailListItem } from "./layout";

export interface WelcomeInput {
  readonly name: string;
  readonly communityName: string;
  readonly creatorName: string | null;
  readonly communityBrand?: CommunityBrandInput;
  readonly introduceUrl: string;
  readonly feedUrl: string;
  readonly firstCourse: { readonly title: string; readonly url: string } | null;
  readonly nextEvent: {
    readonly title: string;
    readonly when: string;
    readonly url: string;
  } | null;
  readonly preferencesUrl: string;
}

export function welcomeEmail(input: WelcomeInput): EmailContent {
  const { communityName, firstCourse, nextEvent } = input;
  const creatorName = emailSafeName(input.creatorName);
  const meet = creatorName ? ` and meet ${creatorName}` : "";
  const items: EmailListItem[] = [{ label: "Start here: the community feed", url: input.feedUrl }];
  if (firstCourse) {
    items.push({ label: `First course: ${firstCourse.title}`, url: firstCourse.url });
  }
  if (nextEvent) {
    items.push({
      label: `Next event: ${nextEvent.title}`,
      url: nextEvent.url,
      note: `on ${nextEvent.when}`,
    });
  }
  return buildEmail({
    template: "welcome",
    subject: `Welcome to ${communityName}`,
    preheader: `Start here: introduce yourself${meet}.`,
    brand: communityBrand(communityName, input.communityBrand),
    body: [
      emailGreeting(input.name),
      `You're now a member of ${communityName}. Start here: introduce yourself${meet}. Say who you are and what you are building.`,
      { kind: "list", items },
    ],
    cta: { label: "Introduce yourself", url: input.introduceUrl },
    footer: {
      why: `You received this email once, because you joined ${communityName}.`,
      links: [{ label: "Manage notifications", url: input.preferencesUrl }],
    },
  });
}
