import { Link } from "../lib/link";
import { cn } from "../lib/utils";

type CategoryChipColor = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

interface CategoryChip {
  key: string;
  label: string;
  href: string;
  active: boolean;
  color?: CategoryChipColor;
}

interface CategoryChipsProps {
  chips: readonly CategoryChip[];
  label?: string;
  className?: string;
}

const dotClasses: Readonly<Record<CategoryChipColor, string>> = {
  neutral: "bg-text-muted",
  accent: "bg-accent",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

function CategoryChips({ chips, label = "Filter by category", className }: CategoryChipsProps) {
  return (
    <nav aria-label={label} className={cn("overflow-x-auto", className)}>
      <ul className="flex w-max gap-2 py-1">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.href}
              aria-current={chip.active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none",
                chip.active
                  ? "border-accent bg-accent-muted text-text"
                  : "border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text",
              )}
            >
              {chip.color ? (
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", dotClasses[chip.color])}
                />
              ) : null}
              {chip.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { CategoryChips, type CategoryChip, type CategoryChipColor, type CategoryChipsProps };
