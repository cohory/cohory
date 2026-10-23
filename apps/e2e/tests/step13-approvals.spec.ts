import { expectAccessible } from "../support/axe";
import { query, userIdOf } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll, joinCommunity } from "../pages/community";
import { expectUnread, settle } from "../pages/feed";

test("step 13 approvals: an agent asks to remove a member and the owner approves", async ({
  actor,
  request,
}) => {
  const owner = await actor("Olive", { desktop: true });
  const member = await actor("Sam", { desktop: true });
  const slug = await createCommunity(owner.page, `Agents ${uniqueSuffix()}`, "public");
  await joinCommunity(member.page, slug);
  const memberId = await userIdOf(member.person.email);
  let token = "";
  let approvalId = "";

  await test.step("the owner creates an agent that may propose changes and issues a token", async () => {
    const page = owner.page;
    await page.goto(`/c/${slug}/manage/settings/agents`);
    await settle(page);
    await page.getByLabel("Name", { exact: true }).fill("Helper");
    await page.getByText(/^More permissions/).click();
    await page.getByRole("checkbox", { name: /^Moderate members/ }).check();
    await page.getByRole("checkbox", { name: /^Propose changes/ }).check();
    await page.getByRole("button", { name: "Create agent" }).click();
    token = (await page.getByTestId("new-token").innerText()).trim();
    expect(token).toMatch(/^cohory_/);
    await page.getByRole("button", { name: "I stored it" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Helper" }).first()).toBeVisible();
  });

  await test.step("the agent's removal answers 202 and changes nothing yet", async () => {
    const response = await request.post(
      `/api/v1/communities/${slug}/manage/people/${memberId}/remove`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(response.status()).toBe(202);
    const body = (await response.json()) as { status: string; approvalId: string };
    expect(body.status).toBe("pending_approval");
    approvalId = body.approvalId;
    const [membership] = await query(
      `select m.status from memberships m join communities c on c.id = m.community_id where c.slug = '${slug}' and m.user_id = '${memberId}'`,
    );
    expect(membership?.[0]).toBe("active");
  });

  await test.step("the owner is notified and sees the request in Approvals", async () => {
    const page = owner.page;
    await expectUnread(page, `/c/${slug}`, 1);
    await page.goto(`/c/${slug}/manage`);
    await settle(page);
    await expect(page.getByText("1 agent request is waiting for you.")).toBeVisible();
    await page.getByRole("link", { name: "Review requests" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${slug}/manage/inbox\\?tab=approvals`));
    const item = page.getByRole("listitem", { name: "Remove Sam from the community" });
    await expect(item).toBeVisible();
    await expect(item.getByText("for Olive")).toBeVisible();
    await expect(item.getByRole("cell", { name: "Removed" })).toBeVisible();
    await expectAccessible(page, "approvals queue");
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, "approvals queue on a phone");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("approving removes the member once", async () => {
    const page = owner.page;
    const item = page.getByRole("listitem", { name: "Remove Sam from the community" });
    await expect(item.getByText("People", { exact: true })).toBeVisible();
    await item.getByRole("button", { name: "Approve" }).click();
    const confirm = page.getByRole("dialog", { name: "Approve this request?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Yes, approve" }).click();
    await expect(page.getByText("Approved and done.")).toBeVisible();
    const [membership] = await query(
      `select m.status from memberships m join communities c on c.id = m.community_id where c.slug = '${slug}' and m.user_id = '${memberId}'`,
    );
    expect(membership?.[0]).not.toBe("active");
    const status = await request.get(`/api/v1/communities/${slug}/approvals/${approvalId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await status.json()).toMatchObject({ state: "executed", decidedBy: { name: "Olive" } });
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText("Approved by Olive and done.")).toBeVisible();
    await expectAccessible(page, "approvals history");
  });

  await test.step("the audit log shows the request, the decision, and the execution", async () => {
    const page = owner.page;
    await page.goto(`/c/${slug}/manage/settings/audit-log`);
    await settle(page);
    for (const action of [
      "Approval requested",
      "Request approved",
      "Approved request done",
      "Member removed",
    ]) {
      await expect(page.getByRole("cell", { name: action, exact: true }).first()).toBeVisible();
    }
    const decision = page.getByRole("row").filter({ hasText: "Request approved" });
    await expect(decision.getByText("approved a request from")).toBeVisible();
    await expect(decision.getByText("Olive", { exact: true })).toBeVisible();
    await page.getByLabel("Agent").selectOption({ label: "Helper" });
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("agentId") !== null);
    await expect(page.getByRole("cell", { name: "Approval requested", exact: true })).toBeVisible();
    const rows = await query(
      `select a.action, a.actor_type, coalesce(a.agent_id::text, '') from audit_log a join communities c on c.id = a.community_id where c.slug = '${slug}' and a.action in ('approval.requested', 'approval.approved', 'approval.executed', 'member.removed') order by a.created_at`,
    );
    expect(rows.map((row) => row[0])).toEqual([
      "approval.requested",
      "member.removed",
      "approval.approved",
      "approval.executed",
    ]);
    expect(rows.every((row) => (row[2] ?? "").length > 0)).toBe(true);
    expect(rows[0]?.[1]).toBe("agent");
  });

  await test.step("the agent's owner sees what it did in Account, Agents", async () => {
    const page = owner.page;
    await page.goto(`/account/agents?community=${encodeURIComponent(slug)}`);
    await settle(page);
    await page.getByRole("link", { name: "See activity of Helper" }).click();
    await expect(page.getByRole("heading", { name: "Activity: Helper" })).toBeVisible();
    await expect(page.getByText("Approval requested", { exact: true })).toBeVisible();
    await expectAccessible(page, "agent activity");
  });
});
