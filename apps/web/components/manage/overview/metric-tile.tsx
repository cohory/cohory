import { Card } from "@cohory/ui";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import type { TrendView } from "../../../lib/manage/overview";

const trendIcons = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;

export function MetricTile({
  label,
  value,
  trend,
  detail,
}: {
  label: string;
  value: string;
  trend?: TrendView | null;
  detail?: string;
}) {
  const Icon = trend ? trendIcons[trend.direction] : null;
  return (
    <Card className="h-full gap-1 px-4 py-4">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-2xl font-semibold text-text tabular-nums">{value}</p>
      {trend && Icon ? (
        <p className="flex items-center gap-1 text-sm text-text-muted">
          <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.5} />
          {trend.text}
        </p>
      ) : null}
      {detail ? <p className="text-sm text-text-muted">{detail}</p> : null}
    </Card>
  );
}
