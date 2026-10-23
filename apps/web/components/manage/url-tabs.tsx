"use client";

import { Tabs } from "@cohory/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ComponentProps } from "react";

export function UrlTabs({
  param,
  defaultValue,
  ...props
}: Omit<ComponentProps<typeof Tabs>, "value" | "onValueChange" | "defaultValue"> & {
  param: string;
  defaultValue: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);

  function change(next: string) {
    setValue(next);
    const query = new URLSearchParams(searchParams.toString());
    query.set(param, next);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }

  return <Tabs {...props} value={value} onValueChange={change} />;
}
