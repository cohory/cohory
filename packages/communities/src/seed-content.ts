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
    "A live session every week on one part of running a paid community",
    "Playbooks for pricing, launch posts, onboarding, and renewals",
    "A review of your About page and pricing from the host",
  ],
  hostBio,
  hostCredential: "Founder of Cohory",
  faq: [
    {
      q: "Can I cancel anytime?",
      a: "Yes. Cancel from the billing portal and you keep access until the end of the period you paid for.",
    },
    {
      q: "Is it for me if I have no paying members yet?",
      a: "Yes. Many members join while they plan their first paid launch.",
    },
  ],
  detailedDescription: {
    type: "doc",
    content: [
      paragraph(
        "Cohory Pro is for creators who charge for their community, or plan to. Each week there is a live session on one topic: setting a price, writing the launch post, welcoming new members, or keeping them past the first month.",
      ),
      paragraph(
        "Members get the playbook from every session and can ask for a review of their About page and pricing.",
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
