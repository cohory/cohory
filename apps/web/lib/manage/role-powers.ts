import type { AssignableRole } from "@cohory/communities";

export interface RolePowers {
  readonly can: readonly string[];
  readonly cannot: readonly string[];
}

export const rolePowers: Readonly<Record<AssignableRole, RolePowers>> = {
  admin: {
    can: [
      "Change settings, appearance, categories, and join rules",
      "Create invite links",
      "Approve join requests and review reports",
      "Remove or ban members and moderators",
      "Make people moderators",
      "See Payments, grant free access, and link existing subscriptions",
    ],
    cannot: [
      "Change prices, connect payments, or refund",
      "Make admins",
      "Transfer or delete the community",
      "Download the members CSV",
    ],
  },
  moderator: {
    can: [
      "Approve join requests",
      "Review reports",
      "Delete or move any post or comment",
      "Remove or ban members",
    ],
    cannot: ["Change settings or roles", "See Payments", "Create invite links"],
  },
  member: {
    can: ["Post, comment, take courses, and RSVP like everyone else"],
    cannot: ["Open Manage or act on other people"],
  },
};
