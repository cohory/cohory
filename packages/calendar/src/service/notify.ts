import type { CalendarNoticeInput } from "../notices";
import type { Runtime } from "./context";

export async function scheduleNotice(runtime: Runtime, notice: CalendarNoticeInput): Promise<void> {
  if (!runtime.queue) {
    return;
  }
  try {
    await runtime.queue.scheduleNotice(notice);
  } catch (error: unknown) {
    runtime.onQueueError(error, notice);
  }
}
