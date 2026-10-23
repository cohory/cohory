import { getLegalConfig, type LegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import { Alert } from "@cohory/ui";
import { formatDate } from "@cohory/ui/lib/format-date";
import Link from "next/link";
import type { ReactNode } from "react";

export type LegalFact = "entity" | "governingLaw" | "dataRegion" | "contactEmail";

const factLabels: Record<LegalFact, string> = {
  entity: "Company name",
  governingLaw: "Governing law",
  dataRegion: "Data region",
  contactEmail: "Contact email",
};

export function Fact({ fact }: { fact: LegalFact }) {
  const value = getLegalConfig()[fact];
  if (value) {
    return <>{value}</>;
  }
  return (
    <mark className="rounded-sm bg-warning-muted px-1 text-text">[{factLabels[fact]} not set]</mark>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

export const legalTextsUpdatedAt = "2026-10-23";

export function lastUpdatedLine(legal: LegalConfig): string {
  const day = formatDate(legal.updatedAt ?? legalTextsUpdatedAt, {
    timeZone: "UTC",
    style: "long",
  });
  return `Last updated ${day}`;
}

export function LegalDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6 text-base text-text [&_p]:text-text-muted [&_li]:text-text-muted">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">{title}</h1>
        <p className="text-sm">{lastUpdatedLine(getLegalConfig())}</p>
      </header>
      {children}
    </article>
  );
}

export function OperatorTemplate({ title, subject }: { title: string; subject: string }) {
  const { instance } = getPlatformConfig();
  const { contactEmail } = getLegalConfig();
  return (
    <LegalDocument title={title}>
      <Alert variant="info">
        {instance.name} has not published its own {subject} yet.
      </Alert>
      <p>
        {instance.name} runs Cohory, open source community software, on its own server. The people
        who run this server decide how it is used and are responsible for the data stored on it.
        Cohory&apos;s developers do not run this server and cannot see its data.
      </p>
      <p>
        {contactEmail ? (
          <>
            For questions, write to{" "}
            <a className="text-link" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>{" "}
            or use the{" "}
            <Link className="text-link" href="/contact">
              contact form
            </Link>
            .
          </>
        ) : (
          "Ask the person who invited you here who runs this server."
        )}
      </p>
    </LegalDocument>
  );
}
