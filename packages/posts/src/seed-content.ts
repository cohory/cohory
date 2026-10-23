import type { CategoryColor } from "@cohory/db/schema";
import { devAdmin, devCreators, devMember, devSeed } from "@cohory/db/seed";

export interface SeedCategory {
  readonly name: string;
  readonly color: CategoryColor;
  readonly staffOnly?: boolean;
}

export interface SeedComment {
  readonly author: string;
  readonly text: string;
  readonly replies?: readonly { readonly author: string; readonly text: string }[];
}

export interface SeedPost {
  readonly author: string;
  readonly category: string;
  readonly title: string;
  readonly body: unknown;
  readonly pinned?: true;
  readonly comments?: readonly SeedComment[];
}

type Inline = { type: "text"; text: string; marks?: { type: "bold" }[] };

function paragraph(...parts: (string | Inline)[]): unknown {
  return {
    type: "paragraph",
    content: parts.map((part) => (typeof part === "string" ? { type: "text", text: part } : part)),
  };
}

function bold(text: string): Inline {
  return { type: "text", text, marks: [{ type: "bold" }] };
}

function list(...items: string[]): unknown {
  return {
    type: "bulletList",
    content: items.map((text) => ({ type: "listItem", content: [paragraph(text)] })),
  };
}

export function doc(...content: unknown[]): unknown {
  return {
    type: "doc",
    content: content.map((block) => (typeof block === "string" ? paragraph(block) : block)),
  };
}

const [maya, diego, priya, sam] = devCreators;
const owner = devSeed.email;
const admin = devAdmin.email;

export const creatorsCategories: readonly SeedCategory[] = [
  { name: "Introductions", color: "info" },
  { name: "Ideas and feedback", color: "accent" },
  { name: "Questions", color: "neutral" },
  { name: "Wins", color: "success" },
  { name: "Announcements", color: "warning", staffOnly: true },
  { name: "Bugs", color: "danger" },
];

const welcome: SeedPost = {
  author: owner,
  category: "Announcements",
  title: "Welcome to Cohory Creators: how to give feedback",
  pinned: true,
  body: doc(
    "This is where creators who run their community on Cohory talk with the Cohory team. We read every post.",
    paragraph(bold("How to give feedback")),
    list(
      "Ideas and feedback is the place for requests. Search first, then like the ideas you want. Likes count as votes.",
      "Bugs: post what you did, what you expected, and what happened. For anything about payments or private data, use the contact page at /contact instead.",
      "Questions: ask how to do something. Other creators often answer first.",
      "Wins: share a launch, your first paying member, or a course people finished.",
    ),
    "The team replies in the thread, and the pinned Roadmap post says what is planned. Start by introducing yourself in Introductions.",
  ),
  comments: [
    {
      author: admin,
      text: "I help run this community. Tag me in any thread you want the team to look at.",
      replies: [
        { author: owner, text: "Replies stay one level deep, so threads stay easy to follow." },
      ],
    },
  ],
};

const roadmap: SeedPost = {
  author: owner,
  category: "Announcements",
  title: "Roadmap: now, next, later",
  pinned: true,
  body: doc(
    "What we are working on, in plain words. Nothing here has a date, and we update this post when plans change.",
    paragraph(bold("Now")),
    list(
      "An external security review before Cloud takes live payments.",
      "An install and load test on a reference server with a public domain.",
      "Checking Stripe onboarding and invoices by hand in test and live mode.",
    ),
    paragraph(bold("Next (in the backlog, not scheduled)")),
    list(
      "Edit one date of a repeating event.",
      "A capacity and a waitlist for events.",
      "Approve every join request that answers all required questions at once.",
      "Smaller copies of covers and gallery images uploaded before resizing existed.",
    ),
    paragraph(bold("Later (open questions, no decision yet)")),
    list(
      "Importing course content from other platforms, for example as Markdown.",
      "Two factor authentication.",
      "MCP resources and prompts next to the existing tools.",
    ),
    paragraph(bold("Not planned")),
    list(
      "Running agent course evaluations for you. Cohory never runs scripts or evaluations.",
      "Members connecting AI assistants through OAuth. For now that stays with creators and admins.",
      "Polar as a payment provider. Its policy does not allow community access, so it stays off.",
    ),
    "Want something that is not here? Post it in Ideas and feedback.",
  ),
};

