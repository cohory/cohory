"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
  Textarea,
  toast,
} from "@cohory/ui";
import { BotIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import {
  changeDelegationAction,
  delegateCourseAction,
  saveAgentAccessAction,
} from "../../lib/entitlements/actions";
import type { CourseAgentPanelData } from "../../lib/entitlements/load";
import { formatDay } from "../agents/format";

const licenseChoices = [
  {
    id: "personal_agents",
    label: "Personal use by the buyer's agents only",
    hint: "The default. Agents help the person who has access and nobody else.",
  },
  {
    id: "team_agents",
    label: "Use by agents of the buyer's own team",
    hint: "Agents may use the course for the buyer's team, never outside it.",
  },
  { id: "custom", label: "Custom terms", hint: "Write your own terms below." },
] as const;

type LicenseChoice = (typeof licenseChoices)[number]["id"];

export interface AgentAccessPanelProps {
  readonly slug: string;
  readonly courseSlug: string;
  readonly data: CourseAgentPanelData;
  readonly lessonTitles?: Readonly<Record<string, string>>;
}

export function taskTitle(taskId: string): string {
  const words = taskId.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function lessonTitle(
  lessonTitles: Readonly<Record<string, string>> | undefined,
  lessonId: string,
): string {
  return lessonTitles?.[lessonId] ?? "A lesson you cannot see now";
}

export function formattedPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function agentsLink(slug: string, courseSlug: string): string {
  const back = `/c/${slug}/classroom/${courseSlug}`;
  return `/account/agents?community=${encodeURIComponent(slug)}&return=${encodeURIComponent(back)}`;
}

function LicenseTerms({ license }: { license: CourseAgentPanelData["license"] }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-surface-raised p-3 text-sm">
      <p className="font-medium text-text">{license.label}</p>
      <p className="text-text-muted">{license.summary}</p>
      {license.text ? (
        <p className="break-words whitespace-pre-line text-text">{license.text}</p>
      ) : null}
    </div>
  );
}

function CreatorSettings({ slug, courseSlug, data }: AgentAccessPanelProps) {
  const router = useRouter();
  const switchId = useId();
  const textId = useId();
  const [allow, setAllow] = useState(data.allowAgentAccess);
  const [licenseId, setLicenseId] = useState<LicenseChoice>(data.license.id);
  const [text, setText] = useState(data.license.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function persist(nextAllow: boolean, message: string, onFail?: () => void) {
    startTransition(async () => {
      const result = await saveAgentAccessAction({
        slug,
        courseSlug,
        courseId: data.courseId,
        allowAgentAccess: nextAllow,
        licenseId,
        licenseText: text,
      });
      if (!result.ok) {
        onFail?.();
        setError(result.message);
        return;
      }
      setError(null);
      toast(message);
      router.refresh();
    });
  }

  function toggle(next: boolean) {
    setAllow(next);
    persist(next, next ? "Agent access is on." : "Agent access is off.", () => setAllow(!next));
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    persist(allow, "License terms saved.");
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" aria-label="Agent access settings">
      <div className="flex items-start gap-3">
        <Switch
          id={switchId}
          checked={allow}
          disabled={pending}
          onCheckedChange={toggle}
          aria-describedby={`${switchId}-hint`}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={switchId} className="text-sm font-medium text-text">
            Allow agent access
          </label>
          <p id={`${switchId}-hint`} className="text-sm text-text-muted">
            Members who have this course can let their own agents read the lessons. Agents never
            post, see other members, or buy anything. Turning this off ends every agent&apos;s
            access to the course. Members&apos; agents can read lessons right away; publish an agent
            version to give them tasks. The switch saves right away.
          </p>
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-text">License terms for agents</legend>
        {licenseChoices.map((choice) => (
          <label key={choice.id} className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="radio"
              name="agent-license"
              value={choice.id}
              checked={licenseId === choice.id}
              onChange={() => setLicenseId(choice.id)}
              className="mt-1 size-4 shrink-0 accent-accent"
            />
            <span className="flex flex-col">
              <span className="text-text">{choice.label}</span>
              <span className="text-text-muted">{choice.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={textId} className="text-sm font-medium text-text">
          {licenseId === "custom" ? "Your terms" : "Extra terms (optional)"}
        </label>
        <Textarea
          id={textId}
          value={text}
          maxLength={2000}
          required={licenseId === "custom"}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending} className="min-h-11 self-start">
        {pending ? "Saving…" : "Save license terms"}
      </Button>
    </form>
  );
}

function DelegateDialog({
  slug,
  courseSlug,
  data,
  open,
  onOpenChange,
}: AgentAccessPanelProps & { open: boolean; onOpenChange(open: boolean): void }) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(data.agents[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await delegateCourseAction({
        slug,
        courseSlug,
        courseId: data.courseId,
        agentId,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      onOpenChange(false);
      toast("Your agent can read this course for 30 days.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give my agent access</DialogTitle>
          <DialogDescription>
            Your agent can read this course for 30 days. It ends sooner if you revoke it or lose
            access yourself. The agent cannot share access or buy anything.
          </DialogDescription>
        </DialogHeader>
        {data.agents.length === 0 ? (
          <p className="text-sm text-text-muted">
            You have no active agents in this community yet.{" "}
            <Link
              href={agentsLink(slug, courseSlug)}
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              Create one in Account, Agents
            </Link>
            . A link there brings you back to this course.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-text">Choose an agent</legend>
            {data.agents.map((agent) => (
              <label key={agent.id} className="flex min-h-11 items-center gap-3 text-sm text-text">
                <input
                  type="radio"
                  name="delegate-agent"
                  value={agent.id}
                  checked={agentId === agent.id}
                  onChange={() => setAgentId(agent.id)}
                  className="size-4 shrink-0 accent-accent"
                />
                {agent.name}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-text">License terms</p>
          <LicenseTerms license={data.license} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={pending || data.agents.length === 0 || agentId === ""}
            onClick={confirm}
          >
            {pending ? "Giving access…" : "Agree and give access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Delegations({ slug, courseSlug, data }: AgentAccessPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(delegationId: string, action: "renew" | "revoke") {
    startTransition(async () => {
      const result = await changeDelegationAction({ slug, courseSlug, delegationId, action });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      toast(action === "renew" ? "Access renewed for 30 days." : "Access revoked.");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="delegations-heading" className="flex flex-col gap-2">
      <h3 id="delegations-heading" className="text-base font-medium text-text">
        Your agents with access
      </h3>
      <ul className="flex flex-col gap-2">
        {data.delegations.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-words text-text">{item.agentName}</span>
                <Badge variant={item.active ? "success" : "neutral"}>{item.status}</Badge>
              </span>
              {item.live ? (
                <span className="text-text-muted">Until {formatDay(item.expiresAt)}</span>
              ) : null}
            </div>
            {item.live ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => change(item.id, "renew")}
                  aria-label={`Renew access for ${item.agentName}`}
                >
                  Renew
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11 text-danger"
                  disabled={pending}
                  onClick={() => change(item.id, "revoke")}
                  aria-label={`Revoke access for ${item.agentName}`}
                >
                  Revoke
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Submissions({ data, lessonTitles }: Pick<AgentAccessPanelProps, "data" | "lessonTitles">) {
  return (
    <section aria-labelledby="submissions-heading" className="flex flex-col gap-2">
      <h3 id="submissions-heading" className="text-base font-medium text-text">
        Results from your agents
      </h3>
      <p className="text-sm text-text-muted">
        Agents report these results themselves. Nobody checks them here.
      </p>
      <ul className="flex flex-col gap-2">
        {data.submissions.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium break-words text-text">{item.agentName}</span>
              <Badge variant="neutral">Self reported</Badge>
            </span>
            <span className="break-words text-text">
              {taskTitle(item.taskId)} in {lessonTitle(lessonTitles, item.lessonId)}
            </span>
            <span className="break-words text-text-muted">
              {formatDay(item.createdAt)}, version {item.version}, run {item.runId}
            </span>
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm text-sm font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring">
                What the agent reported
              </summary>
              <pre className="mt-1 overflow-x-auto rounded-md bg-surface-raised p-2 font-mono text-xs whitespace-pre-wrap break-all text-text">
                {formattedPayload(item.payload)}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Summary({
  rows,
  lessonTitles,
}: {
  rows: CourseAgentPanelData["summary"];
  lessonTitles: AgentAccessPanelProps["lessonTitles"];
}) {
  if (!rows) return null;
  return (
    <section aria-labelledby="summary-heading" className="flex flex-col gap-2">
      <h3 id="summary-heading" className="text-base font-medium text-text">
        Agent results by task
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No agent has reported a result yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="rounded-md border border-border p-3 text-sm text-text">
              <span className="font-medium break-words">
                {taskTitle(row.taskId)} in {lessonTitle(lessonTitles, row.lessonId)}, version{" "}
                {row.version}
              </span>
              <span className="block text-text-muted">
                {row.submissions} {row.submissions === 1 ? "result" : "results"} from {row.agents}{" "}
                {row.agents === 1 ? "agent" : "agents"} of {row.members}{" "}
                {row.members === 1 ? "member" : "members"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-text-muted">
        You see counts only. What each agent reported stays private to its member.
      </p>
    </section>
  );
}

export function AgentAccessPanel(props: AgentAccessPanelProps) {
  const { data } = props;
  const [open, setOpen] = useState(false);
  if (!data.allowAgentAccess && !data.canManage && data.delegations.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-lg">
          <BotIcon className="size-5" aria-hidden="true" />
          Agent access
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {data.canManage ? <CreatorSettings {...props} /> : null}
        {data.allowAgentAccess && !data.canManage ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-muted">
              You can let one of your own agents read this course under these terms.
            </p>
            <LicenseTerms license={data.license} />
          </div>
        ) : null}
        {data.canDelegate ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 self-start"
            onClick={() => setOpen(true)}
          >
            Give my agent access
          </Button>
        ) : null}
        {data.delegations.length > 0 ? <Delegations {...props} /> : null}
        {data.submissions.length > 0 ? (
          <Submissions data={data} lessonTitles={props.lessonTitles} />
        ) : null}
        <Summary rows={data.summary} lessonTitles={props.lessonTitles} />
        {data.canDelegate ? <DelegateDialog {...props} open={open} onOpenChange={setOpen} /> : null}
      </CardContent>
    </Card>
  );
}
