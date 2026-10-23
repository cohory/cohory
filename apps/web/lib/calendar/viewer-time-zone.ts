import { cookies } from "next/headers";

import { resolveViewerTimeZone, timeZoneCookie } from "./time-zone";

export interface ViewerTimeZone {
  readonly timeZone: string;
  readonly cookie: string | null;
}

export async function viewerTimeZone(eventTimeZone?: string | null): Promise<ViewerTimeZone> {
  const cookie = (await cookies()).get(timeZoneCookie)?.value ?? null;
  return { timeZone: resolveViewerTimeZone(cookie, eventTimeZone), cookie };
}
