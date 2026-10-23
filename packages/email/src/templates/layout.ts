import {
  buttonColors,
  defaultButton,
  headerSafe,
  httpsUrl,
  instanceName,
  instanceUrl,
  privacyUrl,
} from "../brand";
import type { EmailContent } from "../message";
import { escapeHtml } from "./html";
import type { EmailTemplateId } from "./ids";

export interface CommunityBrandInput {
  readonly logoUrl?: string | null;
  readonly accent?: string | null;
}

export type EmailBrand =
  | ({ readonly kind: "community"; readonly name: string } & CommunityBrandInput)
  | { readonly kind: "instance" };

export interface EmailLink {
  readonly label: string;
  readonly url: string;
}

export interface EmailListItem extends EmailLink {
  readonly note?: string;
}

export type EmailBlock =
  | string
  | ({ readonly kind: "link" } & EmailLink)
  | { readonly kind: "list"; readonly items: readonly EmailListItem[] };

export interface EmailFooter {
  readonly why: string;
  readonly links?: readonly EmailLink[];
}

export interface LayoutInput {
  readonly title: string;
  readonly preheader: string;
  readonly brand: EmailBrand;
  readonly body: readonly EmailBlock[];
  readonly cta?: EmailLink;
  readonly after?: readonly EmailBlock[];
  readonly footer?: EmailFooter;
}

const light = {
  bg: "#F8FAFC",
  surface: "#FFFFFF",
  border: "#E5E7EB",
  text: "#111827",
  muted: "#64748B",
  link: "#2563EB",
};

const font =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

const style = `<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .ce-bg { background-color: #0E131B !important; }
  .ce-card { background-color: #151B24 !important; border-color: #2A3240 !important; }
  .ce-text { color: #F1F5F9 !important; }
  .ce-muted { color: #94A3B8 !important; }
  .ce-link { color: #60A5FA !important; }
  .ce-button-default { background-color: #60A5FA !important; color: #0B1120 !important; }
}
</style>`;

const preheaderPadding = "&#847;&zwnj;&nbsp;".repeat(60);

function anchor(link: EmailLink, extraStyle = ""): string {
  return `<a href="${escapeHtml(link.url)}" class="ce-link" style="color:${light.link};${extraStyle}">${escapeHtml(link.label)}</a>`;
}

function paragraph(inner: string, muted = false): string {
  const color = muted ? light.muted : light.text;
  const size = muted ? "font-size:13px;line-height:20px;" : "font-size:16px;line-height:24px;";
  return `<p class="${muted ? "ce-muted" : "ce-text"}" style="margin:0 0 16px;${size}color:${color};">${inner}</p>`;
}

function blockHtml(block: EmailBlock): string {
  if (typeof block === "string") {
    return paragraph(escapeHtml(block));
  }
  switch (block.kind) {
    case "link":
      return paragraph(anchor(block));
    case "list":
      return [
        `<ul class="ce-text" style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:24px;color:${light.text};">`,
        ...block.items.map(
          (item) =>
            `<li style="margin:0 0 8px;">${anchor(item)}${item.note ? ` ${escapeHtml(item.note)}` : ""}</li>`,
        ),
        "</ul>",
      ].join("");
  }
}

function blockText(block: EmailBlock): string {
  if (typeof block === "string") {
    return block;
  }
  switch (block.kind) {
    case "link":
      return `${block.label}: ${block.url}`;
    case "list":
      return block.items
        .map((item) => `${item.label}${item.note ? ` ${item.note}` : ""}\n${item.url}`)
        .join("\n\n");
  }
}

