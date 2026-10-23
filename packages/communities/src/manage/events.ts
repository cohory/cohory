export const membershipEventsTopic = "membership.events";

export type MembershipEvent =
  | {
      readonly type: "join_request.created";
      readonly payload: {
        readonly communityId: string;
        readonly requestId: string;
        readonly userId: string;
      };
    }
  | {
      readonly type: "join_request.decided";
      readonly payload: {
        readonly communityId: string;
        readonly requestId: string;
        readonly userId: string;
        readonly decidedBy: string;
        readonly status: "approved" | "declined";
      };
    }
  | {
      readonly type: "ownership.transferred";
      readonly payload: {
        readonly communityId: string;
        readonly noticeId: string;
        readonly previousOwnerId: string;
        readonly newOwnerId: string;
      };
    };

export type MembershipEventName = MembershipEvent["type"];
