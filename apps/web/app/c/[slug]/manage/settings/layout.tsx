import { SettingsNav } from "../../../../../components/manage/settings-nav";
import { loadManageShell } from "../../../../../lib/manage/load";
import {
  settingsSectionHref,
  settingsSectionLabels,
  settingsSectionsFor,
} from "../../../../../lib/manage/settings-sections";

export default async function SettingsLayout({
  params,
  children,
}: LayoutProps<"/c/[slug]/manage/settings">) {
  const manage = await loadManageShell((await params).slug);
  const sections = manage ? settingsSectionsFor(manage.actor, manage.role) : [];
  if (!manage || sections.length === 0) {
    return children;
  }
  const items = sections.map((section) => ({
    href: settingsSectionHref(manage.slug, section),
    label: settingsSectionLabels[section],
  }));

  return (
    <>
      <h2 className="text-2xl font-semibold text-text">Settings</h2>
      <SettingsNav items={items} />
      {children}
    </>
  );
}
