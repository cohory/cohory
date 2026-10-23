import MarkdownIt from "markdown-it";

export interface RenderLessonOptions {
  readonly imageHosts?: readonly string[];
}

interface RenderEnv {
  readonly imageHosts: ReadonlySet<string>;
}

export const uploadsPathPrefix = "/api/uploads/";

const allowedSchemes = /^(https?:|mailto:)/i;
const anyScheme = /^[a-z][a-z0-9+.-]*:/i;

function isSafeLink(url: string): boolean {
  const trimmed = url.trim();
  if (allowedSchemes.test(trimmed)) {
    return true;
  }
  return !anyScheme.test(trimmed) && !trimmed.startsWith("//") && !trimmed.includes("\\");
}

function isUploadPath(src: string): boolean {
  if (!src.startsWith(uploadsPathPrefix) || src.includes("\\") || src.includes("?")) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    return false;
  }
  return !decoded.split("/").some((segment) => segment === ".." || segment === ".");
}

function isAllowedImage(src: string, hosts: ReadonlySet<string>): boolean {
  if (isUploadPath(src)) {
    return true;
  }
  if (!src.startsWith("https://")) {
    return false;
  }
  try {
    const url = new URL(src);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isRenderEnv(env: unknown): env is RenderEnv {
  return typeof env === "object" && env !== null && "imageHosts" in env;
}

function createRenderer(): MarkdownIt {
  const md = new MarkdownIt("default", { html: false, linkify: true, typographer: false });
  md.validateLink = isSafeLink;

  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    token?.attrSet("rel", "noopener noreferrer nofollow");
    token?.attrSet("target", "_blank");
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.image = (tokens, idx, options, env: unknown, self) => {
    const token = tokens[idx];
    if (!token) {
      return "";
    }
    const alt = self.renderInlineAsText(token.children ?? [], options, env);
    const src = token.attrGet("src") ?? "";
    const hosts = isRenderEnv(env) ? env.imageHosts : new Set<string>();
    if (!isAllowedImage(src, hosts)) {
      return md.utils.escapeHtml(alt);
    }
    token.attrSet("alt", alt);
    token.attrSet("loading", "lazy");
    token.attrSet("referrerpolicy", "no-referrer");
    return self.renderToken(tokens, idx, options);
  };

  return md;
}

const renderer = createRenderer();

function renderEnv(options: RenderLessonOptions): RenderEnv {
  return { imageHosts: new Set((options.imageHosts ?? []).map((host) => host.toLowerCase())) };
}

export function renderLessonHtml(
  markdown: string | null | undefined,
  options: RenderLessonOptions = {},
): string {
  if (!markdown) {
    return "";
  }
  return renderer.render(markdown, renderEnv(options));
}

const leadingHeading = /^<h([12])>([^<]*)<\/h\1>\n?/;

function comparable(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function withoutLeadingTitle(html: string, title: string): string {
  const match = leadingHeading.exec(html);
  if (!match || comparable(match[2] ?? "") !== comparable(renderer.utils.escapeHtml(title))) {
    return html;
  }
  return html.slice(match[0].length);
}

export function findBlockedImages(markdown: string, options: RenderLessonOptions = {}): string[] {
  const { imageHosts } = renderEnv(options);
  const blocked = new Set<string>();
  for (const block of renderer.parse(markdown, {})) {
    for (const token of block.children ?? []) {
      const src = token.type === "image" ? (token.attrGet("src") ?? "") : "";
      if (src && !isAllowedImage(src, imageHosts)) {
        blocked.add(src);
      }
    }
  }
  return [...blocked];
}
