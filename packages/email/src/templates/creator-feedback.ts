import { headerSafe, instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail } from "./layout";

export interface CreatorFeedbackInput {
  readonly kind: "moment" | "exit";
  readonly topic: string;
  readonly question: string | null;
  readonly score: number | null;
  readonly reason: string | null;
  readonly comment: string | null;
  readonly userId: string;
  readonly communitySlug: string | null;
  readonly edition: string;
  readonly instanceUrl: string;
  readonly sentAt: string;
}

function summary(input: CreatorFeedbackInput): string {
  if (input.kind === "moment") {
    return input.score === null ? "no score" : `${input.score}/5`;
  }
  return input.reason ?? "no reason given";
}

export function creatorFeedbackSubject(input: CreatorFeedbackInput): string {
  return `[${headerSafe(instanceName(), 60)} feedback] ${headerSafe(input.topic, 60)}: ${headerSafe(summary(input), 60)}`;
}

export function creatorFeedbackEmail(input: CreatorFeedbackInput): EmailContent {
  return buildEmail({
    template: "creator-feedback",
    subject: creatorFeedbackSubject(input),
    preheader: input.comment?.slice(0, 120) ?? summary(input),
    brand: { kind: "instance" },
    body: [
      input.kind === "moment"
        ? "A creator answered a moment question."
        : "A creator told us why they are leaving.",
      `Moment or action: ${input.topic}`,
      ...(input.question ? [`Question: ${input.question}`] : []),
      ...(input.kind === "moment"
        ? [input.score === null ? "Score: none" : `Score: ${input.score} of 5`]
        : [`Reason: ${input.reason ?? "none"}`]),
      ...(input.comment ? ["Comment:", ...input.comment.split(/\n\s*\n/)] : ["Comment: none"]),
      `User id: ${input.userId}`,
      `Community: ${input.communitySlug ?? "none"}`,
      `Edition: ${input.edition}`,
      `Instance: ${input.instanceUrl}`,
      `Received: ${input.sentAt}`,
    ],
  });
}
