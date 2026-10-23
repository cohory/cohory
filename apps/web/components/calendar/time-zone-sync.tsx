"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { timeZoneCookie, timeZoneCookieMaxAge } from "../../lib/calendar/time-zone";

export function TimeZoneSync({ current }: { current: string | null }) {
  const router = useRouter();

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === current) return;
    document.cookie = `${timeZoneCookie}=${zone}; path=/; max-age=${timeZoneCookieMaxAge}; samesite=lax`;
    router.refresh();
  }, [current, router]);

  return null;
}
