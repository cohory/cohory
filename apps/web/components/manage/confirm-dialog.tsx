"use client";

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from "@cohory/ui";
import { useState, useTransition, type ReactNode } from "react";

import type { ActionResult } from "../../lib/posts/errors";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  confirmBlocked?: boolean;
  children?: ReactNode;
  onConfirm(typed: string): Promise<ActionResult<unknown>>;
  onDone?(): void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  danger = false,
  typeToConfirm,
  confirmBlocked = false,
  children,
  onConfirm,
  onDone,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blocked =
    confirmBlocked || (typeToConfirm !== undefined && typed.trim() !== typeToConfirm.trim());

  function change(next: boolean) {
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  }

  function confirm() {
    startTransition(async () => {
      const result = await onConfirm(typed);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      change(false);
      onDone?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {typeToConfirm !== undefined ? (
          <Field label={`Type ${typeToConfirm} to confirm`}>
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            )}
          </Field>
        ) : null}
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
            variant={danger ? "danger" : "primary"}
            disabled={pending || blocked}
            onClick={confirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
