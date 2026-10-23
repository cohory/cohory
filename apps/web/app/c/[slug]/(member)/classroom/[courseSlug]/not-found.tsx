import { SearchX } from "lucide-react";

import { EmptyState } from "../../../../../../components/empty-state";

export default function CourseNotFound() {
  return (
    <EmptyState icon={SearchX} title="We couldn't find this course">
      It may not be published yet, or the link is wrong. Open the Classroom tab to see the courses
      you can take.
    </EmptyState>
  );
}
