import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-6 rounded-(--card-radius) border border-border bg-surface py-6 text-text shadow-(--card-shadow)",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 px-6", className)}
      {...props}
    />
  );
}

type CardTitleLevel = "h1" | "h2" | "h3" | "h4" | "h5";

function CardTitle({
  as: Heading = "h3",
  className,
  ...props
}: ComponentProps<"h3"> & { as?: CardTitleLevel }) {
  return (
    <Heading data-slot="card-title" className={cn("text-xl text-text", className)} {...props} />
  );
}

function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-text-muted", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-footer" className={cn("flex items-center px-6", className)} {...props} />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
