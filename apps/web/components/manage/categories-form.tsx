"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  Select,
  Switch,
  toast,
} from "@cohory/ui";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import {
  createCategoryAction,
  deleteCategoryAction,
  reorderCategoriesAction,
  updateCategoryAction,
} from "../../lib/manage/category-actions";
import type { ActionResult } from "../../lib/posts/errors";
import { ConfirmDialog } from "./confirm-dialog";

type CategoryColor = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

export interface CategoryRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly color: CategoryColor;
  readonly staffOnly: boolean;
}

const colorOptions: readonly { value: CategoryColor; label: string }[] = [
  { value: "neutral", label: "Gray" },
  { value: "accent", label: "Accent" },
  { value: "info", label: "Blue" },
  { value: "success", label: "Green" },
  { value: "warning", label: "Amber" },
  { value: "danger", label: "Red" },
];

const maxCategories = 10;

interface Draft {
  name: string;
  color: CategoryColor;
  staffOnly: boolean;
}

function DraftFields({
  draft,
  onChange,
  nameLabel,
  nameError,
}: {
  draft: Draft;
  onChange(next: Draft): void;
  nameLabel: string;
  nameError?: string;
}) {
  const switchId = useId();
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_10rem] sm:items-end">
      <Field label={nameLabel} error={nameError}>
        {(control) => (
          <Input
            {...control}
            value={draft.name}
            maxLength={40}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        )}
      </Field>
      <Field label="Color">
        {(control) => (
          <Select
            {...control}
            value={draft.color}
            onChange={(event) => {
              const color = colorOptions.find((option) => option.value === event.target.value);
              if (color) onChange({ ...draft, color: color.value });
            }}
          >
            {colorOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Switch
          id={switchId}
          checked={draft.staffOnly}
          onCheckedChange={(staffOnly) => onChange({ ...draft, staffOnly })}
        />
        <Label htmlFor={switchId}>Only staff can post</Label>
      </div>
    </div>
  );
}

function CategoryItem({
  slug,
  category,
  index,
  count,
  busy,
  onMove,
  onDelete,
  run,
}: {
  slug: string;
  category: CategoryRow;
  index: number;
  count: number;
  busy: boolean;
  onMove(offset: -1 | 1): void;
  onDelete(): void;
  run(action: () => Promise<ActionResult<null>>, done: string): void;
}) {
  const [draft, setDraft] = useState<Draft>({
    name: category.name,
    color: category.color,
    staffOnly: category.staffOnly,
  });
  const changed =
    draft.name !== category.name ||
    draft.color !== category.color ||
    draft.staffOnly !== category.staffOnly;

  return (
    <li
      aria-label={category.name}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <DraftFields draft={draft} onChange={setDraft} nameLabel={`Name of ${category.name}`} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="min-h-11"
          disabled={busy || !changed}
          onClick={() =>
            run(
              () => updateCategoryAction({ slug, categoryId: category.id, ...draft }),
              "Category saved.",
            )
          }
        >
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="size-11 px-0"
          aria-label={`Move ${category.name} up`}
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden="true" className="size-4" strokeWidth={1.5} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="size-11 px-0"
          aria-label={`Move ${category.name} down`}
          disabled={busy || index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden="true" className="size-4" strokeWidth={1.5} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto min-h-11 text-danger"
          disabled={busy}
          onClick={onDelete}
        >
          Delete {category.name}
        </Button>
      </div>
    </li>
  );
}

export function CategoriesForm({
  slug,
  categories,
}: {
  slug: string;
  categories: readonly CategoryRow[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({ name: "", color: "neutral", staffOnly: false });
  const [error, setError] = useState<string | null>(null);
  const [nameMissing, setNameMissing] = useState(false);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [busy, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult<null>>, done: string, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      after?.();
      toast.success(done);
      router.refresh();
    });
  }

  function move(index: number, offset: -1 | 1) {
    const ids = categories.map((category) => category.id);
    const target = index + offset;
    const current = ids[index];
    const other = ids[target];
    if (current === undefined || other === undefined) return;
    ids[index] = other;
    ids[target] = current;
    run(() => reorderCategoriesAction({ slug, ids }), "Order saved.");
  }

  return (
    <Card id="categories">
      <CardHeader>
        <CardTitle className="text-lg">Categories</CardTitle>
        <CardDescription>
          Members pick a category when they post and filter the feed by it. Up to {maxCategories}{" "}
          categories.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {categories.length === 0 ? (
          <p className="text-sm text-text-muted">No categories yet.</p>
        ) : (
          <ol className="flex flex-col gap-3" aria-label="Categories">
            {categories.map((category, index) => (
              <CategoryItem
                key={`${category.id}:${category.name}:${category.color}:${category.staffOnly}`}
                slug={slug}
                category={category}
                index={index}
                count={categories.length}
                busy={busy}
                onMove={(offset) => move(index, offset)}
                onDelete={() => setDeleting(category)}
                run={run}
              />
            ))}
          </ol>
        )}
        {categories.length < maxCategories ? (
          <div className="flex flex-col gap-3 rounded-md border border-dashed border-border-strong p-3">
            <DraftFields
              draft={draft}
              onChange={(next) => {
                setDraft(next);
                if (next.name.trim() !== "") setNameMissing(false);
              }}
              nameLabel="New category name"
              nameError={nameMissing ? "Enter a category name." : undefined}
            />
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 self-start"
              disabled={busy}
              onClick={() => {
                if (draft.name.trim() === "") {
                  setNameMissing(true);
                  return;
                }
                run(
                  () => createCategoryAction({ slug, ...draft }),
                  "Category added.",
                  () => setDraft({ name: "", color: "neutral", staffOnly: false }),
                );
              }}
            >
              Add category
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "this category"}?`}
        description={
          deleting?.slug === "general"
            ? "Posts in it stay in the feed without a category."
            : "Posts in it move to General."
        }
        confirmLabel="Delete category"
        pendingLabel="Deleting category…"
        danger
        onConfirm={() => deleteCategoryAction({ slug, categoryId: deleting?.id ?? "" })}
        onDone={() => router.refresh()}
      />
    </Card>
  );
}
