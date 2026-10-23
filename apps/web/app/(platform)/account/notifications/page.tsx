import { getPreferencesService, notificationTypeLabels } from "@cohory/notifications";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { MomentQuestionsSetting } from "../../../../components/feedback/moment-questions-setting";
import { actorFor } from "../../../../lib/actor";
import { getCreatorFeedbackService } from "../../../../lib/feedback/service";
import { listTimeZones } from "../../../../lib/account/notification-form";
import { resolveViewerTimeZone, timeZoneCookie } from "../../../../lib/calendar/time-zone";
import { ConfirmEmailPrompt } from "../confirm-email-prompt";
import { requireAccountSession } from "../session";
import { Preferences } from "./preferences";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const session = await requireAccountSession("/account/notifications");
  const cookieZone = (await cookies()).get(timeZoneCookie)?.value;
  const actor = actorFor(session);
  const [preferences, questions] = await Promise.all([
    getPreferencesService().getPreferences(actor, {
      fallbackTimeZone: resolveViewerTimeZone(cookieZone),
    }),
    getCreatorFeedbackService().preferences(actor),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">Notifications</h1>
        <p className="text-sm text-text-muted">
          Choose what shows in the bell and what we email you. These settings apply to every
          community you belong to.
        </p>
      </div>
      {session.user.emailVerified ? null : <ConfirmEmailPrompt email={session.user.email} />}
      <Preferences
        rows={preferences.types.map((item) => ({
          ...item,
          label: notificationTypeLabels[item.type],
        }))}
        digestHour={preferences.digestHour}
        timeZone={preferences.timeZone}
        timeZones={listTimeZones()}
        weeklyDigest={preferences.weeklyDigest}
      />
      {questions.available ? <MomentQuestionsSetting asking={!questions.optedOut} /> : null}
    </div>
  );
}
