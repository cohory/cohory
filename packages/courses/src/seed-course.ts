export interface SeedLesson {
  readonly title: string;
  readonly body: string;
  readonly videoUrl?: string;
  readonly draft?: true;
}

export interface SeedModule {
  readonly title: string;
  readonly lessons: readonly SeedLesson[];
}

export const devCourse = {
  title: "How to use Cohory Classroom",
  description:
    "A short guide to Classroom: how members learn, how to build a course with modules and lessons, how to publish, how to design a classroom people finish, and how AI agents can work with your courses.",
} as const;

const whatClassroomIs = `# What Classroom is

Classroom is one of the four tabs every member sees: **Community**, **Classroom**, **Calendar**, and **Members**. It holds the courses of this community.

A course is made of **modules**, and each module holds **lessons**. A lesson can have:

- a title
- a video from YouTube, Vimeo, Loom, or Wistia
- written content in Markdown
- up to 10 attached files

## Who can do what

| Person | What they can do |
|--------|------------------|
| Members | Open published courses, read lessons, and mark them complete |
| Owner and admins | Create courses, edit the outline, write lessons, and publish |
| People who have not joined | See how many courses there are, and a button to join |

Every course is open to every member of the community. If the community is paid, the membership is what gives access. There are no separate prices per course.

## How this course works

Read each lesson, then choose **Mark complete** at the bottom. Use **Previous** and **Next** to move between lessons, or open the lesson list with **Show lessons**.`;

const howMembersLearn = `# How members take a course

This is what your members see, so it helps to try it yourself first.

## The course list

The **Classroom** tab shows a card for each published course with its cover, title, short description, and a **Course progress** bar.

## The course page

The course page lists every module and its lessons, with a tick next to the ones you finished. The main button changes as you go:

- **Start** when you have not finished any lesson yet
- **Continue** opens the first lesson you have not finished
- **Review** opens the first lesson once you finished them all

## Inside a lesson

The video comes first, then the written content, then attached files. The bar at the bottom has **Previous**, **Mark complete**, and **Next**. After you mark a lesson complete, the button says **Completed** and **Next** becomes the main action.

Keyboard shortcuts: the left and right arrow keys move between lessons, and **M** marks the lesson complete.

## Picking up where you left off

When a member has a course in progress, a **Continue learning** card appears at the top of the Community feed. One tap opens the right lesson.`;

const createCourse = `# Create a course

Only the owner and admins can create courses.

1. Open **Classroom**.
2. Choose **New course**. In an empty classroom the button says **Create a course**.
3. Fill in the form:
   - **Title**: what the course teaches, in a few words.
   - **Short description**: one or two sentences shown on the course card.
   - **Cover image**: optional. Choose **Add cover**. A wide image works best.
4. Choose **Create course**.

The new course starts as a **Draft**. Members do not see it until you publish it.

## Changing the course later

On the course page, open the actions menu next to the title and choose **Course settings** to change the title, description, or cover.

## Who gets access

Every published course is open to every member. To charge for a course, charge for the community membership in Manage, Payments. Unlocking courses by level and one time course purchases are not part of Cohory today.`;

const modulesAndLessons = `# Modules and lessons

Modules group lessons into steps. A course with three to six modules is easy to scan.

## Build the outline

1. Open the course and choose **Edit outline**.
2. Choose **Add module**, type a **Module title**, and press Enter.
3. In the module, choose **Add lesson**. The lesson starts with the title "New lesson" as a draft.
4. Choose **Done editing** when the outline looks right.

## Rename, delete, and reorder

Each module and lesson has an actions menu with **Rename module**, **Delete module**, or **Delete lesson**.

To reorder, drag a module or lesson by its handle. With a keyboard, focus the handle, press Space to pick it up, use the arrow keys to move it, Space to drop it, or Escape to cancel. Screen readers announce each step.

Lessons move within their module.`;

const writeLesson = `# Write a lesson

Open a lesson and choose **Edit lesson**. The **Lesson editor** has these fields:

- **Title**
- **Video link**: paste a YouTube, Vimeo, Loom, or Wistia link. Cohory does not host video files, so upload the video to one of those first.
- **Lesson content**: write in Markdown. Use \`#\` for headings, \`-\` for lists, and three backticks for code blocks.
- **Add attachment**: attach up to 10 files, such as PDF worksheets, ZIP files with templates, images, or text files. Members download them from the lesson.

Choose **Save** to keep your changes.

## A small Markdown example

\`\`\`markdown
## Before you start

- Open your community
- Pick one topic

**Tip:** one lesson, one idea.
\`\`\`

Raw HTML is not allowed in lessons, and links open in a new tab.`;

const draftsAndPublishing = `# Drafts and publishing

Courses and lessons are either **Draft** or **Published**.

- A draft course is visible only to the owner and admins, with a **Draft** badge.
- A draft lesson inside a published course stays hidden from members until you publish it.

## Publish

- Course: on the course page, switch **Draft** to **Published**. Members see it in Classroom right away.
- Lesson: on the lesson page, next to **Edit lesson**, switch **Draft** to **Published**.

Switch back to **Draft** to hide something again. Member progress is kept.

## Delete

Choose **Delete course** in the course actions menu. If members have progress in it, the course is archived instead so their progress is kept. Archived courses show an **Archived** badge.

The next lesson in this course is a draft, so the owner and admins can see how drafts look.`;