const shipped: SeedPost = {
  author: admin,
  category: "Announcements",
  title: "Shipped this week: Cohory 0.11.0",
  body: doc(
    "Cohory 0.11.0 is out. It is the first release with a summarized changelog. The highlights:",
    list(
      "Community: About pages, public or private communities, open, approval, or invite only joining, categories, pinning, scheduled posts, and announcement emails.",
      "Courses: modules and lessons with video, Markdown, and attachments, plus structured lessons for agents.",
      "Events: one time and weekly events with RSVP, reminder emails, and calendar downloads.",
      "Payments: one paid plan per community with monthly and yearly prices through Stripe Checkout, comped access, and pausing.",
      "Agents and API: a REST API, an MCP server, scoped tokens, and human approval for agent actions on money and roles.",
      "Migration: archive export and import, and importers for Skool, Circle, and member spreadsheets.",
    ),
    paragraph(bold("Since 0.11.0")),
    list(
      "A contact page at /contact that emails the team, for questions that should not be public.",
      "The logo on sign in and other account pages now sits just above the card.",
    ),
  ),
};

export const creatorsPosts: readonly SeedPost[] = [
  roadmap,
  welcome,
  shipped,
  {
    author: maya.email,
    category: "Introductions",
    title: "Hi, I'm Maya from Clay at Home",
    body: doc(
      "I teach ceramics to people who work from a garage or a kitchen table. About 400 members, moving over from a Facebook group this month.",
      "I am here to learn how others set up their Classroom, and to ask a lot of questions.",
    ),
    comments: [{ author: owner, text: "Welcome, Maya. Glad to have you here." }],
  },
  {
    author: priya.email,
    category: "Ideas and feedback",
    title: "Import course content from Skool",
    body: doc(
      "The Skool importer brought my members and posts over, but my three courses had to be rebuilt by hand. An importer for course content would have saved me a weekend.",
    ),
    comments: [
      {
        author: owner,
        text: "Thanks, Priya. Skool exports do not include course content, so this needs another way in, for example Markdown files. It is on the roadmap under Later. Like this post if you want it too.",
      },
    ],
  },
  {
    author: diego.email,
    category: "Questions",
    title: "Can members pay yearly?",
    body: doc(
      "I want to offer a discount for a full year. Is that possible, or only monthly prices?",
    ),
    comments: [
      {
        author: admin,
        text: "Yes. Each paid plan has a monthly price and an optional yearly price. Set both in Manage, Payments.",
        replies: [{ author: diego.email, text: "Found it, thanks." }],
      },
    ],
  },
  {
    author: maya.email,
    category: "Wins",
    title: "First 10 paying members in one week",
    body: doc(
      "I opened the paid tier on Monday and had 10 paying members by Sunday. The About page with the gallery did most of the work.",
    ),
    comments: [{ author: devMember.email, text: "Congratulations, that is a great first week." }],
  },
  {
    author: sam.email,
    category: "Bugs",
    title: "My old cover loads slowly on phones",
    body: doc(
      "The cover I uploaded in September takes a few seconds to load on my phone. New covers look fine.",
    ),
    comments: [
      {
        author: owner,
        text: "Covers uploaded before resizing existed keep one full size file. Upload the cover again and Cohory makes smaller copies. Fixing older uploads for everyone is in the backlog.",
      },
    ],
  },
  {
    author: devMember.email,
    category: "Ideas and feedback",
    title: "Edit one date of a repeating event",
    body: doc(
      "My weekly call moves to Wednesday once a month. Today I cancel that date and create a separate event. Editing one date would be simpler.",
    ),
  },
];

export const proCategories: readonly SeedCategory[] = [
  { name: "General", color: "neutral" },
  { name: "Wins", color: "success" },
  { name: "Announcements", color: "warning", staffOnly: true },
];

export const proPosts: readonly SeedPost[] = [
  {
    author: owner,
    category: "Announcements",
    title: "Welcome to Cohory Pro",
    pinned: true,
    body: doc(
      "This private paid community is for trying memberships on a local stack.",
      "Join from the About page or with the invite link, then pay with a Stripe test card such as 4242 4242 4242 4242. Nothing is charged for real.",
    ),
  },
];
