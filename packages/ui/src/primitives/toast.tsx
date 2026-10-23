"use client";

import type { ComponentProps, CSSProperties } from "react";
import { Toaster as Sonner, toast } from "sonner";

const tokenStyle = {
  "--normal-bg": "var(--color-surface-raised)",
  "--normal-text": "var(--color-text)",
  "--normal-border": "var(--color-border)",
  "--success-bg": "var(--color-success-muted)",
  "--success-text": "var(--color-text)",
  "--success-border": "var(--color-success)",
  "--error-bg": "var(--color-danger-muted)",
  "--error-text": "var(--color-text)",
  "--error-border": "var(--color-danger)",
  "--border-radius": "var(--radius-md)",
  zIndex: "var(--z-toast)",
} as CSSProperties;

const aboveTabBar = { bottom: "var(--toast-offset-bottom)" };

function Toaster(props: ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      position="bottom-center"
      offset={aboveTabBar}
      mobileOffset={aboveTabBar}
      containerAriaLabel="Notifications"
      style={tokenStyle}
      toastOptions={{
        classNames: {
          toast: "font-sans text-sm shadow-md",
          description: "text-text-muted",
          actionButton: "bg-accent text-accent-foreground",
          cancelButton: "bg-surface-hover text-text",
        },
      }}
      {...props}
    />
  );
}

export { toast, Toaster };
