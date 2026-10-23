"use client";

import type { AppearanceNotice } from "@cohory/communities";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  toast,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  previewAccentAction,
  removeBrandingAction,
  saveAppearanceAction,
  uploadBrandingAction,
  type AppearanceResult,
} from "../../lib/manage/actions";
import type { ModeTokens } from "../../lib/manage/views";
import { AppearancePreview } from "./appearance-preview";
import { BrandingUpload } from "./branding-upload";
import { RadioCards } from "./radio-cards";

type Font = "inter" | "source-serif" | "nunito-sans";
type CardStyle = "soft" | "minimal";
type Theme = "light" | "dark" | "system";

const hexPattern = /^#[0-9A-Fa-f]{6}$/;

export interface AppearanceInitial {
  readonly accent: string | null;
  readonly font: Font;
  readonly cardStyle: CardStyle;
  readonly theme: Theme;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly notices: AppearanceNotice[];
  readonly light: ModeTokens;
  readonly dark: ModeTokens;
}

const fontOptions = [
  { value: "inter", label: "Inter", sample: "var(--font-inter), var(--font-sans)" },
  {
    value: "source-serif",
    label: "Source Serif",
    sample: "var(--font-source-serif), var(--font-serif)",
  },
  {
    value: "nunito-sans",
    label: "Nunito Sans",
    sample: "var(--font-nunito-sans), var(--font-sans)",
  },
] as const;

export function AppearanceForm({
  slug,
  communityName,
  defaultAccent,
  initial,
}: {
  slug: string;
  communityName: string;
  defaultAccent: string;
  initial: AppearanceInitial;
}) {
  const router = useRouter();
  const [accent, setAccent] = useState<string | null>(initial.accent);
  const [hexText, setHexText] = useState(initial.accent ?? defaultAccent);
  const [font, setFont] = useState<Font>(initial.font);
  const [cardStyle, setCardStyle] = useState<CardStyle>(initial.cardStyle);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [coverUrl, setCoverUrl] = useState(initial.coverUrl);
  const [preview, setPreview] = useState({ light: initial.light, dark: initial.dark });
  const [notices, setNotices] = useState<readonly AppearanceNotice[]>(initial.notices);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const firstPreview = useRef(true);

  useEffect(() => {
    if (firstPreview.current) {
      firstPreview.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      const result = await previewAccentAction({ slug, accent: accent ?? defaultAccent });
      if (!result.ok) return;
      setPreview({ light: result.data.light, dark: result.data.dark });
      setNotices(result.data.notices);
    }, 250);
    return () => clearTimeout(timer);
  }, [accent, defaultAccent, slug]);

  function changeHex(value: string) {
    setHexText(value);
    const trimmed = value.trim();
    setAccent(trimmed === "" ? null : trimmed);
  }

  function changePicker(value: string) {
    const upper = value.toUpperCase();
    setHexText(upper);
    setAccent(upper);
  }

  function resetAccent() {
    setHexText(defaultAccent);
    setAccent(null);
  }

  function applyBranding(result: AppearanceResult) {
    setLogoUrl(result.logoUrl);
    setCoverUrl(result.coverUrl);
    router.refresh();
  }

  function save() {
    const value = accent === null ? null : accent.trim();
    if (value !== null && !hexPattern.test(value)) {
      setError(`Enter a color like ${defaultAccent}.`);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await saveAppearanceAction({ slug, accent: value, font, cardStyle, theme });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotices(result.data.notices);
      toast.success("Appearance saved.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Logo and cover</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <BrandingUpload
            label="Logo"
            description="A square image works best. Up to 5 MB."
            frame="logo"
            imageUrl={logoUrl}
            onUpload={(data) => uploadBrandingAction(slug, "logo", data)}
            onRemove={() => removeBrandingAction(slug, "logo")}
            onDone={applyBranding}
          />
          <BrandingUpload
            label="Cover image"
            description="Shown at the top of your About page, and on link previews while the community is public (previews may crop the sides). Use 1600 × 400 or larger, up to 5 MB. Phones show a taller crop, so keep the important part in the middle."
            frame="cover"
            imageUrl={coverUrl}
            onUpload={(data) => uploadBrandingAction(slug, "cover", data)}
            onRemove={() => removeBrandingAction(slug, "cover")}
            onDone={applyBranding}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Accent color</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Pick a color">
              {(control) => (
                <input
                  {...control}
                  type="color"
                  value={hexPattern.test(hexText) ? hexText : defaultAccent}
                  onChange={(event) => changePicker(event.target.value)}
                  className="h-11 w-16 cursor-pointer rounded-md border border-input bg-surface p-1"
                />
              )}
            </Field>
            <Field label="Hex code" className="w-40">
              {(control) => (
                <Input
                  {...control}
                  value={hexText}
                  maxLength={7}
                  spellCheck={false}
                  onChange={(event) => changeHex(event.target.value)}
                />
              )}
            </Field>
            <Button type="button" variant="ghost" className="min-h-11" onClick={resetAccent}>
              Reset to default
            </Button>
          </div>
          {notices.map((notice) => (
            <Alert key={notice.code} variant="warning">
              <AlertDescription>{notice.message}</AlertDescription>
            </Alert>
          ))}
          <AppearancePreview
            light={preview.light}
            dark={preview.dark}
            font={font}
            cardStyle={cardStyle}
            name={communityName}
            logoUrl={logoUrl}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Style</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <RadioCards
            legend="Heading font"
            name="font"
            value={font}
            onChange={setFont}
            options={fontOptions.map((option) => ({
              value: option.value,
              label: option.label,
              description: (
                <span style={{ fontFamily: option.sample }} className="text-base text-text">
                  Learn together, every week
                </span>
              ),
            }))}
          />
          <RadioCards
            legend="Card style"
            name="card-style"
            columns={2}
            value={cardStyle}
            onChange={setCardStyle}
            options={[
              { value: "soft", label: "Soft", description: "Rounder corners with a soft shadow." },
              { value: "minimal", label: "Minimal", description: "A thin border and no shadow." },
            ]}
          />
          <RadioCards
            legend="Light or dark"
            name="theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              {
                value: "system",
                label: "System",
                description: "Matches each visitor's device setting.",
              },
            ]}
          />
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="button" onClick={save} disabled={saving} className="min-h-11 self-start">
        {saving ? "Saving appearance…" : "Save appearance"}
      </Button>
    </div>
  );
}
