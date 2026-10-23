import {
  ArrowLeftRight,
  Bell,
  Bot,
  CalendarDays,
  CreditCard,
  GraduationCap,
  Medal,
  MessagesSquare,
  PanelsTopLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { CloudPricing } from "../../lib/marketing/pricing";
import { Faq, MarketingSection, MoreLink, type FaqItem } from "./marketing-blocks";
import { currentCreatorCta, SignUpCta } from "./marketing-shell";

interface Feature {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly short: string;
  readonly body: string;
}

const features: readonly Feature[] = [
  {
    icon: MessagesSquare,
    title: "Feed",
    short: "Posts, comments, likes, and mentions.",
    body: "Posts with images and video, comments, likes, mentions, and categories.",
  },
  {
    icon: GraduationCap,
    title: "Courses",
    short: "Lessons with video, text, and files.",
    body: "Modules and lessons with video, text, and files. Members continue where they stopped.",
  },
  {
    icon: CalendarDays,
    title: "Events",
    short: "Weekly events, RSVPs, and reminders.",
    body: "Weekly events, RSVPs, reminders, and recordings, in each member's time zone.",
  },
  {
    icon: CreditCard,
    title: "Memberships",
    short: "Monthly and yearly plans on your Stripe.",
    body: "Monthly and yearly plans through your own Stripe. Members pause or cancel on their own.",
  },
  {
    icon: Bot,
    title: "AI agents",
    short: "Claude or ChatGPT, only as you allow.",
    body: "Claude, ChatGPT, or another assistant through MCP or the REST API, with only the permissions you give.",
  },
  {
    icon: ArrowLeftRight,
    title: "Import/Export",
    short: "Bring members in, take everything out.",
    body: "Bring members and posts from Skool or Circle, and members from a spreadsheet. Export your whole community any time.",
  },
  {
    icon: Medal,
    title: "Leaderboard",
    short: "Points, levels, and courses that unlock.",
    body: "Points for likes, and if you choose, for finished lessons and attended events. Levels unlock courses.",
  },
  {
    icon: Bell,
    title: "Notifications",
    short: "Weekly digest and event reminders.",
    body: "A weekly digest, event reminders, and a post emailed to every member.",
  },
  {
    icon: PanelsTopLeft,
    title: "Landing page",
    short: "A public About page for visitors.",
    body: "A public About page with a cover, a gallery, reviews from paying members, and a course preview for visitors.",
  },
];

const steps = [
  {
    title: "Create your community",
    body: "Pick a name and a web address. Add a logo and colors whenever you like.",
  },
  {
    title: "Add what members come for",
    body: "Write a welcome post, build your first course, and put an event on the calendar.",
  },
  {
    title: "Invite members and get paid",
    body: "Share an invite link. Connect Stripe when you are ready to charge for membership.",
  },
] as const;

function faqItems(pricing: CloudPricing): FaqItem[] {
  return [
    {
      question: "Do I need a credit card to start?",
      answer:
        "No. Creating an account and a community is free. You connect Stripe only when you want to charge members.",
    },
    {
      question: "What does it cost?",
      answer: `${pricing.feeLine} There is no monthly charge, and a free community pays nothing.`,
    },
    {
      question: "Are there limits?",
      answer: (
        <>
          Each community has fair use limits on members, file storage, and upload size.{" "}
          <MoreLink href="/pricing">See the limits</MoreLink>
        </>
      ),
    },
    {
      question: "Can I bring my community from Skool or Circle?",
      answer: (
        <>
          Yes. Upload your export, check the preview, then import your members and posts.{" "}
          <MoreLink href="/importers">See what moves</MoreLink>
        </>
      ),
    },
    {
      question: "Can I move to my own server later?",
      answer: (
        <>
          Yes. Export your community as an archive at any time and import it on a server that runs
          the Community Edition.{" "}
          <MoreLink href="/open-source">About the Community Edition</MoreLink>
        </>
      ),
    },
  ];
}

export function CloudLanding({ pricing }: { pricing: CloudPricing }) {
  return (
    <div className="flex flex-col">
      <section aria-labelledby="hero" className="flex max-w-3xl flex-col gap-5 pb-12">
        <h1 id="hero" className="text-3xl text-balance text-text sm:text-4xl">
          Your community, courses, and events in one place
        </h1>
        <p className="text-lg font-normal text-balance text-text-muted">
          Bring your members together, teach them, and get paid, on open source software you can
          take with you.
        </p>
        <SignUpCta className="pt-2" />
      </section>

      <MarketingSection id="features" title="What you get">
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {features.map((feature) => (
            <li
              key={feature.title}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 sm:gap-2 sm:p-5"
            >
              <div className="flex items-center gap-3">
                <feature.icon
                  aria-hidden="true"
                  className="size-6 shrink-0 text-accent"
                  strokeWidth={1.5}
                />
                <h3 className="text-lg text-text">{feature.title}</h3>
              </div>
              <p className="text-base text-text-muted sm:hidden">{feature.short}</p>
              <p className="hidden text-base text-text-muted sm:block">{feature.body}</p>
            </li>
          ))}
        </ul>
      </MarketingSection>

      <MarketingSection id="how-it-works" title="How it works">
        <ol className="grid gap-6 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-muted text-base font-semibold text-accent"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-lg text-text">{step.title}</h3>
                <p className="text-base text-text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </MarketingSection>

      <MarketingSection id="pricing" title="Pricing" lead={pricing.summary}>
        <p className="text-base text-text-muted">
          One plan with every feature and no monthly charge.
        </p>
        <MoreLink href="/pricing">See pricing and limits</MoreLink>
      </MarketingSection>

      <MarketingSection
        id="open-source"
        title="Open source, so you can leave"
        lead="The code is open source under the AGPL. Export your community at any time and run it on your own server with the Community Edition, which has no platform fee."
      >
        <MoreLink href="/open-source">About the Community Edition</MoreLink>
      </MarketingSection>

      <MarketingSection id="questions" title="Questions">
        <Faq items={faqItems(pricing)} />
      </MarketingSection>

      <section
        aria-labelledby="start"
        className="flex flex-col items-start gap-4 border-t border-border pt-12"
      >
        <h2 id="start" className="text-2xl text-text">
          {currentCreatorCta() === "create" ? "Start your community today" : "Start your community"}
        </h2>
        <SignUpCta />
      </section>
    </div>
  );
}
