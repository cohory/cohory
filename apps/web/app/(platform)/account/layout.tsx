import type { ReactNode } from "react";

import { AccountNav } from "../../../components/account-nav";

export default function AccountLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <AccountNav />
      {children}
    </div>
  );
}
