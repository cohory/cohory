const segment = (value: string) => encodeURIComponent(value);

export function classroomHref(slug: string): string {
  return `/c/${segment(slug)}/classroom`;
}

export function newCourseHref(slug: string): string {
  return `${classroomHref(slug)}/new`;
}

export function courseHref(slug: string, courseSlug: string, options?: { edit?: boolean }): string {
  const base = `${classroomHref(slug)}/${segment(courseSlug)}`;
  return options?.edit ? `${base}?edit=1` : base;
}

export function lessonHref(
  slug: string,
  courseSlug: string,
  lessonSlug: string,
  options?: { edit?: boolean },
): string {
  const base = `${courseHref(slug, courseSlug)}/${segment(lessonSlug)}`;
  return options?.edit ? `${base}?edit=1` : base;
}

export function uploadHref(key: string): string {
  return `/api/uploads/${key.split("/").map(segment).join("/")}`;
}

export function attachmentHref(key: string): string {
  return uploadHref(key);
}

export function agentExportHref(slug: string, courseSlug: string, version: string): string {
  return `/api/v1/communities/${encodeURIComponent(slug)}/courses/${encodeURIComponent(courseSlug)}/agent-versions/${encodeURIComponent(version)}/export`;
}
