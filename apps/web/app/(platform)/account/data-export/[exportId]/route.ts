import { signInPath } from "@cohory/auth";
import { getRateLimiter } from "@cohory/rate-limit";
import { redirect } from "next/navigation";

import { dataExportPath, dataExports } from "../../../../../lib/account/data-export";
import { downloadDataExport } from "../../../../../lib/account/data-export-download";
import { actorFor } from "../../../../../lib/actor";
import { currentSession } from "../../../../../lib/session";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/account/data-export/[exportId]">,
): Promise<Response> {
  const { exportId } = await params;
  const session = await currentSession();
  const result = await downloadDataExport(session ? actorFor(session) : null, exportId, {
    exports: dataExports(),
    limiter: getRateLimiter(),
  });
  switch (result.kind) {
    case "file":
      return result.response;
    case "sign_in":
      return redirect(signInPath(dataExportPath(encodeURIComponent(exportId))));
    case "expired":
      return redirect("/account?export=expired");
    case "rate_limited":
      return redirect("/account?export=busy");
  }
}
