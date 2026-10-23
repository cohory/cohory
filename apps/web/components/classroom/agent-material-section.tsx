"use client";

import {
  AgentMaterialPanel,
  toast,
  type AgentMaterialLessonRow,
  type AgentMaterialVersionRow,
} from "@cohory/ui";
import { useRouter } from "next/navigation";

import { publishAgentVersionAction } from "../../lib/courses/agent-actions";

export interface AgentMaterialSectionProps {
  slug: string;
  courseSlug: string;
  lessons: AgentMaterialLessonRow[];
  versions: AgentMaterialVersionRow[];
  nextVersions: { patch: string; minor: string; major: string };
  license: { label: string; text: string };
}

export function AgentMaterialSection({ slug, courseSlug, ...props }: AgentMaterialSectionProps) {
  const router = useRouter();
  return (
    <AgentMaterialPanel
      {...props}
      onPublish={async (input) => {
        const result = await publishAgentVersionAction({ slug, courseSlug, ...input });
        if (!result.ok) return result.message;
        toast(`Version ${result.data.version} published.`);
        router.refresh();
        return null;
      }}
    />
  );
}
