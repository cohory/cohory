import type { Actor } from "@cohory/authz";
import { getManageService } from "@cohory/communities";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from "@cohory/ui";

import { usageDescription, usageNotes, usageRows, usageTier } from "../../lib/manage/usage";

export async function UsageCard({ actor, communityId }: { actor: Actor; communityId: string }) {
  const usage = await getManageService().getUsage(actor, communityId);
  const notes = usageNotes(usage);
  const tier = usageTier(usage);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Usage</CardTitle>
        <CardDescription>{usageDescription(usage)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-4">
          {usageRows(usage).map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 gap-y-2 text-sm"
            >
              <dt className="text-text-muted">{row.label}</dt>
              <dd className="text-right font-medium text-text tabular-nums">{row.summary}</dd>
              {row.percent === null ? null : (
                <dd className="col-span-2">
                  <Progress value={row.percent} aria-label={`${row.label}: ${row.summary}`} />
                </dd>
              )}
            </div>
          ))}
        </dl>
        {tier ? <p className="text-sm text-text-muted">{tier}</p> : null}
        {notes.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
