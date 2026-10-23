import type { Actor } from "@cohory/authz";

import { getCreatorFeedbackService } from "../../lib/feedback/service";
import { MomentQuestionCard } from "./moment-question-card";

export async function MomentQuestion({
  actor,
  communityId,
  slug,
}: {
  actor: Actor;
  communityId: string;
  slug: string;
}) {
  const question = await getCreatorFeedbackService().nextQuestion(actor, communityId);
  if (!question) {
    return null;
  }
  return (
    <MomentQuestionCard
      key={`${question.communityId}:${question.moment}`}
      slug={slug}
      moment={question.moment}
      question={question.question}
      low={question.low}
      high={question.high}
      followUp={question.followUp}
      commentMaxLength={question.commentMaxLength}
    />
  );
}