const draftExample = `# A draft lesson

This lesson is a draft. Owners and admins see it with a **Draft** badge, and members do not see it at all.

Switch it to **Published** at the top of the lesson to show it to members.`;

const planOrder = `# Plan the course order

Members finish courses that feel short and clear. A few habits help.

## Start with the outcome

Write down what a member can do at the end. Then list the steps to get there. Each step becomes a module.

## Order courses in Classroom

Classroom lists courses in the order you created them. Create the course a new member should take first before the others. A short "start here" course works well as the first one.

## Keep lessons short

- One idea per lesson.
- Videos of 3 to 10 minutes are easier to finish than one long recording.
- Put the steps in writing under the video, so members can skim and come back.
- Attach worksheets and templates instead of linking to many places.

## Name things plainly

Use lesson titles that say what happens: "Write your welcome post" tells more than "Lesson 3".`;

const coversAndLook = `# Covers and the look of your classroom

## Course covers

Course cards show the cover at **16:9**. Use an image of at least 1280 by 720 pixels and keep the important part in the middle, because cards are smaller on phones.

Courses without a cover show a letter tile in your accent color, which also looks tidy. Covers work best when every course uses the same style.

## Your community's look

Owners and admins set the logo, cover, and accent color in Manage, Appearance. The accent color also colors buttons and course letter tiles in Classroom.

## Check it as a member

Ask a member, or a second account, to open the course on a phone. Check that the titles fit, the cover reads well, and **Continue learning** shows up on the feed after the first lesson.`;

const agentsAccess = `# Work with AI agents: tokens, MCP, and permissions

Cohory lets AI assistants work with your community through the same API that the web app uses. Everything an agent does is limited by permissions you choose and recorded in the audit log.

## Two kinds of tokens

- **Personal tokens**: in Account, **API tokens**, choose **Create token**. The token acts as you, in one community, with the permissions you pick.
- **Agent tokens**: owners and admins create an agent in Manage, Settings, Agents with **Create agent**, then issue a token for it. Anything the agent writes shows an Agent badge.

A token is shown once. Store it like a password.

## Course permissions

| Permission | What it allows |
|------------|----------------|
| \`courses:read\` | Read courses and lessons, continue learning, and record your own progress |
| \`courses:write\` | Create and edit courses, modules, and lessons (owner and admins) |

With \`courses:write\`, an agent can draft a course and its lessons through the API. Publishing a course or lesson by an agent is an approval request: a person approves it in Manage, Approvals before anything changes.

## MCP

Assistants that speak the Model Context Protocol connect to your community at \`/mcp\`. When an assistant connects, you pick the community, name the agent, and choose permissions. Read permissions are selected for you and write permissions start unchecked. Connected apps are listed in Account, Connected apps, where you can disconnect them.`;

const agentsMaterial = `# Work with AI agents: agent material and agent access

Courses can carry extra material written for agents, so a member's assistant can help them practice.

## Agent material (owners and admins)

1. Open a lesson, choose **Edit lesson**, and open the **For agents** tab.
2. Choose **Draft from lesson** to start from the lesson's headings, numbered exercises, and code blocks. No AI service is used for this.
3. Fill in the **Objective** and **Instructions**, add reference files and templates, and add tasks with the input and expected output.
4. Choose **Preview what agents read**, then **Save agent material**.
5. On the course page, choose **Publish agent version**. The first version is 1.0.0. Each version can be downloaded as a skill.

## Agent access to a course

Below the lessons, owners and admins see the Agent access card. Turn on **Allow agent access** and pick the license terms. It is off for every course until you turn it on.

Members then choose **Give my agent access**, pick one of their agents, read the terms, and choose **Agree and give access**. The agent can read the course for 30 days. Members can renew or revoke it on the course page or in Account, Agents.

Agents can only read courses. They cannot mark lessons complete, see other members, or buy anything on their own. Course material is always treated as data for the agent, never as instructions to follow.`;

export const devCourseOutline: readonly SeedModule[] = [
  {
    title: "Start here",
    lessons: [
      { title: "What Classroom is", body: whatClassroomIs },
      { title: "How members take a course", body: howMembersLearn },
    ],
  },
  {
    title: "Build a course",
    lessons: [
      { title: "Create a course", body: createCourse },
      { title: "Modules and lessons", body: modulesAndLessons },
      { title: "Write a lesson", body: writeLesson },
      { title: "Drafts and publishing", body: draftsAndPublishing },
      { title: "A draft lesson", body: draftExample, draft: true },
    ],
  },
  {
    title: "Design a good classroom",
    lessons: [
      { title: "Plan the course order", body: planOrder },
      { title: "Covers and the look of your classroom", body: coversAndLook },
    ],
  },
  {
    title: "Work with AI agents",
    lessons: [
      { title: "Tokens, MCP, and permissions", body: agentsAccess },
      { title: "Agent material and agent access", body: agentsMaterial },
    ],
  },
];
