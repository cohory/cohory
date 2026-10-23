import { absoluteLegalUrl, getLegalConfig, legalLinks } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";

export function instanceName(): string {
  return getPlatformConfig().instance.name;
}

export function instanceUrl(): string {
  return getPlatformConfig().appUrl;
}

export function privacyUrl(): string {
  const { appUrl, edition } = getPlatformConfig();
  return absoluteLegalUrl(legalLinks(getLegalConfig(), edition).privacy, appUrl);
}

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0x2028 || code === 0x2029;
}

export function headerSafe(value: string, maxLength = 80): string {
  return Array.from(value, (character) => (isControl(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

const hexColor = /^#[0-9A-Fa-f]{6}$/;

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

export interface ButtonColors {
  readonly background: string;
  readonly foreground: string;
}

export const defaultButton: ButtonColors = { background: "#2563EB", foreground: "#FFFFFF" };

const foregrounds = ["#FFFFFF", "#111827"] as const;

export function buttonColors(accent: string | null | undefined): ButtonColors {
  if (!accent || !hexColor.test(accent)) {
    return defaultButton;
  }
  const background = accent.toUpperCase();
  const foreground = foregrounds.find((candidate) => contrastRatio(background, candidate) >= 4.5);
  return foreground ? { background, foreground } : defaultButton;
}

export function httpsUrl(value: string | null | undefined): string | null {
  if (!value || !URL.canParse(value)) {
    return null;
  }
  return new URL(value).protocol === "https:" ? value : null;
}