function headerHtml(brand: EmailBrand): string {
  const nameStyle = `font-size:16px;line-height:24px;font-weight:600;color:${light.text};`;
  if (brand.kind === "instance") {
    return `<p class="ce-text" style="margin:0;${nameStyle}">${escapeHtml(instanceName())}</p>`;
  }
  const name = escapeHtml(brand.name);
  const logo = httpsUrl(brand.logoUrl);
  const colors = buttonColors(brand.accent);
  const mark = logo
    ? `<img src="${escapeHtml(logo)}" alt="${name}" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:8px;border:0;">`
    : `<div style="width:40px;height:40px;border-radius:8px;background-color:${colors.background};color:${colors.foreground};font-size:18px;line-height:40px;font-weight:600;text-align:center;">${escapeHtml(brand.name.trim().charAt(0).toUpperCase() || "?")}</div>`;
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td style="padding-right:12px;vertical-align:middle;">${mark}</td>`,
    `<td class="ce-text" style="vertical-align:middle;${nameStyle}">${name}</td>`,
    "</tr></table>",
  ].join("");
}

function buttonHtml(cta: EmailLink, brand: EmailBrand): string {
  const colors = buttonColors(brand.kind === "community" ? brand.accent : null);
  const darkVariant = colors === defaultButton ? ' class="ce-button-default"' : "";
  return `<p style="margin:8px 0 24px;"><a href="${escapeHtml(cta.url)}"${darkVariant} style="display:inline-block;background-color:${colors.background};color:${colors.foreground};padding:12px 20px;border-radius:8px;font-size:16px;line-height:20px;font-weight:600;text-decoration:none;">${escapeHtml(cta.label)}</a></p>`;
}

function senderLine(brand: EmailBrand): string {
  return brand.kind === "community"
    ? `Sent by ${instanceName()} for ${brand.name}.`
    : `Sent by ${instanceName()}.`;
}

function footerHtml(footer: EmailFooter | undefined, brand: EmailBrand): string {
  const links = footer?.links?.map((link) => anchor(link)).join(" · ");
  const instance = anchor({ label: instanceName(), url: instanceUrl() });
  const sender =
    brand.kind === "community"
      ? `Sent by ${instance} for ${escapeHtml(brand.name)}.`
      : `Sent by ${instance}.`;
  const privacy = anchor({ label: "Privacy", url: privacyUrl() });
  return [
    footer ? paragraph(escapeHtml(footer.why), true) : "",
    links ? paragraph(links, true) : "",
    paragraph(`${sender} ${privacy}`, true),
  ].join("");
}

export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(input.title)}</title>`,
    style,
    "</head>",
    `<body class="ce-bg" style="margin:0;padding:0;background-color:${light.bg};${font}">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;" aria-hidden="true">${escapeHtml(input.preheader)}${preheaderPadding}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ce-bg" style="background-color:${light.bg};"><tr><td align="center" style="padding:24px 16px;">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">',
    `<tr><td style="padding:0 0 16px;${font}">${headerHtml(input.brand)}</td></tr>`,
    `<tr><td class="ce-card" style="background-color:${light.surface};border:1px solid ${light.border};border-radius:12px;padding:24px;${font}">`,
    ...input.body.map(blockHtml),
    input.cta ? buttonHtml(input.cta, input.brand) : "",
    ...(input.after ?? []).map(blockHtml),
    "</td></tr>",
    `<tr><td style="padding:16px 8px 0;${font}">${footerHtml(input.footer, input.brand)}</td></tr>`,
    "</table>",
    "</td></tr></table>",
    "</body>",
    "</html>",
  ].join("\n");

  const text = [
    ...input.body.map(blockText),
    ...(input.cta ? [blockText({ kind: "link", ...input.cta })] : []),
    ...(input.after ?? []).map(blockText),
    ...(input.footer ? [input.footer.why] : []),
    ...(input.footer?.links ?? []).map((link) => blockText({ kind: "link", ...link })),
    senderLine(input.brand),
    `Privacy: ${privacyUrl()}`,
  ].join("\n\n");

  return { html, text };
}

export interface BuildEmailInput extends Omit<LayoutInput, "title"> {
  readonly template: EmailTemplateId;
  readonly subject: string;
}

export function senderName(brand: EmailBrand): string {
  const instance = headerSafe(instanceName(), 60);
  return brand.kind === "community" ? `${headerSafe(brand.name)} via ${instance}` : instance;
}

export function buildEmail({ template, subject, ...layout }: BuildEmailInput): EmailContent {
  const fullSubject =
    layout.brand.kind === "community" ? `[${layout.brand.name}] ${subject}` : subject;
  return {
    template,
    fromName: senderName(layout.brand),
    subject: fullSubject,
    ...renderLayout({ ...layout, title: fullSubject }),
  };
}

export function communityBrand(name: string, brand: CommunityBrandInput | undefined): EmailBrand {
  return { kind: "community", name, ...brand };
}

export interface EventCommunity {
  readonly communityName: string;
  readonly communityBrand?: CommunityBrandInput;
}

export function eventBrand({ communityName, communityBrand: brand }: EventCommunity): EmailBrand {
  return communityBrand(communityName, brand);
}
