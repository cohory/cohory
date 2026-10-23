import type { LicenseTerms } from "@cohory/entitlements";

export function distinctLicenses(licenses: readonly LicenseTerms[]): LicenseTerms[] {
  const seen = new Map<string, LicenseTerms>();
  for (const license of licenses) {
    seen.set(`${license.id}:${license.text ?? ""}`, license);
  }
  return [...seen.values()];
}

export function AgentLicenseNote({ licenses }: { licenses: readonly LicenseTerms[] }) {
  const terms = distinctLicenses(licenses);
  if (terms.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby="agent-license-heading"
      className="flex max-w-xl flex-col gap-2 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-4"
    >
      <h3 id="agent-license-heading" className="text-base font-medium text-text">
        Courses your agents can read
      </h3>
      <p className="text-sm text-text-muted">
        Some courses here let members give their own agents read access. Agents follow these terms:
      </p>
      <ul className="flex flex-col gap-2">
        {terms.map((license) => (
          <li key={`${license.id}:${license.text ?? ""}`} className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text">{license.label}</span>
            <span className="text-text-muted">{license.summary}</span>
            {license.text ? (
              <span className="break-words whitespace-pre-line text-text">{license.text}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
