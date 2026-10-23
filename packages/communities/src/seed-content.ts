import { devJoinQuestions } from "@cohory/db/seed";

import type { UpdateAboutInput } from "./manage/schemas";

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function heading(text: string) {
  return { type: "paragraph", content: [{ type: "text", text, marks: [{ type: "bold" }] }] };
}

function list(...items: string[]) {
  return {
    type: "bulletList",
    content: items.map((text) => ({ type: "listItem", content: [paragraph(text)] })),
  };
}

const hostBio =
  "Riza builds Cohory, the open source platform for paid communities, reads every post here, and answers questions on the weekly office hours call.";

export const creatorsAbout = {
  whatYouGet: [
    "A direct line to the people who build Cohory",
    "A say in what we build next, through likes on ideas",
    "Weekly office hours with the team",
    "Early looks at new features before they ship",
    "Other creators to swap notes with",
  ],
  hostBio,
  hostCredential: "Founder of Cohory",
  faq: [
    {
      q: "Who can join?",
      a: "Anyone who runs a community on Cohory, or is about to. Answer the three join questions and we approve requests within a day or two.",
    },
    {
      q: "Where do I report a bug?",
      a: "Post it in Bugs with the steps that cause it. If it involves payments or private data, use the contact page instead.",
    },
    {
      q: "Does a like on an idea mean you will build it?",
      a: "No. Likes help us see what matters to many creators. The pinned Roadmap post says what is actually planned.",
    },
  ],
  detailedDescription: {
    type: "doc",
    content: [
      paragraph(
        "Cohory Creators is where creators who run their community on Cohory talk with the Cohory team. Tell us what works, what gets in your way, and what you want next.",
      ),
      heading("How it works"),
      list(
        "Ideas and feedback: post a request. Likes count as votes, so like the ideas you want too.",
        "Bugs: tell us what you did, what you expected, and what happened.",
        "Wins: share your first paying member, a launch, or a course people finished.",
        "Announcements: release notes and what changed, from the team.",
      ),
      paragraph(
        "The team reads every post and replies in the thread. The pinned Roadmap post shows what we are working on now, what comes next, and what we do not plan to build.",
      ),
    ],
  },
} satisfies UpdateAboutInput;

export const proAbout = {
  whatYouGet: [
    "A private feed for paying members",
    "Monthly and yearly plans, cancel anytime",
    "Everything a paid community gets on Cohory",
  ],
  hostBio,
  hostCredential: "Founder of Cohory",
  faq: [
    {
      q: "Is this a real paid community?",
      a: "It is a test community. On a local stack, checkout runs in Stripe test mode, so use a test card such as 4242 4242 4242 4242.",
    },
  ],
  detailedDescription: {
    type: "doc",
    content: [
      paragraph(
        "Cohory Pro is a private paid community for trying memberships end to end: the price on the About page, checkout, the Membership page, and the billing portal.",
      ),
      paragraph(
        "Join with a Stripe test card. Nothing here is charged for real, and the content is for testing only.",
      ),
    ],
  },
} satisfies UpdateAboutInput;

export const creatorsJoinQuestions = devJoinQuestions.map((question) => ({ ...question }));

export const creatorsGallery = [
  {
    file: "cohory-creators-gallery-feedback.png",
    altText: "Ideas and feedback: post a request, likes count as votes",
  },
  {
    file: "cohory-creators-gallery-office-hours.png",
    altText: "Weekly office hours on Thursdays at 17:00 Berlin time",
  },
  {
    file: "cohory-creators-gallery-roadmap.png",
    altText: "The roadmap in three columns: now, next, and later",
  },
  {
    file: "cohory-creators-gallery-wins.png",
    altText: "A rising line for the wins creators share",
  },
] as const;
