import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { getCreditAccount } from "@/lib/billing/accounts";
import { estimateBilling } from "@/lib/billing/estimate";
import { billingResourceTypes } from "@/lib/billing/types";

const requestSchema = z.object({
  items: z.array(z.object({
    resourceType: z.enum(billingResourceTypes),
    quantity: z.number().positive().max(10_000)
  })).min(1).max(20)
});

export async function POST(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "计费估算请求格式无效。" }, { status: 400 });
  }

  const estimate = estimateBilling(parsed.data.items);
  const account = await getCreditAccount(user.id);
  return NextResponse.json({
    estimateId: crypto.randomUUID(),
    ...estimate,
    availableCredits: account.availableCredits,
    reservedCredits: account.reservedCredits,
    balanceSufficient: account.availableCredits >= estimate.maximumCredits,
    shortfallCredits: Math.max(0, estimate.maximumCredits - account.availableCredits),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
  });
}
