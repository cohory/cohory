import type { Rule } from "./types";

export const roles = ["platform_admin", "owner", "admin", "moderator", "member", "guest"] as const;

export type Role = (typeof roles)[number];

export type RoleRules = Readonly<Record<Role, Rule>>;

function rules(granted: Partial<Record<Role, Rule>>): RoleRules {
  return {
    platform_admin: "deny",
    owner: "deny",
    admin: "deny",
    moderator: "deny",
    member: "deny",
    guest: "deny",
    ...granted,
  };
}

const staff = { moderator: "allow", admin: "allow", owner: "allow" } as const;
const managers = { admin: "allow", owner: "allow" } as const;
const ownerOnly = { owner: "allow" } as const;
const allMembers = { member: "allow", ...staff } as const;
const entitledMembers = { member: "entitled", ...staff } as const;
const entitledOrPublicReaders = {
  guest: "public_community",
  member: "entitled_or_public_community",
  ...staff,
} as const;
const ownForAll = { member: "own", moderator: "own", admin: "own", owner: "own" } as const;
const ownOrStaff = { member: "own", ...staff } as const;

export const matrix = {
  community: {
    create: rules({ guest: "signed_in", ...allMembers, platform_admin: "allow" }),
    read: rules({ guest: "public_community", ...allMembers, platform_admin: "allow" }),
    update: rules(managers),
    delete: rules(ownerOnly),
    transfer_ownership: rules(ownerOnly),
    archive: rules(ownerOnly),
    change_slug: rules(ownerOnly),
  },
  membership: {
    read_own: rules({ guest: "signed_in", ...allMembers }),
    list: rules(entitledMembers),
    read_profile: rules(entitledMembers),
    update_own_profile: rules(allMembers),
    join: rules({ guest: "signed_in", ...allMembers }),
    leave: rules({ member: "allow", moderator: "allow", admin: "allow" }),
    approve: rules(staff),
    remove: rules({
      moderator: "target_member",
      admin: "target_member_or_moderator",
      owner: "target_not_self",
    }),
    ban: rules({
      moderator: "target_member",
      admin: "target_member_or_moderator",
      owner: "target_not_self",
    }),
    change_role: rules({ admin: "target_member_or_moderator", owner: "target_not_owner" }),
    reset_points: rules(managers),
    grant_comp: rules(managers),
    manage: rules(staff),
    read_email: rules(managers),
    assign_admin: rules(ownerOnly),
  },
  post: {
    read: rules(entitledOrPublicReaders),
    create: rules(entitledMembers),
    like: rules(entitledMembers),
    edit: rules(ownForAll),
    delete: rules(ownOrStaff),
    pin: rules(managers),
    move: rules(staff),
    email_all: rules(managers),
    unfollow: rules({ guest: "signed_in", ...allMembers, platform_admin: "allow" }),
    read_deleted: rules(staff),
    read_scheduled: rules(staff),
  },
  comment: {
    read: rules(entitledOrPublicReaders),
    create: rules(entitledMembers),
    like: rules(entitledMembers),
    edit: rules(ownForAll),
    delete: rules(ownOrStaff),
    read_deleted: rules(staff),
  },
  category: {
    manage: rules(managers),
    post_restricted: rules(staff),
  },
  course: {
    read: rules(entitledMembers),
    read_drafts: rules(managers),
    create: rules(managers),
    update: rules(managers),
    delete: rules(managers),
    publish: rules(managers),
    reorder: rules(managers),
    publish_agent_version: rules(managers),
    manage_agent_access: rules(managers),
  },
  lesson: {
    read: rules(entitledMembers),
    read_drafts: rules(managers),
    create: rules(managers),
    update: rules(managers),
    delete: rules(managers),
    publish: rules(managers),
    reorder: rules(managers),
    update_progress: rules(entitledMembers),
  },
  event: {
    read_title: rules({ guest: "public_community", ...allMembers }),
    read: rules(entitledMembers),
    create: rules(managers),
    update: rules(managers),
    delete: rules(managers),
    cancel_occurrence: rules(managers),
    rsvp: rules(entitledMembers),
    read_rsvps: rules(managers),
  },
  settings: {
    read: rules(managers),
    update: rules(managers),
    custom_domain: rules(ownerOnly),
  },
  appearance: {
    update: rules(managers),
  },
  invite: {
    manage: rules(managers),
  },
  export: {
    create: rules(ownerOnly),
    members: rules(ownerOnly),
  },
  migration: {
    export: rules(ownerOnly),
    import: rules(ownerOnly),
    import_members: rules(ownerOnly),
  },
  payment: {
    read: rules(managers),
    connect: rules(ownerOnly),
    edit_plan: rules(ownerOnly),
    refund: rules(ownerOnly),
    link_subscriptions: rules(managers),
    purchase: rules({ guest: "signed_in", member: "allow" }),
    read_own: rules({ guest: "signed_in", ...allMembers }),
  },
  webhook: {
    manage: rules(managers),
  },
  audit_log: {
    read: rules(managers),
    export: rules(ownerOnly),
  },
  report: {
    create: rules(allMembers),
    review: rules(staff),
  },
  review: {
    read: rules({ guest: "allow", ...allMembers, platform_admin: "allow" }),
    create: rules(allMembers),
    edit: rules(ownForAll),
    delete: rules(ownForAll),
    report: rules({ guest: "signed_in", ...allMembers }),
    reply: rules(ownerOnly),
    hide: rules(ownerOnly),
  },
  api_token: {
    create_own: rules(allMembers),
    read_all: rules(managers),
    manage_all: rules(ownerOnly),
  },
  agent: {
    read: rules(managers),
    create: rules(managers),
    create_own: rules(allMembers),
    manage: rules({ member: "own", moderator: "own", admin: "own", owner: "allow" }),
  },
  delegation: {
    create: rules(allMembers),
    manage: rules({ member: "own", moderator: "own", ...managers }),
    read_all: rules(managers),
  },
  submission: {
    create: rules(allMembers),
    read_own: rules(allMembers),
    read_summary: rules(managers),
  },
  approval: {
    read: rules(managers),
    decide: rules(managers),
    read_own: rules(allMembers),
  },
  leaderboard: {
    read: rules(entitledMembers),
  },
  account: {
    update_own: rules({ guest: "signed_in", ...allMembers, platform_admin: "allow" }),
  },
  notification: {
    read: rules({ guest: "signed_in", ...allMembers }),
    mark_read: rules({ guest: "signed_in", ...allMembers }),
  },
  creator_feedback: {
    answer: rules(ownerOnly),
  },
} as const satisfies Record<string, Record<string, RoleRules>>;

export type Matrix = typeof matrix;
export type Resource = keyof Matrix;
export type ActionOf<R extends Resource> = keyof Matrix[R] & string;

export const resources = Object.keys(matrix) as Resource[];
