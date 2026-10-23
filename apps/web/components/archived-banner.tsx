import { Alert, AlertDescription, AlertTitle } from "@cohory/ui";

export function ArchivedBanner() {
  return (
    <Alert variant="info" className="mb-6">
      <AlertTitle>This community is archived</AlertTitle>
      <AlertDescription className="text-text">
        You can read everything here, but no one can post, comment, react, RSVP, or record lesson
        progress until the owner restores it.
      </AlertDescription>
    </Alert>
  );
}
