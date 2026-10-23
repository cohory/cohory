import { Button } from "@cohory/ui";
import Link from "next/link";

export function StartImportLink() {
  return (
    <Button asChild>
      <Link href="/communities/new">Start an import</Link>
    </Button>
  );
}
