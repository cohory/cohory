"use client";

import { scopes as allScopes, type Scope, type ScopeAudience } from "@cohory/authz";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateAgentAction } from "../../lib/agents/actions";
import { ScopePicker } from "./scope-picker";

export function AgentPermissionsDialog({
  slug,
  agent,
  open,
  onOpenChange,
  available,
  audience,
}: {
  slug: string;
  agent: {
    readonly id: string;
    readonly name: string;
    readonly ownerName: string;
    readonly scopes: readonly Scope[];
    readonly canIssueTokens: boolean;
  };
  open: boolean;
  onOpenChange(open: boolean): void;
  available: readonly Scope[];
  audience: ScopeAudience;
}) {
  const router = useRouter();
  const [scopes, setScopes] = useState<Scope[]>([...agent.scopes]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const offered = agent.canIssueTokens
    ? allScopes.filter((scope) => available.includes(scope) || agent.scopes.includes(scope))
    : agent.scopes;

  function change(next: boolean) {
    if (next) {
      setScopes([...agent.scopes]);
      setError(null);
    }
    onOpenChange(next);
  }

  function save() {
    startTransition(async () => {
      const result = await updateAgentAction({ slug, agentId: agent.id, scopes });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permissions for {agent.name}</DialogTitle>
          <DialogDescription>
            {agent.canIssueTokens
              ? "Changes apply to all of its tokens on their next request."
              : `You can remove permissions. Only ${agent.ownerName} can add them, because the agent acts for them.`}
          </DialogDescription>
        </DialogHeader>
        <ScopePicker
          idPrefix={`edit-${agent.id}`}
          value={scopes}
          onChange={setScopes}
          available={offered}
          audience={audience}
          limited={agent.canIssueTokens}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={pending || scopes.length === 0}
            onClick={save}
            className="min-h-11"
          >
            {pending ? "Saving…" : "Save permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
