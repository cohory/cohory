import { UserX } from "lucide-react";

import { EmptyState } from "../../../../../../components/empty-state";

export default function MemberNotFound() {
  return (
    <EmptyState icon={UserX} title="We couldn't find this member">
      They may have left the community, or the link is wrong. Open the Members tab to find them.
    </EmptyState>
  );
}
