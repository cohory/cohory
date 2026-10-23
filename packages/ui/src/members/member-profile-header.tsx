"use client";

import { PencilIcon } from "lucide-react";
import { useId, useState } from "react";

import { AuthorAvatar } from "../community/author-avatar";
import { formatAbsoluteDate } from "../community/relative-time";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Textarea } from "../primitives/textarea";
import { cn } from "../lib/utils";
import { LevelBadge } from "./level-badge";
import { LevelProgress } from "./level-progress";
import { formatPoints, roleLabel, type MemberSummary } from "./types";

interface MemberProfileHeaderProps {
  member: MemberSummary;
  bio?: string | null;
  canEdit: boolean;
  onEditBio?(bio: string): void | Promise<void>;
  nextLevelAt?: number | null;
  bioMaxLength?: number;
  gamificationEnabled?: boolean;
  locale?: string;
  className?: string;
}

const DEFAULT_BIO_MAX_LENGTH = 300;

function MemberProfileHeader({
  member,
  bio,
  canEdit,
  onEditBio,
  nextLevelAt,
  bioMaxLength = DEFAULT_BIO_MAX_LENGTH,
  gamificationEnabled = true,
  locale,
  className,
}: MemberProfileHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bio ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = useId();
  const role = roleLabel(member.role);
  const editable = canEdit && Boolean(onEditBio);

  function startEditing() {
    setDraft(bio ?? "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (!onEditBio) return;
    setPending(true);
    setError(null);
    try {
      await onEditBio(draft.trim());
      setEditing(false);
    } catch {
      setError("Couldn't save your bio. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <header
      data-slot="member-profile-header"
      className={cn(
        "flex flex-col gap-4 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-6",
        className,
      )}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <AuthorAvatar name={member.name} avatarUrl={member.image} className="size-20 text-xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-text">{member.name}</h1>
            <LevelBadge
              level={member.level}
              name={member.levelName}
              size="md"
              disabled={!gamificationEnabled}
            />
            {role ? <Badge variant="neutral">{role}</Badge> : null}
          </div>
          {member.username ? <p className="text-sm text-text-muted">@{member.username}</p> : null}
          <p className="text-sm text-text-muted">
            {gamificationEnabled ? (
              <>
                <span className="tabular-nums">{formatPoints(member.points, locale)}</span>
                <span aria-hidden="true"> · </span>
              </>
            ) : null}
            Joined {formatAbsoluteDate(member.joinedAt, locale)}
          </p>
        </div>
      </div>

      {gamificationEnabled ? (
        <LevelProgress
          level={member.level}
          points={member.points}
          nextLevelAt={nextLevelAt}
          name={member.levelName}
          locale={locale}
        />
      ) : null}

      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={fieldId} className="text-sm font-medium text-text">
            Bio
          </label>
          <Textarea
            id={fieldId}
            value={draft}
            maxLength={bioMaxLength}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !pending) setEditing(false);
            }}
          />
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? "Saving bio…" : "Save bio"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          {bio ? (
            <p className="min-w-0 text-base whitespace-pre-line break-words text-text">{bio}</p>
          ) : editable ? (
            <p className="text-sm text-text-muted">Add a short bio so members know who you are.</p>
          ) : null}
          {editable ? (
            <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
              <PencilIcon aria-hidden="true" className="size-4" />
              {bio ? "Edit bio" : "Add bio"}
            </Button>
          ) : null}
        </div>
      )}
    </header>
  );
}

export { MemberProfileHeader, type MemberProfileHeaderProps };
