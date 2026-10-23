import { getLegalConfig, legalLinks, minimumAge } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import Link from "next/link";

import { Fact, LegalDocument, Section } from "./legal-document";

const linkClass = "text-link";

export function CloudPrivacy() {
  const { instance } = getPlatformConfig();
  const links = legalLinks(getLegalConfig(), "cloud");
  return (
    <LegalDocument title="Privacy Policy">
      <Section title="Who is responsible">
        <p>
          <Fact fact="entity" /> runs {instance.name}. We are the controller for your account data.
          For what you share inside a community, the creator of that community is the controller and
          we process it on their behalf under our{" "}
          {links.dpa ? (
            <Link className={linkClass} href={links.dpa}>
              Data Processing Agreement
            </Link>
          ) : (
            "Data Processing Agreement"
          )}
          .
        </p>
      </Section>
      <Section title="What we collect">
        <ul className="list-disc pl-6">
          <li>
            Account: your name, email address, password (stored as a hash), and profile photo.
          </li>
          <li>Sign in: the device and IP address of each session, to keep your account safe.</li>
          <li>Communities: memberships, posts, comments, reactions, RSVPs, and course progress.</li>
          <li>
            Payments: which memberships you pay for and their status. Card details go straight to
            Stripe and never reach us.
          </li>
          <li>Email: which emails we sent you and whether they were delivered.</li>
          <li>
            Feedback, if you run a community and choose to answer: how easy a first step was, and
            why you archived or deleted a community, disconnected Stripe, or deleted your account.
            We email each answer to our team with your user id and community address. Your answers
            are part of your data download, and you can turn the questions off in Account,
            Notifications.
          </li>
        </ul>
      </Section>
      <Section title="Why we use it">
        <p>
          To run your account and the communities you join (the contract with you), to keep the
          service secure and prevent abuse (our legitimate interest), and to meet tax and legal
          duties.
        </p>
      </Section>
      <Section title="Where it is stored">
        <p>
          Your data is stored in <Fact fact="dataRegion" />. The services that help us run{" "}
          {instance.name} are listed in the Data Processing Agreement.
        </p>
      </Section>
      <Section title="How long we keep it">
        <p>
          We erase your account 14 days after you ask us to delete it. Payment records stay with
          Stripe and the creators you paid, as tax law requires. Feedback answers are kept for 24
          months and erased with your account.
        </p>
      </Section>
      <Section title="Your rights">
        <p>
          You can see and download your data from your account page, correct it, delete your
          account, object to how we use it, and complain to your data protection authority.
        </p>
      </Section>
      <Section title="Cookies">
        <p>
          We set only the cookies the service needs: one that keeps you signed in and one that
          remembers which community you were joining, for an hour. We use no analytics or
          advertising cookies.
        </p>
      </Section>
      <Section title="Payments">
        <p>
          Payments are processed by Stripe. Read the{" "}
          <a className={linkClass} href="https://stripe.com/privacy">
            Stripe Privacy Policy
          </a>
          .
        </p>
      </Section>
      <Section title="Age">
        <p>
          {instance.name} is not meant for anyone under {minimumAge}.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Write to <Fact fact="contactEmail" />
          {links.contact ? (
            <>
              {" "}
              or use the{" "}
              <Link className={linkClass} href={links.contact}>
                contact form
              </Link>
            </>
          ) : null}
          .
        </p>
      </Section>
    </LegalDocument>
  );
}
