import { NextResponse } from "next/server";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { getCreditPurchaseForUser } from "@/lib/billing/accounts";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ purchaseId: string }> }) {
  try {
    const user = await requireCurrentUser();
    const { purchaseId } = await context.params;
    const purchase = await getCreditPurchaseForUser(purchaseId, user.id);
    if (!purchase) return NextResponse.json({ error: "Purchase not found." }, { status: 404 });
    return NextResponse.json({ purchase });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
}
