import { getPlatformConfig } from "@cohory/config/platform";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarketingSection, MoreLink } from "../../../components/marketing/marketing-blocks";
import { SignUpCta } from "../../../components/marketing/marketing-shell";
import { hasMarketingPages } from "../../../lib/marketing/edition";
import { marketingMetadata } from "../../../lib/marketing/metadata";
import { loadCloudPricing } from "../../../lib/marketing/pricing";

export function generateMetadata(): Metadata {
  return marketingMetadata({
    title: "Pricing",
    description:
      "One plan with every feature, free to start. See the platform fee and fair use limits.",
    path: "/pricing",
  });
}

const cellClass = "border-t border-border px-3 py-3 text-left align-top";

export default function PricingPage() {
  const { edition, instance } = getPlatformConfig();
  if (!hasMarketingPages(edition)) {
    notFound();
  }
  const pricing = loadCloudPricing();
  const included = [
    "Community feed, courses, events, and paid memberships",
    "AI agents through MCP and the REST API",
    "Import from Skool, Circle, or a spreadsheet",
    "Export your whole community at any time",
    pricing.feeLine,
  ];

  return (
    <div className="flex flex-col">
      <header className="flex max-w-2xl flex-col gap-3 pb-10">
        <h1 className="text-3xl text-text sm:text-4xl">Pricing</h1>
        <p className="text-lg font-normal text-text-muted">
          One plan with every feature and no monthly charge.
        </p>
      </header>

      <section
        aria-labelledby="plan"
        className="mb-12 flex max-w-xl flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-sm"
      >
        <h2 id="plan" className="text-xl text-text">
          {instance.name} Cloud
        </h2>
        <p className="flex flex-col gap-1">
          <span className="text-4xl text-text">Free</span>
          <span className="text-base text-text-muted">
            {pricing.feeRate
              ? `then ${pricing.feeRate} of each payment you receive`
              : "No platform fee"}
          </span>
        </p>
        <ul className="flex flex-col gap-2">
          {included.map((item) => (
            <li key={item} className="flex gap-2 text-base text-text">
              <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
              {item}
            </li>
          ))}
        </ul>
        <SignUpCta />
      </section>

      <MarketingSection
        id="fair-use"
        title="Fair use limits"
        lead={`Limits apply to each community. A community counts as paid when it received a payment in the last ${pricing.paidWindowDays} days.`}
      >
        <div className="max-w-2xl overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="text-sm text-text-muted">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  <span className="sr-only">Limit</span>
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Free community
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Paid community
                </th>
              </tr>
            </thead>
            <tbody>
              {pricing.limits.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className={`${cellClass} font-medium text-text`}>
                    {row.label}
                  </th>
                  <td className={`${cellClass} text-text-muted`}>{row.free}</td>
                  <td className={`${cellClass} text-text-muted`}>{row.paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MarketingSection>

      <MarketingSection
        id="self-host"
        title="Cloud or your own server"
        lead="The same open source software runs both. Choose who runs it."
      >
        <div className="max-w-3xl overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="text-sm text-text-muted">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  <span className="sr-only">Compare</span>
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Cloud
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Community Edition
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Who runs it", "We do", "You do, on your own server"],
                ["Fees", pricing.feeLine, pricing.selfHostedFeeLine],
                ["Payments", "Connect your Stripe account", "Your own Stripe keys"],
                ["Limits", "Fair use limits above", "You set them"],
              ].map(([label, cloud, selfHosted]) => (
                <tr key={label}>
                  <th scope="row" className={`${cellClass} font-medium text-text`}>
                    {label}
                  </th>
                  <td className={`${cellClass} text-text-muted`}>{cloud}</td>
                  <td className={`${cellClass} text-text-muted`}>{selfHosted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <MoreLink href="/open-source">About the Community Edition</MoreLink>
      </MarketingSection>
    </div>
  );
}
