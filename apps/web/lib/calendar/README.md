# Calendar pages: viewer time zone

`components/calendar/time-zone-sync.tsx` writes the browser zone from `Intl.DateTimeFormat().resolvedOptions().timeZone` into the `tz` cookie on first load (and when it changes), then refreshes the page.
Server loaders read the cookie through `viewer-time-zone.ts`, and `resolveViewerTimeZone` in `time-zone.ts` accepts only a valid IANA name.
Without a valid cookie the event's own zone is used on event details, and UTC everywhere else.
Every time on the calendar pages and the feed card is formatted in that zone and always shows the zone abbreviation.
The cookie holds no personal data beyond the zone name, lasts one year, and is not `httpOnly` because the browser sets it.
