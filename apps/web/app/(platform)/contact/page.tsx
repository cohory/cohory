import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import { contactPrefill, contactTopics } from "@cohory/notifications/contact";
import type { Metadata } from "next";

import { getContactService } from "../../../lib/contact/service";
import { currentSession } from "../../../lib/session";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const { instance, appUrl } = getPlatformConfig();
  const service = getContactService();
  const { contactEmail } = getLegalConfig();
  const [session, query] = await Promise.all([currentSession(), searchParams]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">Contact</h1>
        <p className="text-base text-text-muted">
          Write to the people who run {instance.name}. For a question about a single community, its
          owner is usually the fastest help.
        </p>
      </header>
      {service.available ? (
        <>
          <p className="text-sm text-text-muted">
            Your message goes to the team behind {instance.name}, and the reply comes by email.
            {session ? " We include your account details so we can help faster." : null}
          </p>
          <ContactForm
            token={service.issueFormToken()}
            topics={contactTopics}
            sender={session ? { name: session.user.name, email: session.user.email } : null}
            prefill={contactPrefill(query, appUrl)}
          />
        </>
      ) : (
        <p className="text-base text-text">
          {contactEmail ? (
            <>
              Write to{" "}
              <a className="text-link" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
              .
            </>
          ) : (
            "This server has no contact address yet. Ask the person who invited you here who runs it."
          )}
        </p>
      )}
    </div>
  );
}
