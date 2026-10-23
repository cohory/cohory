import { Badge } from "../primitives/badge";
import { Progress } from "../primitives/progress";
import type { MigrationJobState, MigrationProgress } from "./types";

const labels: Record<MigrationJobState, string> = {
  ready: "Waiting for you",
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
};

const variants = {
  ready: "neutral",
  queued: "neutral",
  running: "accent",
  succeeded: "success",
  failed: "warning",
} as const;

export function MigrationJobBadge({ status }: { status: MigrationJobState }) {
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

const phaseNames: Readonly<Record<string, string>> = {
  reading: "Reading the community",
  uploads: "Files",
  users: "People",
  memberships: "Members",
  community_gallery: "About page images",
  post_images: "Post images",
  reactions: "Likes",
  course_modules: "Course modules",
  lesson_progress: "Lesson progress",
  event_occurrences: "Event dates",
  event_rsvps: "RSVPs",
  points_ledger: "Points",
  member_stats: "Levels",
  comped_memberships: "Free access",
  invite_links: "Invite links",
  membership_requests: "Join requests",
  review_replies: "Review replies",
  audit_log: "Audit log",
  invite: "Invitations",
  add: "Members",
};

function phaseName(phase: string): string {
  const known = phaseNames[phase];
  if (known) return known;
  const words = phase.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function runningFor(startedAt: string | null | undefined): string | null {
  if (!startedAt) return null;
  const minutes = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000);
  if (Number.isNaN(minutes) || minutes < 0) return null;
  if (minutes < 1) return "Running for less than a minute.";
  return `Running for ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

export function MigrationJobProgress({
  label,
  progress,
}: {
  label: string;
  progress: MigrationProgress | null;
}) {
  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const step =
    progress && progress.total > 0 && progress.phase !== "done"
      ? `${phaseName(progress.phase)}: ${progress.done.toLocaleString("en")} of ${progress.total.toLocaleString("en")} items`
      : null;
  const elapsed = runningFor(progress?.startedAt);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-sm text-text-muted">
          <span>{label}</span>
          <span>{percent}%</span>
        </div>
        {step ? <p className="text-sm text-text">{step}</p> : null}
      </div>
      <Progress value={percent} aria-label={label} />
      <p className="text-sm text-text-muted">
        {elapsed ? `${elapsed} ` : ""}You can close this page. It keeps running.
      </p>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
