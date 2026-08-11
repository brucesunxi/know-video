import { NextResponse } from "next/server";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { getCreditAccount } from "@/lib/billing/accounts";
import { creditPacks } from "@/lib/billing/packs";
import { xenditIsConfigured } from "@/lib/billing/xendit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    return NextResponse.json({
      account: await getCreditAccount(user.id),
      packs: creditPacks,
      paymentConfigured: xenditIsConfigured(),
      paymentProvider: "xendit"
    });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }
}
