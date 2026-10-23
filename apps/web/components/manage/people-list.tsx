"use client";

import { Badge, Button, MemberCard, type ItemAction } from "@cohory/ui";
import { Download } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from "react";

import {
  bulkBillingAction,
  bulkPersonAction,
  changeRoleAction,
  listPeopleAction,
  memberBillingAction,
  memberDetailAction,
  personAction,
} from "../../lib/manage/actions";
import type { MemberDetail } from "../../lib/manage/member-detail";
import { resendImportEmail } from "../../lib/migration/import-emails";
import { bulkRemovalDescription, removalDescription } from "../../lib/manage/people-billing";
import {
  accessLabels,
  membersCsvHref,
  peopleFiltersToInput,
  peopleFiltersToParams,
  personActivityLabel,
  type PeopleFilters,
} from "../../lib/manage/people-filters";
import { resetMemberPointsAction } from "../../lib/manage/points-actions";
import { rolePowers } from "../../lib/manage/role-powers";
import type { PersonRow } from "../../lib/manage/views";
import type { ActionResult } from "../../lib/posts/errors";
import { ConfirmDialog } from "./confirm-dialog";
import { MemberDrawer } from "./member-drawer";
import { PeopleFiltersBar } from "./people-filters-bar";

const roleNames = { admin: "an admin", moderator: "a moderator", member: "a member" } as const;

const statusLabels: Record<PersonRow["status"], string | null> = {
  active: null,
  pending: "Waiting for approval",
  removed: "Removed",
  banned: "Banned",
};

const filterKeys = ["q", "role", "status", "activity", "days", "access"] as const;

