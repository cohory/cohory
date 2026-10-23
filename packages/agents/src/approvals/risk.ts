import type { ApprovalCategory } from "@cohory/authz";

export interface ApprovalRisk {
  readonly label: string;
  readonly serious: boolean;
}

const risks: Readonly<Record<ApprovalCategory, ApprovalRisk>> = {
  money: { label: "Money", serious: true },
  payment_connection: { label: "Money", serious: true },
  purchase: { label: "Money", serious: false },
  role: { label: "People", serious: true },
  removal: { label: "People", serious: true },
  deletion: { label: "Delete", serious: true },
  publishing: { label: "Publish", serious: false },
  settings: { label: "Settings", serious: false },
  data_export: { label: "Data", serious: false },
  data_import: { label: "Data", serious: false },
};

function isCategory(value: string): value is ApprovalCategory {
  return Object.hasOwn(risks, value);
}

export function approvalRisk(category: string): ApprovalRisk {
  return isCategory(category) ? risks[category] : { label: "Other", serious: true };
}
