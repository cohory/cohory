import { SearchX } from "lucide-react";

import { EmptyState } from "../../../../../../../components/empty-state";

export default function LessonNotFound() {
  return (
    <EmptyState icon={SearchX} title="We couldn't find this lesson">
      It may not be published yet, or the link is wrong. Go back to the course to pick another
      lesson.
    </EmptyState>
  );
}
