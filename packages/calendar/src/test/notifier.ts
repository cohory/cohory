import type {
  CalendarNotifier,
  EventCreatedNotice,
  EventMail,
  EventReminderNotice,
} from "../notices";

export interface FakeNotifier {
  readonly notifier: CalendarNotifier;
  readonly created: EventCreatedNotice[];
  readonly reminders: EventReminderNotice[];
}

export function fakeNotifier(mail: Partial<EventMail> = {}): FakeNotifier {
  const created: EventCreatedNotice[] = [];
  const reminders: EventReminderNotice[] = [];
  const resolved: EventMail = {
    email: true,
    timeZone: "Europe/Berlin",
    unsubscribeUrl: null,
    headers: {},
    ...mail,
  };
  return {
    created,
    reminders,
    notifier: {
      eventCreated: (notice) => {
        created.push(notice);
        return Promise.resolve(1);
      },
      eventReminder: (notice) => {
        reminders.push(notice);
        return Promise.resolve(resolved);
      },
      eventMail: () => Promise.resolve(resolved),
    },
  };
}
