import type { CurrentUser } from "@/lib/auth";
import { requireCurrentUser } from "@/lib/auth";

export const ADMIN_EMAIL = "sunxi0302@gmail.com";

export function isAdminUser(user: Pick<CurrentUser, "email"> | undefined) {
  return user?.email.trim().toLowerCase() === ADMIN_EMAIL;
}

export async function requireAdminUser() {
  const user = await requireCurrentUser();
  if (!isAdminUser(user)) throw new Error("ADMIN_FORBIDDEN");
  return user;
}