function RolePowersList({ role }: { role: keyof typeof rolePowers }) {
  const powers = rolePowers[role];
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <p className="font-medium text-text">Can</p>
        <ul className="list-disc space-y-1 pl-5 text-text-muted">
          {powers.can.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-medium text-text">Cannot</p>
        <ul className="list-disc space-y-1 pl-5 text-text-muted">
          {powers.cannot.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AccessBadge({ access }: { access: PersonRow["access"] }) {
  if (access === null || access === "none") {
    return null;
  }
  const variant =
    access === "past_due" ? "warning" : access === "cancelling" ? "neutral" : "success";
  return <Badge variant={variant}>{accessLabels[access]}</Badge>;
}

function PersonDetails({ row, showEmail }: { row: PersonRow; showEmail: boolean }) {
  const statusLabel = statusLabels[row.status];
  return (
    <>
      {showEmail && row.email ? <span className="min-w-0 truncate">{row.email}</span> : null}
      {row.status === "active" ? (
        <time dateTime={row.lastActiveAt} suppressHydrationWarning>
          {personActivityLabel(row)}
        </time>
      ) : null}
      <AccessBadge access={row.access} />
      {statusLabel ? <Badge variant="neutral">{statusLabel}</Badge> : null}
    </>
  );
}

interface Pending {
  readonly title: string;
  readonly description: string;
  readonly body?: ReactNode;
  readonly confirmLabel: string;
  readonly pendingLabel: string;
  readonly danger: boolean;
  run(): Promise<ActionResult<unknown>>;
}

function bulkable(row: PersonRow): boolean {
  return row.actions.remove || row.actions.ban;
}

export function PeopleList({
  slug,
  showEmail,
  canExport,
  canSeeAccess,
  gamificationEnabled,
  initialFilters,
  initialRows,
  initialCursor,
  initialDetail,
  resendable = [],
}: {
  slug: string;
  showEmail: boolean;
  canExport: boolean;
  canSeeAccess: boolean;
  gamificationEnabled: boolean;
  initialFilters: PeopleFilters;
  initialRows: PersonRow[];
  initialCursor: string | null;
  initialDetail: MemberDetail | null;
  resendable?: readonly string[];
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [detail, setDetail] = useState(initialDetail);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, startTransition] = useTransition();
  const first = useRef(true);
  const latest = useRef(0);
  const input = peopleFiltersToInput(filters);
  const peopleHref = `/c/${slug}/manage/people`;

  function memberHref(userId: string): string {
    const params = peopleFiltersToParams(filters);
    params.set("member", userId);
    return `${peopleHref}?${params.toString()}`;
  }

  function replaceUrl(change: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(window.location.search);
    change(params);
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`,
    );
  }

  function load(append: boolean) {
    if (input === null) {
      return;
    }
    const request = ++latest.current;
    startTransition(async () => {
      const result = await listPeopleAction({
        slug,
        ...input,
        cursor: append ? (cursor ?? undefined) : undefined,
      });
      if (request !== latest.current) {
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setRows((current) => (append ? [...current, ...result.data.rows] : result.data.rows));
      setCursor(result.data.nextCursor);
      if (!append) {
        setSelected(new Set());
      }
    });
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    replaceUrl((params) => {
      for (const key of filterKeys) params.delete(key);
      for (const [key, value] of peopleFiltersToParams(filters)) params.set(key, value);
    });
    const timer = setTimeout(() => load(false), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the filters change
  }, [filters]);

  function openDetail(event: MouseEvent<HTMLElement>, row: PersonRow) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link || link.getAttribute("href") !== memberHref(row.userId)) {
      return;
    }
    event.preventDefault();
    startTransition(async () => {
      const result = await memberDetailAction({ slug, userId: row.userId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDetail(result.data);
      replaceUrl((params) => params.set("member", row.userId));
    });
  }

  function closeDetail() {
    setDetail(null);
    replaceUrl((params) => params.delete("member"));
  }

  function confirmRemoval(row: PersonRow, confirm: Pending) {
    startTransition(async () => {
      const billing = await memberBillingAction({ slug, userId: row.userId });
      if (!billing.ok) {
        setError(billing.message);
        return;
      }
      setError(null);
      setPending({
        ...confirm,
        description: removalDescription(row.name, billing.data, confirm.description),
      });
    });
  }

  function confirmBulk(action: "remove" | "ban") {
    const people = rows.filter((row) => selected.has(row.userId) && row.actions[action]);
    if (people.length === 0) {
      setError(
        action === "remove"
          ? "You can't remove anyone you selected."
          : "You can't ban anyone you selected.",
      );
      return;
    }
    startTransition(async () => {
      const billing = await bulkBillingAction({ slug, userIds: people.map((row) => row.userId) });
      if (!billing.ok) {
        setError(billing.message);
        return;
      }
      setError(null);
      const byId = new Map(billing.data.map((entry) => [entry.userId, entry.billing]));
      const text =
        action === "remove"
          ? "They lose access right away. They can join again later with an invite link."
          : "They lose access right away and can't join again, even with an invite link.";
      const count = people.length === 1 ? "1 person" : `${people.length} people`;
      setPending({
        title: action === "remove" ? `Remove ${count}?` : `Ban ${count}?`,
        description: bulkRemovalDescription(
          people.map((row) => ({
            name: row.name,
            billing: byId.get(row.userId) ?? { paying: false },
          })),
          text,
        ),
        confirmLabel: action === "remove" ? "Remove" : "Ban",
        pendingLabel: action === "remove" ? "Removing…" : "Banning…",
        danger: true,
        run: async () => {
          const result = await bulkPersonAction({
            slug,
            userIds: people.map((row) => row.userId),
            action,
          });
          if (result.ok) {
            const failed = result.data.failed.length;
            setNotice(
              failed === 0
                ? null
                : `${failed} of ${people.length} could not be changed. They may have a role you can't change, or they already left.`,
            );
          }
          return result;
        },
      });
    });
  }

  function actionsFor(row: PersonRow): ItemAction[] {
    const actions: ItemAction[] = row.actions.roles.map((next) => ({
      id: `role-${next}`,
      label: next === "member" ? "Make member" : `Make ${next}`,
      onSelect: () =>
        setPending({
          title: `Make ${row.name} ${roleNames[next]}?`,
          description:
            next === "member"
              ? "They keep their membership but lose any extra permissions."
              : `Here is what ${next === "admin" ? "an admin" : "a moderator"} can do.`,
          body: <RolePowersList role={next} />,
          confirmLabel: "Change role",
          pendingLabel: "Changing role",
          danger: false,
          run: () => changeRoleAction({ slug, userId: row.userId, role: next }),
        }),
    }));
    if (resendable.includes(row.userId)) {
      actions.push({
        id: "resend-email",
        label: "Resend email",
        onSelect: () =>
          setPending({
            title: `Email ${row.name} again?`,
            description: "They get their import email again, with a link to get in.",
            confirmLabel: "Resend email",
            pendingLabel: "Sending",
            danger: false,
            run: async () => {
              try {
                const base = `/api/v1/communities/${encodeURIComponent(slug)}/manage/migration`;
                return (await resendImportEmail(base, row.userId))
                  ? { ok: true, data: null }
                  : { ok: false, message: "Not sent. This address opted out of email or bounced." };
              } catch (caught: unknown) {
                return {
                  ok: false,
                  message: caught instanceof Error ? caught.message : "Something went wrong.",
                };
              }
            },
          }),
      });
    }
    if (row.actions.unban) {
      actions.push({
        id: "unban",
        label: "Unban",
        onSelect: () =>
          setPending({
            title: `Unban ${row.name}?`,
            description: "They can join again with an invite link.",
            confirmLabel: "Unban",
            pendingLabel: "Unbanning",
            danger: false,
            run: () => personAction({ slug, userId: row.userId, action: "unban" }),
          }),
      });
    }
    if (row.actions.resetPoints) {
      actions.push({
        id: "reset-points",
        label: "Reset points",
        onSelect: () =>
          setPending({
            title: `Reset points for ${row.name}?`,
            description: `Their ${row.points} points go back to 0 and their level to 1. Everyone else keeps their points.`,
            confirmLabel: "Reset points",
            pendingLabel: "Resetting points",
            danger: true,
            run: () => resetMemberPointsAction({ slug, userId: row.userId }),
          }),
      });
    }
    if (row.actions.remove) {
      actions.push({
        id: "remove",
        label: "Remove from community",
        variant: "danger",
        onSelect: () =>
          confirmRemoval(row, {
            title: `Remove ${row.name}?`,
            description:
              "They lose access right away. They can join again later with an invite link.",
            confirmLabel: "Remove",
            pendingLabel: "Removing",
            danger: true,
            run: () => personAction({ slug, userId: row.userId, action: "remove" }),
          }),
      });
    }
    if (row.actions.ban) {
      actions.push({
        id: "ban",
        label: "Ban",
        variant: "danger",
        onSelect: () =>
          confirmRemoval(row, {
            title: `Ban ${row.name}?`,
            description:
              "They lose access right away and can't join again, even with an invite link.",
            confirmLabel: "Ban",
            pendingLabel: "Banning",
            danger: true,
            run: () => personAction({ slug, userId: row.userId, action: "ban" }),
          }),
      });
    }
    return actions;
  }

  function drawerActions(row: PersonRow): ItemAction[] {
    return actionsFor(row).map((action) => ({
      ...action,
      onSelect: () => {
        closeDetail();
        action.onSelect();
      },
    }));
  }

  function toggle(userId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  const selectable = rows.filter(bulkable);
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.userId));

  return (
    <section aria-labelledby="people-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="people-heading" className="text-lg font-semibold text-text">
          Members
        </h3>
        {canExport && input ? (
          <Button asChild variant="secondary" className="min-h-11">
            <a href={membersCsvHref(slug, input)} download>
              <Download aria-hidden="true" className="size-4" strokeWidth={1.5} />
              Download CSV
            </a>
          </Button>
        ) : null}
      </div>
      <PeopleFiltersBar
        filters={filters}
        onChange={setFilters}
        showEmail={showEmail}
        canSeeAccess={canSeeAccess}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-text-muted">
          {notice}
        </p>
      ) : null}
      {selectable.length > 0 ? (
        <div className="flex min-h-11 flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={allSelected}
              onChange={(event) =>
                setSelected(
                  event.target.checked ? new Set(selectable.map((row) => row.userId)) : new Set(),
                )
              }
            />
            Select all shown
          </label>
          {selected.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-text-muted" aria-live="polite">
                {selected.size} selected
              </span>
              <Button
                type="button"
                variant="danger"
                className="min-h-11"
                disabled={loading}
                onClick={() => confirmBulk("remove")}
              >
                Remove selected
              </Button>
              <Button
                type="button"
                variant="danger"
                className="min-h-11"
                disabled={loading}
                onClick={() => confirmBulk("ban")}
              >
                Ban selected
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{loading ? "Loading people…" : "No one matches."}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-busy={loading}>
          {rows.map((row) => (
            <li
              key={row.userId}
              className="flex items-center gap-3"
              onClickCapture={(event) => openDetail(event, row)}
            >
              {selectable.length > 0 ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.name}`}
                  className="size-4 shrink-0 accent-accent disabled:opacity-40"
                  disabled={!bulkable(row)}
                  checked={selected.has(row.userId)}
                  onChange={(event) => toggle(row.userId, event.target.checked)}
                />
              ) : null}
              <MemberCard
                className="min-w-0 flex-1"
                member={{
                  userId: row.userId,
                  name: row.name,
                  username: row.username,
                  image: row.image,
                  role: row.role,
                  level: row.level,
                  points: row.points,
                  joinedAt: row.joinedAt ?? new Date(),
                }}
                href={memberHref(row.userId)}
                actions={actionsFor(row)}
                details={<PersonDetails row={row} showEmail={showEmail} />}
                gamificationEnabled={gamificationEnabled}
                locale="en-US"
              />
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 self-center"
          disabled={loading}
          onClick={() => load(true)}
        >
          {loading ? "Loading…" : "Load more"}
        </Button>
      ) : null}
      <MemberDrawer
        slug={slug}
        detail={detail}
        actions={detail ? drawerActions(detail.row) : []}
        showEmail={showEmail}
        onClose={closeDetail}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={pending?.title ?? ""}
        description={pending?.description ?? ""}
        confirmLabel={pending?.confirmLabel ?? "Confirm"}
        pendingLabel={pending?.pendingLabel ?? "Saving"}
        danger={pending?.danger ?? false}
        onConfirm={() => pending?.run() ?? Promise.resolve({ ok: true, data: null })}
        onDone={() => load(false)}
      >
        {pending?.body}
      </ConfirmDialog>
    </section>
  );
}
