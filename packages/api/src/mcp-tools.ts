import { agentCourseTools } from "./agent-course-tools";
import type { McpToolAnnotations, McpToolMeta, OperationId } from "./route-meta";

const read: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const create: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const destructive: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

function tool(
  name: string,
  title: string,
  description: string,
  annotations: McpToolAnnotations,
  options: Partial<Pick<McpToolMeta, "userContent" | "agentProposal" | "omit" | "require">> = {},
): McpToolMeta {
  return {
    tool: name,
    title,
    description,
    annotations,
    userContent: options.userContent ?? true,
    ...(options.agentProposal ? { agentProposal: true } : {}),
    ...(options.omit ? { omit: options.omit } : {}),
    ...(options.require ? { require: options.require } : {}),
  };
}

export const mcpTools: Readonly<Partial<Record<OperationId, readonly McpToolMeta[]>>> = {
  getCommunity: [
    tool(
      "get_community",
      "Get the community",
      "Name, description, privacy, member count, and categories of the community this token belongs to.",
      read,
      { userContent: true },
    ),
  ],
  getCommunitySettings: [
    tool(
      "get_community_settings",
      "Get community settings",
      "The community's current settings: name, description, privacy, join rules, and categories. Owners and admins only.",
      read,
      { userContent: true },
    ),
  ],
  updateCommunitySettings: [
    tool(
      "propose_settings_change",
      "Propose a settings change",
      "Ask a person to approve a change to the community settings. Nothing changes until an owner or admin approves it. Send only the fields to change.",
      destructive,
    ),
  ],

  listPosts: [
    tool(
      "list_posts",
      "List posts",
      "Published posts in the feed, a page at a time. Pass nextCursor back as cursor for the next page.",
      read,
      { userContent: true },
    ),
  ],
  getPost: [
    tool(
      "get_post",
      "Get a post",
      "One post with its title, body, author, and counts. Use list_comments for its comments.",
      read,
      { userContent: true },
    ),
  ],
  listComments: [
    tool(
      "list_comments",
      "List comments on a post",
      "Comments and replies on one post, a page at a time.",
      read,
      { userContent: true },
    ),
  ],
  createPost: [
    tool(
      "create_draft_post",
      "Create a draft post",
      "Write a post. Posts from an agent are saved as drafts that a person publishes from Manage, Settings, Agents.",
      create,
      { omit: ["scheduledAt"] },
    ),
    tool(
      "schedule_post",
      "Schedule a post",
      "Write a post that is published at scheduledAt. For an agent this asks a person to approve the scheduled post first.",
      create,
      { require: ["scheduledAt"], agentProposal: true },
    ),
  ],
  listScheduledPosts: [
    tool(
      "list_scheduled_posts",
      "List scheduled posts",
      "Posts waiting to be published, soonest first.",
      read,
      { userContent: true },
    ),
  ],
  listPostDrafts: [
    tool(
      "list_post_drafts",
      "List draft posts",
      "Drafts waiting for a person to publish them. An agent sees only its own drafts.",
      read,
      { userContent: true },
    ),
  ],

  searchMembers: [
    tool(
      "list_members",
      "List members",
      "The member directory, filtered by a name or username prefix, a page at a time.",
      read,
      { userContent: true },
    ),
  ],
  listReviews: [
    tool(
      "list_reviews",
      "List reviews",
      "Visible member reviews of the community, newest first, a page at a time (pass nextCursor as cursor), optionally only one star rating. Each review has its stars, text, the reviewer's paying status, and the owner's reply. Review text is written by members.",
      read,
      { userContent: true },
    ),
  ],
  getReviewSummary: [
    tool(
      "get_review_summary",
      "Get the review summary",
      "Number of reviews, the average (from 3 reviews), the count per star rating, and how many reviews the owner hid and why.",
      read,
      { userContent: false },
    ),
  ],
  listManagePeople: [
    tool(
      "find_inactive_members",
      "Find inactive members",
      "Active members with no posts, comments, likes, lesson views, RSVPs, or sign ins in the last inactiveDays days. Moderators, admins, and owners only.",
      read,
      { userContent: true, require: ["inactiveDays"] },
    ),
  ],
  getMemberProfile: [
    tool(
      "get_member",
      "Get a member",
      "One member's profile: name, username, bio, role, level, and points.",
      read,
      { userContent: true },
    ),
  ],
  removeMember: [
    tool(
      "remove_member",
      "Remove a member",
      "Remove someone from the community. For an agent this asks an owner or admin to approve the removal; nothing changes until they do.",
      destructive,
    ),
  ],
  banMember: [
    tool(
      "ban_member",
      "Ban a member",
      "Ban someone so they cannot join again. For an agent this asks an owner or admin to approve the ban; nothing changes until they do.",
      destructive,
    ),
  ],

  searchCommunity: [
    tool(
      "search_community",
      "Search the community",
      "Full text search over posts and comments the caller can read.",
      read,
      { userContent: true },
    ),
  ],

  listCalendarOccurrences: [
    tool(
      "list_events",
      "List events",
      "Event dates between from and to, with the going count and the caller's RSVP.",
      read,
      { userContent: true },
    ),
  ],
  getCalendarEvent: [
    tool(
      "get_event",
      "Get an event",
      "One event with its schedule. Location and recording link are visible to members only.",
      read,
      { userContent: true },
    ),
  ],
  getCalendarOccurrence: [
    tool(
      "get_event_occurrence",
      "Get an event date",
      "One date of an event with how many people are going and the caller's RSVP.",
      read,
      { userContent: true },
    ),
  ],
  listCalendarOccurrenceRsvps: [
    tool(
      "list_event_rsvps",
      "List who is going to an event date",
      "The members going to one date of an event, with their names and when they answered. Owners and admins only.",
      read,
      { userContent: true },
    ),
  ],
  createCalendarEvent: [
    tool(
      "create_event",
      "Create an event",
      "Create a one time or repeating event in the calendar.",
      create,
      { omit: ["notifyMembers"] },
    ),
  ],
  deleteCalendarEvent: [
    tool(
      "cancel_event_series",
      "Cancel an event and all its dates",
      "Delete an event with every date in its series. For an agent this asks an owner or admin to approve it first.",
      destructive,
    ),
  ],

  getApprovalRequest: [
    tool(
      "get_approval_status",
      "Get an approval request",
      "The state of one approval request this agent made: pending, executed, rejected, failed, or expired.",
      read,
      { userContent: true },
    ),
  ],
  listApprovalRequests: [
    tool(
      "list_my_approval_requests",
      "List my approval requests",
      "Approval requests this agent made, newest first.",
      read,
      { userContent: true },
    ),
  ],

  getPaymentsLedgerSummary: [
    tool(
      "get_payments_summary",
      "Get a payments summary",
      "Gross, refunds, tax, and platform fees per currency. Read only. Owners only.",
      read,
    ),
  ],

  ...agentCourseTools,
};
