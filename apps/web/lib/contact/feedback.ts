export const sendFeedbackLabel = "Send feedback";

export function feedbackHref(path: string): string {
  return `/contact?${new URLSearchParams({ topic: "feedback", from: path }).toString()}`;
}
