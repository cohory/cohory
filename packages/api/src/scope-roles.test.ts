import {
  communityRoles,
  roleMayPerform,
  scopeDetails,
  scopes,
  type PolicyAction,
} from "@cohory/authz";
import { describe, expect, it } from "vitest";

import { routeScopes, type CohoryRouteMeta } from "./route-meta";

const metas: readonly CohoryRouteMeta[] = Object.values(routeScopes);

describe("scope roles", () => {
  it.each(scopes)("offers %s to exactly the roles that can use one of its routes", (scope) => {
    const actions = metas.flatMap((meta): PolicyAction[] =>
      meta.scope === scope && meta.action !== null ? [meta.action] : [],
    );
    const usable = communityRoles.filter((role) =>
      actions.some((action) => roleMayPerform(role, action)),
    );
    expect([...scopeDetails[scope].roles].sort()).toEqual([...usable].sort());
  });
});
