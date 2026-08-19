import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminCreditsClient } from "@/app/admin/admin-credits-client";
import { isAdminUser } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Credits Admin | Know Video" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!isAdminUser(user)) notFound();
  return <AdminCreditsClient admin={user} />;
}
