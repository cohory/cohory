import type { McpToolAnnotations, McpToolMeta, OperationId } from "./route-meta";

const read: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const write: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

function material(name: string, title: string, description: string): McpToolMeta {
  return {
    tool: name,
    title,
    description,
    annotations: read,
    userContent: true,
    contentSource: "course_material",
  };
}

export const agentCourseTools: Readonly<Partial<Record<OperationId, readonly McpToolMeta[]>>> = {
  listCourses: [
    material(
      "list_courses",
      "List courses",
      "Courses you may read, in classroom order, with their slug and lesson count. A member's agent sees only the courses its person shared with it. Pass a slug to get_course.",
    ),
  ],
  getCourse: [
    material(
      "get_course",
      "Get a course",
      "A course outline: modules and published lessons in order, each with its slug. Pass the course slug and a lesson slug to get_lesson.",
    ),
  ],
  getLesson: [
    material(
      "get_lesson",
      "Get a lesson",
      "One lesson's content as sanitized HTML, with the previous and next lesson. Reading does not mark the lesson complete.",
    ),
  ],
  listMyAgentCourses: [
    material(
      "list_my_courses",
      "List my courses",
      "Courses with agent material you may read: the ones your person shared with you (every course when your person is an owner or admin). Each has its latest version, how you got access, and the license terms you must follow.",
    ),
  ],
  getAgentMaterial: [
    material(
      "get_course_agent_material",
      "Get course agent material",
      "The published agent material of a course: manifest with license, then lessons in order with objective, instructions, references, templates, tasks, and evaluations. Leave version out for the latest.",
    ),
  ],
  getAgentTask: [
    material(
      "get_agent_task",
      "Get an agent task",
      "One task with its prompt, input and expected output JSON Schemas, and its evaluation specs. Run evaluations yourself, in your own sandbox, then report with submit_task_result.",
    ),
  ],
  getAgentMaterialFileContent: [
    material(
      "get_agent_material_file",
      "Get a reference or template file",
      "A file from the material by its path. Markdown, text, CSV, and JSON up to 32 KiB come back inline; other files come back as a signed link that works for 5 minutes.",
    ),
  ],
  getAgentSkillExport: [
    material(
      "get_skill_export",
      "Get the skill download link",
      "A signed link, valid for 5 minutes, to the Agent Skills zip (SKILL.md, references, templates, tasks, evaluations, license, manifest with checksums) of the latest or a given version.",
    ),
  ],
  submitAgentResult: [
    {
      tool: "submit_task_result",
      title: "Submit a task result",
      description:
        "Report the result of one task run: lessonId, taskId, the version you worked from, your own runId, and a JSON payload up to 64 KiB (put your checks and environment details in it). Stored as self reported, never as verified. One result per run and task.",
      annotations: write,
      userContent: false,
    },
  ],
  listAgentSubmissions: [
    {
      tool: "list_my_submissions",
      title: "List my results",
      description: "Results you submitted for a course, newest first, with their payloads.",
      annotations: read,
      userContent: true,
    },
  ],
  createMembershipCheckout: [
    {
      tool: "propose_course_purchase",
      title: "Propose buying the membership",
      description:
        "Ask your person to buy the community membership, which includes its courses. Nothing is charged: your person sees the request in Account, Agents and pays in Stripe Checkout themselves if they agree. You never get the payment link.",
      annotations: write,
      userContent: false,
      agentProposal: true,
    },
  ],
};
