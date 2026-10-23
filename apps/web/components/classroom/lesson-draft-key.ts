import { draftKey } from "@cohory/ui/lib/use-draft-autosave";

export function lessonDraftKey(lessonId: string): string {
  return draftKey("lesson", lessonId);
}
