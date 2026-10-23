"use client";

import { formatRelativeTime } from "../community/relative-time";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";

export interface SessionItem {
  readonly id: string;
  readonly device: string;
  readonly lastActiveAt: Date;
  readonly createdAt: Date;
  readonly current: boolean;
}

export interface SessionListProps {
  readonly sessions: readonly SessionItem[];
  readonly onRevoke: (sessionId: string) => void;
  readonly onRevokeOthers: () => void;
  readonly pending?: boolean;
  readonly now?: Date;
}

export function SessionList({
  sessions,
  onRevoke,
  onRevokeOthers,
  pending = false,
  now,
}: SessionListProps) {
  const others = sessions.filter((session) => !session.current);

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col">
              <p className="flex items-center gap-2 text-sm font-medium text-text">
                <span className="truncate">{session.device}</span>
                {session.current ? <Badge>This device</Badge> : null}
              </p>
              <p className="text-sm text-text-muted">
                Last active {formatRelativeTime(session.lastActiveAt, now).toLowerCase()}
              </p>
            </div>
            {session.current ? null : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => onRevoke(session.id)}
                aria-label={`Sign out ${session.device}`}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 ? (
        <div>
          <Button type="button" variant="secondary" disabled={pending} onClick={onRevokeOthers}>
            Sign out all other devices
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">You are not signed in anywhere else.</p>
      )}
    </div>
  );
}
