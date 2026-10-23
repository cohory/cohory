import { SearchX } from "lucide-react";

import { EmptyState } from "../../../../../../../components/empty-state";

export default function OccurrenceNotFound() {
  return (
    <EmptyState icon={SearchX} title="We couldn't find this event">
      It may have been canceled or deleted, or the link is wrong. Open the Calendar tab to see
      upcoming events.
    </EmptyState>
  );
}
