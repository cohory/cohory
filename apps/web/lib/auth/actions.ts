"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAppAuth } from "./instance";

export async function signOut(): Promise<void> {
  await getAppAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
