import { Button } from "@cohory/ui";

import type { ModeTokens } from "../../lib/manage/views";
import type { CustomProperties } from "../../lib/theme/community-theme";
import { fontClassNames } from "../../lib/theme/community-theme";
import { StoredImage } from "../stored-image";

type CardStyle = "soft" | "minimal";

function tokenStyle(tokens: ModeTokens): CustomProperties {
  return {
    "--color-accent": tokens.accent,
    "--color-accent-hover": tokens.accentHover,
    "--color-accent-foreground": tokens.accentForeground,
    "--color-accent-muted": tokens.accentMuted,
    "--color-ring": tokens.ring,
  };
}

function Mark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <StoredImage
        data-slot="preview-logo"
        src={logoUrl}
        alt=""
        className="size-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground"
    >
      {name.trim().charAt(0).toUpperCase() || "C"}
    </span>
  );
}

function Sample({
  mode,
  tokens,
  name,
  cardStyle,
  logoUrl,
}: {
  mode: "light" | "dark";
  tokens: ModeTokens;
  name: string;
  cardStyle: CardStyle;
  logoUrl: string | null;
}) {
  return (
    <div
      data-theme={mode}
      data-card-style={cardStyle}
      style={tokenStyle(tokens)}
      className="flex flex-col gap-3 rounded-md border border-border bg-bg p-4 text-text"
    >
      <p className="text-xs font-medium text-text-muted">{mode === "light" ? "Light" : "Dark"}</p>
      <article
        data-slot="preview-post"
        className="flex flex-col gap-3 rounded-(--card-radius) border border-border bg-surface p-4 text-text shadow-(--card-shadow)"
      >
        <div className="flex items-center gap-3">
          <Mark name={name} logoUrl={logoUrl} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="text-sm text-text-muted">2 hours ago</span>
          </div>
        </div>
        <p className="text-base font-semibold">Welcome to {name}</p>
        <p className="text-sm">
          Start with the <span className="font-medium text-accent underline">first lesson</span> and
          say hello.
        </p>
        <p className="text-sm text-text-muted">4 likes, 2 comments</p>
      </article>
      <Button type="button" tabIndex={-1} className="self-start">
        Write something
      </Button>
    </div>
  );
}

export function AppearancePreview({
  light,
  dark,
  font,
  cardStyle,
  name,
  logoUrl = null,
}: {
  light: ModeTokens;
  dark: ModeTokens;
  font: keyof typeof fontClassNames;
  cardStyle: CardStyle;
  name: string;
  logoUrl?: string | null;
}) {
  return (
    <div
      aria-label="Preview"
      role="group"
      className={`grid gap-3 sm:grid-cols-2 ${fontClassNames[font]}`}
    >
      <Sample mode="light" tokens={light} name={name} cardStyle={cardStyle} logoUrl={logoUrl} />
      <Sample mode="dark" tokens={dark} name={name} cardStyle={cardStyle} logoUrl={logoUrl} />
    </div>
  );
}
