export function visibleCopy(html: string): string {
  return html.replace("<!doctype html>", "").replace(/<style>[\s\S]*?<\/style>/, "");
}

export function allCopy(email: { subject: string; text: string; html: string }): string {
  return `${email.subject}\n${email.text}\n${visibleCopy(email.html)}`;
}
