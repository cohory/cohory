import { assertCan, can, type Actor } from "@cohory/authz";
import { parseCommunityId } from "@cohory/db";

import { inManagedCommunity, parseInput, type Runtime } from "./context";
import { csvBom, csvRow, membersCsvColumns, membersCsvFilename, membersCsvRow } from "./csv";
import { accessUserFilter } from "./member-access";
import { memberCriteria } from "./people";
import { exportMembersInputSchema, type ExportMembersInput } from "./schemas";
import type { MembersCsvExport } from "./views";

export const exportBatchSize = 500;

export function exportOperations(runtime: Runtime) {
  return {
    async exportMembersCsv(
      actor: Actor,
      communityId: string,
      input: ExportMembersInput = {},
    ): Promise<MembersCsvExport> {
      const parsed = parseInput(exportMembersInputSchema, input);
      const filters = Object.fromEntries(
        Object.entries({
          ...parsed,
          status: parsed.inactiveDays !== undefined ? "active" : parsed.status,
          query: parsed.query ? parsed.query : undefined,
        }).filter(([, value]) => value !== undefined),
      );
      const filterAccess =
        parsed.access === undefined
          ? null
          : await runtime.memberAccess.list(actor, communityId, null);
      const criteria = memberCriteria(
        parsed,
        true,
        runtime.now(),
        null,
        parsed.access !== undefined && filterAccess
          ? accessUserFilter(parsed.access, filterAccess)
          : null,
      );
      const { community, seesAccess } = await inManagedCommunity(
        runtime,
        actor,
        communityId,
        async (managed) => {
          assertCan(actor, "members", "export", managed.context);
          await managed.store.appendAudit({
            actorId: managed.user.userId,
            action: "export.members_csv",
            target: managed.community.id,
            ...(Object.keys(filters).length > 0 ? { metadata: { filters } } : {}),
          });
          return {
            community: managed.community,
            seesAccess: can(actor, "read", "payment", managed.context),
          };
        },
      );
      const id = parseCommunityId(community.id);
      const encoder = new TextEncoder();
      let after: string | null = null;
      let started = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!started) {
            started = true;
            controller.enqueue(encoder.encode(csvBom + csvRow(membersCsvColumns)));
            return;
          }
          const rows = await runtime.repo.exportMembers(id, criteria, after, exportBatchSize);
          if (rows.length > 0) {
            const access = seesAccess
              ? (filterAccess ??
                (await runtime.memberAccess.list(
                  actor,
                  communityId,
                  rows.map((row) => row.userId),
                )))
              : null;
            controller.enqueue(
              encoder.encode(
                rows
                  .map((row) =>
                    membersCsvRow(row, access ? (access.get(row.userId)?.access ?? "none") : null),
                  )
                  .join(""),
              ),
            );
          }
          const last = rows.at(-1);
          if (rows.length < exportBatchSize || !last) {
            controller.close();
            return;
          }
          after = last.membershipId;
        },
      });
      return { filename: membersCsvFilename(community.slug, runtime.now()), body };
    },
  };
}
